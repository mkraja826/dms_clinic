-- =========================================================
-- MDMS latest app direct table compatibility
-- App version inspected reads/writes these tables directly:
-- patients, appointments, medical_history, patient_visits,
-- treatments, files, invoices, payments, patient_audit_logs.
-- This migration keeps the pilot APK working without app reinstall.
-- =========================================================

-- 1) Files: app supports report/other, remove old restrictive check if still present.
alter table public.files drop constraint if exists files_type_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.files'::regclass
      and conname = 'files_file_type_check'
  ) then
    alter table public.files
      add constraint files_file_type_check
      check (file_type = any (array['before_photo','after_photo','xray','prescription','report','other']::text[]));
  end if;
end $$;

-- 2) Make patient/appointment direct operations work for same clinic users.
alter table public.patients enable row level security;
alter table public.appointments enable row level security;

drop policy if exists patients_all_own_clinic on public.patients;
create policy patients_all_own_clinic
on public.patients
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists appointments_all_own_clinic on public.appointments;
create policy appointments_all_own_clinic
on public.appointments
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

grant select, insert, update, delete on public.patients to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;

-- 3) medical_history: app creates rows after patient insert and may omit clinic_id.
-- Fill clinic_id before RLS checks, then allow same clinic operations.
create or replace function public.set_medical_history_clinic_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinic_id is null then
    select p.clinic_id
    into new.clinic_id
    from public.patients p
    where p.id = new.patient_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_medical_history_clinic_id on public.medical_history;
create trigger trg_set_medical_history_clinic_id
before insert or update on public.medical_history
for each row
execute function public.set_medical_history_clinic_id();

alter table public.medical_history enable row level security;
drop policy if exists medical_history_all_own_clinic_latest on public.medical_history;
create policy medical_history_all_own_clinic_latest
on public.medical_history
for all
to authenticated
using (
  clinic_id = public.current_user_clinic_id()
  or exists (
    select 1 from public.patients p
    where p.id = medical_history.patient_id
      and p.clinic_id = public.current_user_clinic_id()
  )
)
with check (
  clinic_id = public.current_user_clinic_id()
  or exists (
    select 1 from public.patients p
    where p.id = medical_history.patient_id
      and p.clinic_id = public.current_user_clinic_id()
  )
);

grant select, insert, update, delete on public.medical_history to authenticated;

-- 4) Ensure core direct app tables have same-clinic full policies.
alter table public.patient_visits enable row level security;
alter table public.treatments enable row level security;
alter table public.files enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.patient_audit_logs enable row level security;

drop policy if exists patient_visits_all_own_clinic_latest on public.patient_visits;
create policy patient_visits_all_own_clinic_latest
on public.patient_visits
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists treatments_all_own_clinic_latest on public.treatments;
create policy treatments_all_own_clinic_latest
on public.treatments
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists files_all_own_clinic_latest on public.files;
create policy files_all_own_clinic_latest
on public.files
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists invoices_all_own_clinic_latest on public.invoices;
create policy invoices_all_own_clinic_latest
on public.invoices
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists payments_all_own_clinic_latest on public.payments;
create policy payments_all_own_clinic_latest
on public.payments
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

drop policy if exists patient_audit_logs_all_own_clinic_latest on public.patient_audit_logs;
create policy patient_audit_logs_all_own_clinic_latest
on public.patient_audit_logs
for all
to authenticated
using (clinic_id = public.current_user_clinic_id())
with check (clinic_id = public.current_user_clinic_id());

grant select, insert, update, delete on public.patient_visits to authenticated;
grant select, insert, update, delete on public.treatments to authenticated;
grant select, insert, update, delete on public.files to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.patient_audit_logs to authenticated;

-- 5) Harden helper functions from anon direct RPC execution, without affecting app-authenticated use.
revoke execute on function public.current_user_clinic_id() from anon;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.current_user_is_owner() from anon;
revoke execute on function public.current_clinic_id() from anon;
revoke execute on function public."current_role"() from anon;
revoke execute on function public.can_manage(text) from anon;

-- 6) Keep existing open queue compatible with app dashboard waiting filters.
update public.appointments ap
set doctor_id = null
where lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked');

notify pgrst, 'reload schema';
