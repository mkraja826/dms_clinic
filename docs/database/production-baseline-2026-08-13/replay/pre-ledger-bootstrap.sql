-- CapDent production baseline replay bootstrap.
--
-- REPLAY ONLY. This is not a production migration and must never be copied into
-- supabase/migrations or applied to a linked project. It reconstructs objects
-- that already existed before (or outside) the 73-entry production ledger so
-- the authoritative statements can be tested from an empty local database.

do $capdent_replay_guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'capdent_v25_replay_sentinel'
      and rolcanlogin = false
      and rolinherit = false
  ) then
    raise exception 'CapDent replay sentinel is missing; refusing bootstrap.';
  end if;
end
$capdent_replay_guard$;

create extension if not exists pgcrypto;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  logo_url text,
  brand_color text default '#0F766E',
  active boolean default true,
  enable_patient_photos boolean not null default false,
  enable_prescription_medications boolean not null default false
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null constraint profiles_role_check check (
    role in ('owner', 'head_doctor', 'doctor', 'working_doctor', 'receptionist')
  ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  invite_code text,
  phone text
);

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  email text,
  name text not null,
  role text not null constraint staff_invites_role_check check (
    role in ('doctor', 'working_doctor', 'receptionist')
  ),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  invite_code text unique,
  unique (clinic_id, email)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_code text,
  name text not null,
  gender text,
  dob date,
  phone text,
  email text,
  address text,
  emergency_contact text,
  created_at timestamptz not null default now(),
  age integer constraint patients_age_check check (
    age is null or (age >= 0 and age <= 130)
  ),
  photo_url text
);

create table public.medical_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  heart_issue boolean not null default false,
  kidney_issue boolean not null default false,
  brain_issue boolean not null default false,
  diabetes boolean not null default false,
  blood_pressure boolean not null default false,
  allergies text,
  current_medicines text,
  other_notes text,
  created_at timestamptz not null default now(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  updated_at timestamptz default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete set null,
  appointment_time timestamptz not null,
  status text not null default 'scheduled' constraint appointments_status_check check (
    status in (
      'scheduled', 'waiting', 'checked_in', 'booked', 'completed', 'done',
      'cancelled', 'canceled', 'no_show', 'followup', 'reminded'
    )
  ),
  notes text,
  created_at timestamptz not null default now(),
  reminder_status text not null default 'pending'
    constraint appointments_reminder_status_check check (
      reminder_status in (
        'pending', 'message_sent', 'patient_confirmed', 'not_reachable', 'completed'
      )
    ),
  reminder_sent_at timestamptz,
  reminder_status_at timestamptz,
  op_fee_amount numeric not null default 0,
  op_fee_status text not null default 'pending'
    constraint appointments_op_fee_status_check check (
      op_fee_status in ('paid', 'pending', 'waived')
    ),
  op_fee_waiver_reason text,
  op_fee_waived_by uuid references public.profiles(id) on delete set null,
  op_fee_waived_at timestamptz
);

create table public.patient_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete set null,
  visit_date timestamptz not null default now(),
  chief_complaint text,
  diagnosis text,
  doctor_notes text,
  next_appointment_date timestamptz,
  created_at timestamptz not null default now(),
  visit_status text default 'completed'
);

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_name text not null,
  description text,
  cost numeric not null default 0,
  status text not null default 'planned' constraint treatments_status_check check (
    status in ('planned', 'ongoing', 'completed', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  category text
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  file_type text not null,
  file_url text not null,
  file_name text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  file_note text,
  xray_amount numeric not null default 0,
  xray_fee_status text not null default 'not_applicable'
    constraint files_xray_fee_status_check check (
      xray_fee_status in ('not_applicable', 'pending', 'paid', 'waived')
    )
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  total_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  due_amount numeric not null default 0,
  status text not null default 'unpaid' constraint invoices_status_check check (
    status in ('unpaid', 'partial', 'paid')
  ),
  created_at timestamptz not null default now(),
  invoice_type text,
  payment_category text not null default 'treatment_fee'
    constraint invoices_payment_category_check check (
      payment_category in (
        'op_fee', 'xray_fee', 'medication_fee', 'treatment_fee',
        'pending_collection', 'other'
      )
    ),
  notes text
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  amount numeric not null,
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  payment_category text not null default 'pending_collection'
    constraint payments_payment_category_check check (
      payment_category in (
        'op_fee', 'xray_fee', 'medication_fee', 'treatment_fee',
        'pending_collection', 'other'
      )
    ),
  collected_by uuid references public.profiles(id)
);

create table public.patient_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  title text not null,
  amount numeric not null default 0,
  payment_status text default 'pending' constraint charges_payment_status_check check (
    payment_status in ('pending', 'partial', 'paid')
  ),
  created_at timestamptz default now()
);

