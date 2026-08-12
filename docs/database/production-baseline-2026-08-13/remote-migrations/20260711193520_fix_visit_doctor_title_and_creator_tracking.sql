alter table public.patient_visits
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists patient_visits_created_by_idx
on public.patient_visits(created_by);

create or replace function public.is_clinic_doctor(p_profile_id uuid, p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.clinic_id = p_clinic_id
      and p.active = true
      and p.role in ('owner', 'head_doctor', 'working_doctor', 'doctor')
  );
$$;

create or replace function public.set_patient_visit_staff_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if new.created_by is null then
    new.created_by := v_user_id;
  end if;

  -- doctor_id must always be a real doctor/head doctor. Receptionists are only entry staff.
  if new.doctor_id is not null and not public.is_clinic_doctor(new.doctor_id, new.clinic_id) then
    if new.created_by is null then
      new.created_by := new.doctor_id;
    end if;
    new.doctor_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_patient_visit_staff_fields_before_insert on public.patient_visits;
create trigger set_patient_visit_staff_fields_before_insert
before insert on public.patient_visits
for each row execute function public.set_patient_visit_staff_fields();

drop trigger if exists set_patient_visit_staff_fields_before_update on public.patient_visits;
create trigger set_patient_visit_staff_fields_before_update
before update on public.patient_visits
for each row execute function public.set_patient_visit_staff_fields();

-- Preserve who entered older visits before clearing invalid treating doctor values.
update public.patient_visits pv
set created_by = pv.doctor_id
where pv.created_by is null
  and pv.doctor_id is not null;

-- Receptionists should never be stored as treating doctor.
update public.patient_visits pv
set doctor_id = null
from public.profiles p
where pv.doctor_id = p.id
  and p.role not in ('owner', 'head_doctor', 'working_doctor', 'doctor');

-- Normalize doctor profile names so UI prefixes do not become "Dr Dr Name".
update public.profiles
set name = regexp_replace(name, '^\s*Dr\.?\s+', '', 'i')
where role in ('owner', 'head_doctor', 'working_doctor', 'doctor')
  and name ~* '^\s*Dr\.?\s+';
