alter table public.patients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create index if not exists patients_clinic_archived_at_idx
  on public.patients (clinic_id, archived_at);

create or replace function public.admin_update_patient(
  p_patient_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_age integer default null,
  p_gender text default null,
  p_dob date default null,
  p_address text default null,
  p_emergency_contact text default null,
  p_reason text default null
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.patients;
  v_new public.patients;
  v_clinic_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can edit patient records.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A modification reason is required.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Patient name is required.' using errcode = '22023';
  end if;

  if p_age is not null and (p_age < 0 or p_age > 130) then
    raise exception 'Patient age must be between 0 and 130.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select *
  into v_old
  from public.patients
  where id = p_patient_id
    and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Patient was not found in your clinic.' using errcode = 'P0002';
  end if;

  update public.patients
  set
    name = trim(p_name),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    email = nullif(lower(trim(coalesce(p_email, ''))), ''),
    age = p_age,
    gender = nullif(trim(coalesce(p_gender, '')), ''),
    dob = p_dob,
    address = nullif(trim(coalesce(p_address, '')), ''),
    emergency_contact = nullif(trim(coalesce(p_emergency_contact, '')), ''),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_patient_id
  returning * into v_new;

  insert into public.patient_audit_logs
    (clinic_id, patient_id, changed_by, field_name, old_value, new_value, reason)
  select
    v_clinic_id,
    p_patient_id,
    auth.uid(),
    changed.field_name,
    changed.old_value,
    changed.new_value,
    trim(p_reason)
  from (
    values
      ('name', v_old.name::text, v_new.name::text),
      ('phone', v_old.phone::text, v_new.phone::text),
      ('email', v_old.email::text, v_new.email::text),
      ('age', v_old.age::text, v_new.age::text),
      ('gender', v_old.gender::text, v_new.gender::text),
      ('dob', v_old.dob::text, v_new.dob::text),
      ('address', v_old.address::text, v_new.address::text),
      ('emergency_contact', v_old.emergency_contact::text, v_new.emergency_contact::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  return v_new;
end;
$$;

create or replace function public.admin_set_patient_archived(
  p_patient_id uuid,
  p_archived boolean,
  p_reason text
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.patients;
  v_new public.patients;
  v_clinic_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can archive patient records.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'An archive or restore reason is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select *
  into v_old
  from public.patients
  where id = p_patient_id
    and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Patient was not found in your clinic.' using errcode = 'P0002';
  end if;

  update public.patients
  set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then auth.uid() else null end,
    archive_reason = case when p_archived then trim(p_reason) else null end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_patient_id
  returning * into v_new;

  if (v_old.archived_at is null) is distinct from (v_new.archived_at is null) then
    insert into public.patient_audit_logs
      (clinic_id, patient_id, changed_by, field_name, old_value, new_value, reason)
    values
      (
        v_clinic_id,
        p_patient_id,
        auth.uid(),
        'archive_status',
        case when v_old.archived_at is null then 'active' else 'archived' end,
        case when v_new.archived_at is null then 'active' else 'archived' end,
        trim(p_reason)
      );
  end if;

  return v_new;
end;
$$;

revoke all on function public.admin_update_patient(uuid, text, text, text, integer, text, date, text, text, text) from public;
grant execute on function public.admin_update_patient(uuid, text, text, text, integer, text, date, text, text, text) to authenticated;

revoke all on function public.admin_set_patient_archived(uuid, boolean, text) from public;
grant execute on function public.admin_set_patient_archived(uuid, boolean, text) to authenticated;
