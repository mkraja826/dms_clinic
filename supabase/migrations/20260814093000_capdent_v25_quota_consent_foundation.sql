-- CapDent V25 server-authoritative quota and legal-consent foundation.
--
-- Safety properties:
--   * additive / CREATE OR REPLACE only
--   * all quota enforcement remains disabled by default
--   * existing clinics remain grandfathered
--   * V24 clients continue to work while rollout flags are disabled
--   * paid-plan authority continues to come from server-owned clinic_subscriptions
--   * legal consent is recorded with a server timestamp through an RPC

begin;

alter table public.capdent_plan_catalog
  add column if not exists upload_limit integer
  check (upload_limit is null or upload_limit > 0);

alter table public.clinic_pricing_settings
  add column if not exists upload_limit_enforced boolean not null default false,
  add column if not exists storage_limit_enforced boolean not null default false;

alter table public.clinic_pricing_settings
  alter column pricing_policy_version set default 2;

update public.capdent_plan_catalog
set
  patient_limit = 100,
  upload_limit = 150,
  storage_limit_bytes = 1073741824,
  updated_at = now()
where code = 'free';

update public.capdent_plan_catalog
set upload_limit = null, updated_at = now()
where code in ('cloud', 'intelligence');

insert into public.capdent_pricing_flags (key, enabled, description)
values
  ('upload_limit_enforcement', false, 'Enforce the configured per-plan clinical upload count for explicitly enabled, non-grandfathered clinics.'),
  ('storage_limit_enforcement', false, 'Enforce the configured per-plan Storage byte limit for explicitly enabled, non-grandfathered clinics.')
on conflict (key) do update
set
  description = excluded.description,
  updated_at = now();

-- Only non-grandfathered clinics move to the V25 policy version automatically.
update public.clinic_pricing_settings
set pricing_policy_version = greatest(pricing_policy_version, 2)
where grandfathered = false;