create table public.clinic_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references public.clinics(id) on delete cascade,
  plan_name text not null default 'free',
  status text not null default 'free' constraint clinic_subscriptions_status_check check (
    status in ('free', 'trial', 'active', 'expired', 'cancelled', 'grace_period')
  ),
  trial_started_at timestamptz default now(),
  trial_ends_at timestamptz default (now() + interval '3 months'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  monthly_price numeric not null default 0,
  visit_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  billing_provider text not null default 'manual'
    constraint clinic_subscriptions_billing_provider_check check (
      billing_provider in ('google_play', 'manual')
    ),
  google_play_product_id text,
  google_play_purchase_token text,
  google_play_order_id text,
  google_play_auto_renewing boolean not null default false,
  google_play_status text not null default 'not_started'
    constraint clinic_subscriptions_google_play_status_check check (
      google_play_status in (
        'not_started', 'trial_started', 'active', 'grace_period',
        'account_hold', 'expired', 'cancelled', 'pending_verification'
      )
    ),
  google_play_linked_at timestamptz,
  google_play_last_event_at timestamptz,
  google_play_last_verified_at timestamptz
);

create table public.google_play_subscription_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  subscription_id uuid references public.clinic_subscriptions(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null default 'client_purchase',
  product_id text not null,
  purchase_token text not null,
  order_id text,
  auto_renewing boolean not null default true,
  raw_purchase jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.medication_catalog (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  usage_count integer not null default 1,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, normalized_name)
);

create table public.patient_medications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  medication_name text not null,
  dosage text,
  frequency text,
  duration text,
  instructions text,
  prescribed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.website_appointments (
  id uuid primary key default gen_random_uuid(),
  patient_name text not null,
  phone text not null,
  treatment text,
  preferred_date date,
  preferred_time text,
  message text,
  status text not null default 'new',
  source text not null default 'website',
  created_at timestamptz not null default now()
);

alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.patients enable row level security;
alter table public.medical_history enable row level security;
alter table public.appointments enable row level security;
alter table public.patient_visits enable row level security;
alter table public.treatments enable row level security;
alter table public.files enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.patient_audit_logs enable row level security;
alter table public.charges enable row level security;
alter table public.clinic_subscriptions enable row level security;
alter table public.google_play_subscription_events enable row level security;
alter table public.medication_catalog enable row level security;
alter table public.patient_medications enable row level security;
alter table public.website_appointments enable row level security;

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('clinic-logos', 'clinic-logos', true),
  ('patient-files', 'patient-files', true),
  ('prescriptions', 'prescriptions', true),
  ('xrays', 'xrays', true)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

create or replace function public.current_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select clinic_id
  from public.profiles
  where id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.can_manage(resource text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() = 'owner' then true
    when public.current_role() = 'doctor'
      and resource in ('appointments', 'visits', 'treatments', 'files') then true
    when public.current_role() = 'receptionist'
      and resource in ('patients', 'appointments', 'invoices', 'payments') then true
    else false
  end
$$;

create or replace function public.current_profile_clinic_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.clinic_id
  from public.profiles p
  where p.id = auth.uid() and p.active = true
  limit 1
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role::text
  from public.profiles p
  where p.id = auth.uid() and p.active = true
  limit 1
$$;

create or replace function public.current_user_is_head_doctor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role in ('head_doctor', 'owner')
      from public.profiles
      where id = auth.uid() and active = true
      limit 1
    ),
    false
  )
$$;

create or replace function public.generate_invite_code()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  code text;
begin
  code := 'DMS-' || upper(substr(md5(random()::text), 1, 6));
  return code;
end;
$$;

