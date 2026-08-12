alter table public.appointments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create index if not exists appointments_clinic_time_idx
  on public.appointments (clinic_id, appointment_time);

create table if not exists public.appointment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists appointment_audit_logs_clinic_created_idx
  on public.appointment_audit_logs (clinic_id, created_at desc);
create index if not exists appointment_audit_logs_appointment_created_idx
  on public.appointment_audit_logs (appointment_id, created_at desc);

alter table public.appointment_audit_logs enable row level security;

drop policy if exists appointment_audit_logs_select_same_clinic on public.appointment_audit_logs;
create policy appointment_audit_logs_select_same_clinic
  on public.appointment_audit_logs
  for select
  to authenticated
  using (clinic_id = public.current_user_clinic_id());

drop policy if exists appointment_audit_logs_insert_same_clinic on public.appointment_audit_logs;
create policy appointment_audit_logs_insert_same_clinic
  on public.appointment_audit_logs
  for insert
  to authenticated
  with check (clinic_id = public.current_user_clinic_id());

create or replace function public.admin_create_appointment(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_appointment_time timestamptz,
  p_notes text,
  p_reason text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_appointment public.appointments;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can create appointments from Clinic Admin.' using errcode = '42501';
  end if;

  if p_appointment_time is null then
    raise exception 'Appointment date and time are required.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A creation reason is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  if not exists (
    select 1 from public.patients
    where id = p_patient_id
      and clinic_id = v_clinic_id
      and archived_at is null
  ) then
    raise exception 'The selected active patient was not found in your clinic.' using errcode = 'P0002';
  end if;

  if p_doctor_id is not null and not exists (
    select 1 from public.profiles
    where id = p_doctor_id
      and clinic_id = v_clinic_id
      and active = true
      and role in ('owner', 'head_doctor', 'doctor', 'working_doctor')
  ) then
    raise exception 'The selected doctor is not active in your clinic.' using errcode = '22023';
  end if;

  insert into public.appointments (
    clinic_id,
    patient_id,
    doctor_id,
    appointment_time,
    status,
    notes,
    created_by,
    updated_by
  )
  values (
    v_clinic_id,
    p_patient_id,
    p_doctor_id,
    p_appointment_time,
    'scheduled',
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  returning * into v_appointment;

  insert into public.appointment_audit_logs (
    clinic_id, appointment_id, changed_by, action, field_name, old_value, new_value, reason
  ) values (
    v_clinic_id,
    v_appointment.id,
    auth.uid(),
    'created',
    'appointment',
    null,
    concat('patient=', p_patient_id::text, '; doctor=', coalesce(p_doctor_id::text, 'unassigned'), '; time=', p_appointment_time::text, '; status=scheduled'),
    trim(p_reason)
  );

  return v_appointment;
end;
$$;

create or replace function public.admin_update_appointment(
  p_appointment_id uuid,
  p_patient_id uuid,
  p_doctor_id uuid,
  p_appointment_time timestamptz,
  p_status text,
  p_notes text,
  p_reason text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old public.appointments;
  v_new public.appointments;
  v_status text;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can modify appointments.' using errcode = '42501';
  end if;

  if p_appointment_time is null then
    raise exception 'Appointment date and time are required.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A modification reason is required.' using errcode = '22023';
  end if;

  v_status := lower(trim(coalesce(p_status, '')));
  if v_status not in ('scheduled', 'waiting', 'completed', 'cancelled', 'no_show') then
    raise exception 'Unsupported appointment status.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_old
  from public.appointments
  where id = p_appointment_id
    and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Appointment was not found in your clinic.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.patients
    where id = p_patient_id
      and clinic_id = v_clinic_id
  ) then
    raise exception 'The selected patient was not found in your clinic.' using errcode = 'P0002';
  end if;

  if p_doctor_id is not null and not exists (
    select 1 from public.profiles
    where id = p_doctor_id
      and clinic_id = v_clinic_id
      and active = true
      and role in ('owner', 'head_doctor', 'doctor', 'working_doctor')
  ) then
    raise exception 'The selected doctor is not active in your clinic.' using errcode = '22023';
  end if;

  update public.appointments
  set
    patient_id = p_patient_id,
    doctor_id = p_doctor_id,
    appointment_time = p_appointment_time,
    status = v_status,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    reminder_status = case
      when v_old.appointment_time is distinct from p_appointment_time then 'pending'
      else reminder_status
    end,
    reminder_sent_at = case
      when v_old.appointment_time is distinct from p_appointment_time then null
      else reminder_sent_at
    end,
    reminder_status_at = case
      when v_old.appointment_time is distinct from p_appointment_time then now()
      else reminder_status_at
    end,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_appointment_id
  returning * into v_new;

  insert into public.appointment_audit_logs (
    clinic_id, appointment_id, changed_by, action, field_name, old_value, new_value, reason
  )
  select
    v_clinic_id,
    p_appointment_id,
    auth.uid(),
    case changed.field_name
      when 'appointment_time' then 'rescheduled'
      when 'status' then 'status_changed'
      when 'doctor_id' then 'doctor_changed'
      when 'patient_id' then 'patient_changed'
      else 'updated'
    end,
    changed.field_name,
    changed.old_value,
    changed.new_value,
    trim(p_reason)
  from (
    values
      ('patient_id', v_old.patient_id::text, v_new.patient_id::text),
      ('doctor_id', v_old.doctor_id::text, v_new.doctor_id::text),
      ('appointment_time', v_old.appointment_time::text, v_new.appointment_time::text),
      ('status', v_old.status::text, v_new.status::text),
      ('notes', v_old.notes::text, v_new.notes::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  return v_new;
end;
$$;

revoke all on function public.admin_create_appointment(uuid, uuid, timestamptz, text, text) from public;
grant execute on function public.admin_create_appointment(uuid, uuid, timestamptz, text, text) to authenticated;

revoke all on function public.admin_update_appointment(uuid, uuid, uuid, timestamptz, text, text, text) from public;
grant execute on function public.admin_update_appointment(uuid, uuid, uuid, timestamptz, text, text, text) to authenticated;