create or replace function public.capdent_effective_plan_code(p_clinic_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.clinic_subscriptions%rowtype;
  v_legacy_plan text := 'free';
  v_plan_code text := 'free';
begin
  if p_clinic_id is null then
    return 'free';
  end if;

  select *
  into v_subscription
  from public.clinic_subscriptions cs
  where cs.clinic_id = p_clinic_id
  limit 1;

  if found then
    v_legacy_plan := lower(coalesce(v_subscription.plan_name, 'free'));

    if lower(coalesce(v_subscription.status, 'free')) in ('active', 'grace_period')
       and lower(coalesce(v_subscription.google_play_status, 'not_started'))
         not in ('cancelled', 'expired', 'account_hold') then
      v_plan_code := case
        when v_legacy_plan in ('clinic_intelligence', 'intelligence') then 'intelligence'
        when v_legacy_plan in ('professional', 'google_play_monthly', 'cloud') then 'cloud'
        else 'free'
      end;
    end if;
  end if;

  if not exists (
    select 1
    from public.capdent_plan_catalog pc
    where pc.code = v_plan_code
      and pc.active = true
  ) then
    v_plan_code := 'free';
  end if;

  return v_plan_code;
end;
$$;

revoke all on function public.capdent_effective_plan_code(uuid) from public, anon, authenticated;
grant execute on function public.capdent_effective_plan_code(uuid) to service_role;

create or replace function public.enforce_capdent_v25_patient_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_code text;
  v_limit integer;
  v_count integer;
  v_global_enabled boolean := false;
  v_clinic_enabled boolean := false;
  v_grandfathered boolean := true;
begin
  if new.clinic_id is null then
    return new;
  end if;

  select
    coalesce(cps.patient_limit_enforced, false),
    coalesce(cps.grandfathered, true)
  into
    v_clinic_enabled,
    v_grandfathered
  from public.clinic_pricing_settings cps
  where cps.clinic_id = new.clinic_id;

  if not found then
    return new;
  end if;

  select coalesce(enabled, false)
  into v_global_enabled
  from public.capdent_pricing_flags
  where key = 'patient_limit_enforcement';

  if not coalesce(v_global_enabled, false)
     or not v_clinic_enabled
     or v_grandfathered then
    return new;
  end if;

  v_plan_code := public.capdent_effective_plan_code(new.clinic_id);

  select pc.patient_limit
  into v_limit
  from public.capdent_plan_catalog pc
  where pc.code = v_plan_code
    and pc.active = true;

  if v_limit is null then
    return new;
  end if;

  -- Serialize quota-sensitive inserts within one clinic so two simultaneous
  -- registrations cannot both consume the final free slot.
  perform pg_advisory_xact_lock(hashtext('capdent:patient:' || new.clinic_id::text));

  select count(*)::integer
  into v_count
  from public.patients p
  where p.clinic_id = new.clinic_id;

  if v_count >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'CAPDENT_PATIENT_LIMIT_REACHED',
      detail = format('Clinic has %s patients; plan %s allows %s.', v_count, v_plan_code, v_limit),
      hint = 'Upgrade the clinic plan before registering another patient.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_capdent_v25_patient_quota() from public, anon, authenticated;

drop trigger if exists capdent_v25_enforce_patient_quota on public.patients;
create trigger capdent_v25_enforce_patient_quota
before insert on public.patients
for each row execute function public.enforce_capdent_v25_patient_quota();

create or replace function public.enforce_capdent_v25_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_clinic_id uuid;
  v_path_clinic text;
  v_plan_code text;
  v_upload_limit integer;
  v_storage_limit bigint;
  v_upload_count integer := 0;
  v_storage_used bigint := 0;
  v_old_size bigint := 0;
  v_new_size bigint := 0;
  v_upload_global boolean := false;
  v_storage_global boolean := false;
  v_upload_clinic boolean := false;
  v_storage_clinic boolean := false;
  v_grandfathered boolean := true;
  v_is_clinical_bucket boolean := false;
  v_is_capdent_bucket boolean := false;
begin
  v_is_clinical_bucket := new.bucket_id in ('prescriptions', 'xrays', 'patient-files');
  v_is_capdent_bucket := new.bucket_id in ('avatars', 'prescriptions', 'xrays', 'patient-files', 'clinic-logos');

  if not v_is_capdent_bucket then
    return new;
  end if;

  v_path_clinic := split_part(coalesce(new.name, ''), '/', 1);

  begin
    v_clinic_id := v_path_clinic::uuid;
  exception
    when invalid_text_representation then
      -- Legacy/non-clinic-scoped paths fail open. Existing Storage RLS remains
      -- responsible for access control; quota enforcement never broadens it.
      return new;
  end;

  select
    coalesce(cps.upload_limit_enforced, false),
    coalesce(cps.storage_limit_enforced, false),
    coalesce(cps.grandfathered, true)
  into
    v_upload_clinic,
    v_storage_clinic,
    v_grandfathered
  from public.clinic_pricing_settings cps
  where cps.clinic_id = v_clinic_id;

  if not found or v_grandfathered then
    return new;
  end if;

  select coalesce(enabled, false)
  into v_upload_global
  from public.capdent_pricing_flags
  where key = 'upload_limit_enforcement';

  select coalesce(enabled, false)
  into v_storage_global
  from public.capdent_pricing_flags
  where key = 'storage_limit_enforcement';

  if (not v_upload_global or not v_upload_clinic or not v_is_clinical_bucket)
     and (not v_storage_global or not v_storage_clinic) then
    return new;
  end if;

  v_plan_code := public.capdent_effective_plan_code(v_clinic_id);

  select pc.upload_limit, pc.storage_limit_bytes
  into v_upload_limit, v_storage_limit
  from public.capdent_plan_catalog pc
  where pc.code = v_plan_code
    and pc.active = true;

  perform pg_advisory_xact_lock(hashtext('capdent:storage:' || v_clinic_id::text));

  if v_upload_global and v_upload_clinic and v_is_clinical_bucket and v_upload_limit is not null then
    select count(*)::integer
    into v_upload_count
    from storage.objects so
    where so.bucket_id in ('prescriptions', 'xrays', 'patient-files')
      and split_part(so.name, '/', 1) = v_clinic_id::text;

    -- UPDATE/upsert of an existing object does not consume another upload slot.
    if tg_op = 'INSERT' and v_upload_count >= v_upload_limit then
      raise exception using
        errcode = 'P0001',
        message = 'CAPDENT_UPLOAD_LIMIT_REACHED',
        detail = format('Clinic has %s clinical uploads; plan %s allows %s.', v_upload_count, v_plan_code, v_upload_limit),
        hint = 'Upgrade the clinic plan before uploading another clinical file.';
    end if;
  end if;

  if v_storage_global and v_storage_clinic and v_storage_limit is not null then
    if new.metadata is null
       or not (new.metadata ? 'size')
       or (new.metadata ->> 'size') !~ '^[0-9]+$' then
      raise exception using
        errcode = 'P0001',
        message = 'CAPDENT_STORAGE_SIZE_REQUIRED',
        detail = 'Storage quota enforcement requires object size metadata.';
    end if;

    v_new_size := (new.metadata ->> 'size')::bigint;

    if tg_op = 'UPDATE'
       and old.metadata is not null
       and old.metadata ? 'size'
       and (old.metadata ->> 'size') ~ '^[0-9]+$' then
      v_old_size := (old.metadata ->> 'size')::bigint;
    end if;

    select coalesce(sum(
      case
        when so.metadata is not null
          and so.metadata ? 'size'
          and (so.metadata ->> 'size') ~ '^[0-9]+$'
        then (so.metadata ->> 'size')::bigint
        else 0
      end
    ), 0)
    into v_storage_used
    from storage.objects so
    where so.bucket_id in ('avatars', 'prescriptions', 'xrays', 'patient-files', 'clinic-logos')
      and split_part(so.name, '/', 1) = v_clinic_id::text;

    if (v_storage_used - v_old_size + v_new_size) > v_storage_limit then
      raise exception using
        errcode = 'P0001',
        message = 'CAPDENT_STORAGE_LIMIT_REACHED',
        detail = format('Clinic would use %s bytes; plan %s allows %s bytes.', v_storage_used - v_old_size + v_new_size, v_plan_code, v_storage_limit),
        hint = 'Upgrade the clinic plan or remove unneeded files before uploading.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_capdent_v25_storage_quota() from public, anon, authenticated;

drop trigger if exists capdent_v25_enforce_storage_quota on storage.objects;
create trigger capdent_v25_enforce_storage_quota
before insert or update on storage.objects
for each row execute function public.enforce_capdent_v25_storage_quota();

create table if not exists public.capdent_legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid references public.clinics(id) on delete set null,
  terms_version text not null check (length(btrim(terms_version)) between 1 and 80),
  privacy_version text not null check (length(btrim(privacy_version)) between 1 and 80),
  app_version text check (app_version is null or length(app_version) <= 40),
  platform text check (platform is null or platform in ('android', 'ios', 'web')),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, terms_version, privacy_version)
);

