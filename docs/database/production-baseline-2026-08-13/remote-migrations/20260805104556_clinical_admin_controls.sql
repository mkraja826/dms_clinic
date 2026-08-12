alter table public.patient_visits
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

alter table public.treatments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create table if not exists public.clinical_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint clinical_audit_target_type_check check (target_type in ('visit', 'treatment', 'dental_chart_entry'))
);

create index if not exists clinical_audit_logs_clinic_created_idx
  on public.clinical_audit_logs (clinic_id, created_at desc);
create index if not exists clinical_audit_logs_visit_created_idx
  on public.clinical_audit_logs (visit_id, created_at desc);
create index if not exists clinical_audit_logs_patient_created_idx
  on public.clinical_audit_logs (patient_id, created_at desc);

alter table public.clinical_audit_logs enable row level security;

drop policy if exists clinical_audit_logs_select_same_clinic on public.clinical_audit_logs;
create policy clinical_audit_logs_select_same_clinic
  on public.clinical_audit_logs
  for select
  to authenticated
  using (clinic_id = public.current_user_clinic_id());

drop policy if exists clinical_audit_logs_insert_same_clinic on public.clinical_audit_logs;
create policy clinical_audit_logs_insert_same_clinic
  on public.clinical_audit_logs
  for insert
  to authenticated
  with check (clinic_id = public.current_user_clinic_id());

grant select, insert on public.clinical_audit_logs to authenticated;