create or replace function public.invoice_status(total numeric, paid numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(paid, 0) <= 0 then 'unpaid'
    when coalesce(paid, 0) >= coalesce(total, 0) then 'paid'
    else 'partial'
  end
$$;

create or replace function public.apply_dms_clinic_isolation_policy(
  p_table_name text,
  p_clinic_column text default 'clinic_id'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_name text := 'dms_clinic_isolation_' || p_table_name;
begin
  if to_regclass('public.' || p_table_name) is null then
    return;
  end if;

  execute format('alter table public.%I enable row level security', p_table_name);
  execute format('drop policy if exists %I on public.%I', policy_name, p_table_name);
  execute format(
    'create policy %I on public.%I as restrictive for all to authenticated using (%I = public.current_profile_clinic_id()) with check (%I = public.current_profile_clinic_id())',
    policy_name,
    p_table_name,
    p_clinic_column,
    p_clinic_column
  );
end;
$$;

create or replace function public.create_staff_invite(
  invitee_name text,
  invitee_email text default null,
  invitee_role text default 'working_doctor'
)
returns public.staff_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_profile public.profiles;
  saved_invite public.staff_invites;
  normalized_role text;
  clean_email text;
  new_invite_code text;
begin
  select * into owner_profile
  from public.profiles
  where id = auth.uid() and active = true
  limit 1;

  if owner_profile.id is null then
    raise exception 'Profile not found for current user';
  end if;

  if owner_profile.role not in ('owner', 'head_doctor') then
    raise exception 'Only the clinic owner can invite staff';
  end if;

  normalized_role := case
    when invitee_role = 'doctor' then 'working_doctor'
    else invitee_role
  end;

  if normalized_role not in ('working_doctor', 'receptionist') then
    raise exception 'Staff role must be working_doctor or receptionist';
  end if;

  clean_email := nullif(lower(trim(coalesce(invitee_email, ''))), '');

  if clean_email is not null and exists (
    select 1
    from public.profiles
    where clinic_id = owner_profile.clinic_id and lower(email) = clean_email
  ) then
    raise exception 'This staff email already belongs to your clinic';
  end if;

  loop
    new_invite_code := 'DMS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.staff_invites where invite_code = new_invite_code
    );
  end loop;

  if clean_email is not null then
    insert into public.staff_invites (
      clinic_id, email, name, role, invited_by, accepted_at, invite_code
    ) values (
      owner_profile.clinic_id, clean_email, trim(invitee_name), normalized_role,
      owner_profile.id, null, new_invite_code
    )
    on conflict (clinic_id, email) do update
    set name = excluded.name,
        role = excluded.role,
        invited_by = excluded.invited_by,
        accepted_at = null,
        invite_code = excluded.invite_code,
        created_at = now()
    returning * into saved_invite;
  else
    insert into public.staff_invites (
      clinic_id, email, name, role, invited_by, accepted_at, invite_code
    ) values (
      owner_profile.clinic_id, null, trim(invitee_name), normalized_role,
      owner_profile.id, null, new_invite_code
    )
    returning * into saved_invite;
  end if;

  return saved_invite;
end;
$$;

create or replace function public.owner_update_staff_access(
  p_staff_id uuid,
  p_staff_role text default null,
  p_staff_active boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  updated_profile public.profiles;
  normalized_role text;
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid() and active = true;

  if actor.id is null or actor.clinic_id is null then
    raise exception 'Active clinic profile not found';
  end if;

  if actor.role not in ('owner', 'head_doctor') then
    raise exception 'Only clinic owner can manage staff access';
  end if;

  if p_staff_id = auth.uid() then
    raise exception 'You cannot change your own owner access';
  end if;

  if p_staff_role is not null then
    normalized_role := case
      when p_staff_role = 'doctor' then 'working_doctor'
      else p_staff_role
    end;

    if normalized_role not in ('working_doctor', 'receptionist') then
      raise exception 'Invalid staff role';
    end if;
  end if;

  update public.profiles
  set role = coalesce(normalized_role, role),
      active = coalesce(p_staff_active, active)
  where id = p_staff_id
    and clinic_id = actor.clinic_id
    and role not in ('owner', 'head_doctor')
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Staff member not found or owner access cannot be changed';
  end if;

  return updated_profile;
end;
$$;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception
        when others then null;
      end;
    end if;
  end loop;
end;
$$;