alter table public.capdent_legal_consents enable row level security;

revoke all on public.capdent_legal_consents from anon, authenticated;
grant select on public.capdent_legal_consents to authenticated;

drop policy if exists capdent_legal_consents_select_own on public.capdent_legal_consents;
create policy capdent_legal_consents_select_own
on public.capdent_legal_consents
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.record_capdent_legal_consent(
  p_terms_version text,
  p_privacy_version text,
  p_app_version text default null,
  p_platform text default 'android'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_id uuid;
  v_accepted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Login required';
  end if;

  if nullif(btrim(coalesce(p_terms_version, '')), '') is null
     or nullif(btrim(coalesce(p_privacy_version, '')), '') is null then
    raise exception 'Terms and privacy versions are required';
  end if;

  if p_platform is not null and p_platform not in ('android', 'ios', 'web') then
    raise exception 'Unsupported platform';
  end if;

  select p.clinic_id
  into v_clinic_id
  from public.profiles p
  where p.id = v_user_id
  limit 1;

  insert into public.capdent_legal_consents (
    user_id,
    clinic_id,
    terms_version,
    privacy_version,
    app_version,
    platform
  )
  values (
    v_user_id,
    v_clinic_id,
    btrim(p_terms_version),
    btrim(p_privacy_version),
    nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
    p_platform
  )
  on conflict (user_id, terms_version, privacy_version)
  do update set
    clinic_id = excluded.clinic_id,
    app_version = coalesce(excluded.app_version, public.capdent_legal_consents.app_version),
    platform = coalesce(excluded.platform, public.capdent_legal_consents.platform)
  returning id, accepted_at into v_id, v_accepted_at;

  return jsonb_build_object(
    'id', v_id,
    'acceptedAt', v_accepted_at,
    'termsVersion', btrim(p_terms_version),
    'privacyVersion', btrim(p_privacy_version)
  );
end;
$$;

revoke all on function public.record_capdent_legal_consent(text, text, text, text)
  from public, anon;
grant execute on function public.record_capdent_legal_consent(text, text, text, text)
  to authenticated;

create or replace function public.get_capdent_entitlements_v25()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_base jsonb;
  v_clinic_id uuid;
  v_plan_code text;
  v_upload_limit integer;
  v_upload_count integer := 0;
  v_storage_limit bigint := 0;
  v_storage_used bigint := 0;
  v_upload_global boolean := false;
  v_storage_global boolean := false;
  v_upload_clinic boolean := false;
  v_storage_clinic boolean := false;
  v_grandfathered boolean := true;
  v_upload_enforced boolean := false;
  v_storage_enforced boolean := false;
  v_remaining_uploads integer;
begin
  v_base := public.get_capdent_entitlements_v2();

  v_clinic_id := nullif(v_base ->> 'clinicId', '')::uuid;
  v_plan_code := coalesce(nullif(v_base ->> 'plan', ''), 'free');

  select pc.upload_limit, pc.storage_limit_bytes
  into v_upload_limit, v_storage_limit
  from public.capdent_plan_catalog pc
  where pc.code = v_plan_code
    and pc.active = true;

  select
    coalesce(cps.upload_limit_enforced, false),
    coalesce(cps.storage_limit_enforced, false),
    coalesce(cps.grandfathered, true)
  into
    v_upload_clinic,
    v_storage_clinic,
    v_grandfathered
  from public.clinic_pricing_settings cps
  where cps.clinic_id = v_clinic_id;

  select coalesce(enabled, false)
  into v_upload_global
  from public.capdent_pricing_flags
  where key = 'upload_limit_enforcement';

  select coalesce(enabled, false)
  into v_storage_global
  from public.capdent_pricing_flags
  where key = 'storage_limit_enforcement';

  v_upload_enforced := coalesce(v_upload_global, false)
    and coalesce(v_upload_clinic, false)
    and not coalesce(v_grandfathered, true);

  v_storage_enforced := coalesce(v_storage_global, false)
    and coalesce(v_storage_clinic, false)
    and not coalesce(v_grandfathered, true);

  select count(*)::integer
  into v_upload_count
  from storage.objects so
  where so.bucket_id in ('prescriptions', 'xrays', 'patient-files')
    and split_part(so.name, '/', 1) = v_clinic_id::text;

  select coalesce(sum(
    case
      when so.metadata is not null
        and so.metadata ? 'size'
        and (so.metadata ->> 'size') ~ '^[0-9]+$'
      then (so.metadata ->> 'size')::bigint
      else 0
    end
  ), 0)
  into v_storage_used
  from storage.objects so
  where so.bucket_id in ('avatars', 'prescriptions', 'xrays', 'patient-files', 'clinic-logos')
    and split_part(so.name, '/', 1) = v_clinic_id::text;

  if v_upload_limit is null then
    v_remaining_uploads := null;
  else
    v_remaining_uploads := greatest(v_upload_limit - v_upload_count, 0);
  end if;

  return v_base || jsonb_build_object(
    'version', 25,
    'uploadCount', v_upload_count,
    'uploadLimit', v_upload_limit,
    'remainingUploads', v_remaining_uploads,
    'uploadLimitEnforced', v_upload_enforced,
    'storageUsedBytes', v_storage_used,
    'storageLimitBytes', v_storage_limit,
    'storageLimitEnforced', v_storage_enforced,
    'canUpload',
      (not v_upload_enforced or v_upload_limit is null or v_upload_count < v_upload_limit)
      and (not v_storage_enforced or v_storage_used < v_storage_limit)
  );
end;
$$;

revoke all on function public.get_capdent_entitlements_v25() from public, anon;
grant execute on function public.get_capdent_entitlements_v25() to authenticated;

comment on function public.get_capdent_entitlements_v25() is
  'CapDent V25 entitlement and usage snapshot. Enforcement remains controlled by global flags plus per-clinic settings and grandfathering.';

commit;