create or replace function public.admin_update_clinical_visit(
  p_visit_id uuid,
  p_doctor_id uuid,
  p_visit_date timestamptz,
  p_chief_complaint text,
  p_diagnosis text,
  p_doctor_notes text,
  p_next_appointment_date timestamptz,
  p_reason text
)
returns public.patient_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old public.patient_visits;
  v_new public.patient_visits;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can modify clinical visits.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A clinical modification reason is required.' using errcode = '22023';
  end if;

  if p_visit_date is null then
    raise exception 'Visit date is required.' using errcode = '22023';
  end if;

  if char_length(coalesce(p_chief_complaint, '')) > 2000
     or char_length(coalesce(p_diagnosis, '')) > 2000
     or char_length(coalesce(p_doctor_notes, '')) > 4000 then
    raise exception 'One or more clinical text fields exceed the allowed length.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_old
  from public.patient_visits
  where id = p_visit_id
    and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Visit was not found in your clinic.' using errcode = 'P0002';
  end if;

  if p_doctor_id is not null and not exists (
    select 1
    from public.profiles
    where id = p_doctor_id
      and clinic_id = v_clinic_id
      and active = true
      and role in ('owner', 'head_doctor', 'doctor', 'working_doctor')
  ) then
    raise exception 'The selected doctor is not active in your clinic.' using errcode = '22023';
  end if;

  update public.patient_visits
  set
    doctor_id = p_doctor_id,
    visit_date = p_visit_date,
    chief_complaint = nullif(trim(coalesce(p_chief_complaint, '')), ''),
    diagnosis = nullif(trim(coalesce(p_diagnosis, '')), ''),
    doctor_notes = nullif(trim(coalesce(p_doctor_notes, '')), ''),
    next_appointment_date = p_next_appointment_date,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_visit_id
  returning * into v_new;

  insert into public.clinical_audit_logs (
    clinic_id, patient_id, visit_id, target_type, target_id,
    changed_by, action, field_name, old_value, new_value, reason
  )
  select
    v_clinic_id,
    v_old.patient_id,
    p_visit_id,
    'visit',
    p_visit_id,
    auth.uid(),
    case when changed.field_name = 'doctor_id' then 'doctor_reassigned' else 'visit_updated' end,
    changed.field_name,
    changed.old_value,
    changed.new_value,
    trim(p_reason)
  from (
    values
      ('doctor_id', v_old.doctor_id::text, v_new.doctor_id::text),
      ('visit_date', v_old.visit_date::text, v_new.visit_date::text),
      ('chief_complaint', v_old.chief_complaint::text, v_new.chief_complaint::text),
      ('diagnosis', v_old.diagnosis::text, v_new.diagnosis::text),
      ('doctor_notes', v_old.doctor_notes::text, v_new.doctor_notes::text),
      ('next_appointment_date', v_old.next_appointment_date::text, v_new.next_appointment_date::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  return v_new;
end;
$$;

create or replace function public.admin_update_clinical_treatment(
  p_treatment_id uuid,
  p_treatment_name text,
  p_description text,
  p_category text,
  p_status text,
  p_reason text
)
returns public.treatments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old public.treatments;
  v_new public.treatments;
  v_status text;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can modify treatments.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A treatment modification reason is required.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_treatment_name, ''))) = 0
     or char_length(trim(p_treatment_name)) > 160 then
    raise exception 'Treatment name is required and must be at most 160 characters.' using errcode = '22023';
  end if;

  if char_length(coalesce(p_description, '')) > 2000
     or char_length(coalesce(p_category, '')) > 120 then
    raise exception 'Treatment description or category is too long.' using errcode = '22023';
  end if;

  v_status := lower(trim(coalesce(p_status, '')));
  if v_status not in ('planned', 'ongoing', 'completed') then
    raise exception 'Treatment status must be planned, ongoing or completed.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_old
  from public.treatments
  where id = p_treatment_id
    and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Treatment was not found in your clinic.' using errcode = 'P0002';
  end if;

  update public.treatments
  set
    treatment_name = trim(p_treatment_name),
    description = nullif(trim(coalesce(p_description, '')), ''),
    category = nullif(trim(coalesce(p_category, '')), ''),
    status = v_status,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_treatment_id
  returning * into v_new;

  insert into public.clinical_audit_logs (
    clinic_id, patient_id, visit_id, target_type, target_id,
    changed_by, action, field_name, old_value, new_value, reason
  )
  select
    v_clinic_id,
    v_old.patient_id,
    v_old.visit_id,
    'treatment',
    p_treatment_id,
    auth.uid(),
    case when changed.field_name = 'status' then 'treatment_status_changed' else 'treatment_updated' end,
    changed.field_name,
    changed.old_value,
    changed.new_value,
    trim(p_reason)
  from (
    values
      ('treatment_name', v_old.treatment_name::text, v_new.treatment_name::text),
      ('description', v_old.description::text, v_new.description::text),
      ('category', v_old.category::text, v_new.category::text),
      ('status', v_old.status::text, v_new.status::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  return v_new;
end;
$$;

create or replace function public.admin_add_dental_chart_correction(
  p_visit_id uuid,
  p_tooth_code text,
  p_dentition text,
  p_condition text,
  p_surfaces text[],
  p_notes text,
  p_treatment_name text,
  p_treatment_status text,
  p_reason text
)
returns public.dental_chart_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_visit public.patient_visits;
  v_previous public.dental_chart_entries;
  v_new public.dental_chart_entries;
  v_tooth_code text;
  v_dentition text;
  v_condition text;
  v_treatment_status text;
  v_surfaces text[];
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can add chart corrections.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A chart correction reason is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();
  v_tooth_code := trim(coalesce(p_tooth_code, ''));
  v_dentition := lower(trim(coalesce(p_dentition, '')));
  v_condition := lower(trim(coalesce(p_condition, '')));
  v_treatment_status := lower(trim(coalesce(p_treatment_status, '')));

  select * into v_visit
  from public.patient_visits
  where id = p_visit_id
    and clinic_id = v_clinic_id;

  if not found then
    raise exception 'Visit was not found in your clinic.' using errcode = 'P0002';
  end if;

  if v_dentition not in ('permanent', 'primary') then
    raise exception 'Invalid dentition.' using errcode = '22023';
  end if;

  if not (
    (v_dentition = 'permanent' and v_tooth_code ~ '^[1-4][1-8]$')
    or (v_dentition = 'primary' and v_tooth_code ~ '^[5-8][1-5]$')
  ) then
    raise exception 'Invalid FDI tooth code for the selected dentition.' using errcode = '22023';
  end if;

  if v_condition not in (
    'healthy', 'caries', 'filled', 'missing', 'crown',
    'root_canal', 'implant', 'extraction_planned', 'unerupted'
  ) then
    raise exception 'Invalid dental condition.' using errcode = '22023';
  end if;

  if v_treatment_status not in ('planned', 'ongoing', 'completed') then
    raise exception 'Invalid chart treatment status.' using errcode = '22023';
  end if;

  if char_length(coalesce(p_notes, '')) > 1000
     or char_length(coalesce(p_treatment_name, '')) > 160 then
    raise exception 'Chart notes or treatment name are too long.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct surface), '{}'::text[])
  into v_surfaces
  from unnest(coalesce(p_surfaces, '{}'::text[])) as item(surface);

  if not (v_surfaces <@ array['mesial','distal','occlusal','buccal','lingual']::text[])
     or cardinality(v_surfaces) > 5 then
    raise exception 'Invalid dental surface.' using errcode = '22023';
  end if;

  select * into v_previous
  from public.dental_chart_entries
  where clinic_id = v_clinic_id
    and patient_id = v_visit.patient_id
    and tooth_code = v_tooth_code
    and dentition = v_dentition
  order by created_at desc, id desc
  limit 1;

  insert into public.dental_chart_entries (
    clinic_id, patient_id, visit_id, recorded_by, tooth_code, dentition,
    condition, surfaces, notes, treatment_name, treatment_status
  ) values (
    v_clinic_id, v_visit.patient_id, p_visit_id, auth.uid(), v_tooth_code, v_dentition,
    v_condition, v_surfaces, nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_treatment_name, '')), ''), v_treatment_status
  ) returning * into v_new;

  insert into public.clinical_audit_logs (
    clinic_id, patient_id, visit_id, target_type, target_id,
    changed_by, action, field_name, old_value, new_value, reason
  ) values (
    v_clinic_id,
    v_visit.patient_id,
    p_visit_id,
    'dental_chart_entry',
    v_new.id,
    auth.uid(),
    'chart_correction_added',
    concat(v_dentition, ':', v_tooth_code),
    case when v_previous.id is null then null else jsonb_build_object(
      'entry_id', v_previous.id,
      'condition', v_previous.condition,
      'surfaces', v_previous.surfaces,
      'treatment_name', v_previous.treatment_name,
      'treatment_status', v_previous.treatment_status,
      'notes', v_previous.notes
    )::text end,
    jsonb_build_object(
      'entry_id', v_new.id,
      'condition', v_new.condition,
      'surfaces', v_new.surfaces,
      'treatment_name', v_new.treatment_name,
      'treatment_status', v_new.treatment_status,
      'notes', v_new.notes
    )::text,
    trim(p_reason)
  );

  return v_new;
end;
$$;

revoke all on function public.admin_update_clinical_visit(uuid, uuid, timestamptz, text, text, text, timestamptz, text) from public;
grant execute on function public.admin_update_clinical_visit(uuid, uuid, timestamptz, text, text, text, timestamptz, text) to authenticated;

revoke all on function public.admin_update_clinical_treatment(uuid, text, text, text, text, text) from public;
grant execute on function public.admin_update_clinical_treatment(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.admin_add_dental_chart_correction(uuid, text, text, text, text[], text, text, text, text) from public;
grant execute on function public.admin_add_dental_chart_correction(uuid, text, text, text, text[], text, text, text, text) to authenticated;
