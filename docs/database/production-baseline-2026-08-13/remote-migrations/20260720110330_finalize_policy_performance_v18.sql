-- Remove the final overlapping application RLS policies while preserving the
-- same clinic visibility and intended mutation paths.

begin;

-- Medical history rows are fully clinic-owned. The clinic_id trigger/backfill
-- is already active and production currently has no NULL clinic_id rows.
drop policy if exists dms_clinic_isolation_medical_history on public.medical_history;
drop policy if exists medical_history_all_own_clinic on public.medical_history;
drop policy if exists medical_history_all_own_clinic_latest on public.medical_history;
drop policy if exists "owners receptionists manage medical history" on public.medical_history;
drop policy if exists "clinic members read medical history" on public.medical_history;

create policy medical_history_all_own_clinic
on public.medical_history for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- The ALL policy already includes SELECT, so the read-only duplicate adds work
-- to every medication lookup without changing authorization.
drop policy if exists "clinic members read medication catalog" on public.medication_catalog;
drop policy if exists "clinic members manage medication catalog" on public.medication_catalog;
create policy "clinic members manage medication catalog"
on public.medication_catalog for all to authenticated
using (clinic_id = (select public.current_clinic_id()))
with check (clinic_id = (select public.current_clinic_id()));

-- Audit logs are append-only for clients: clinic members may read and insert,
-- but cannot alter or delete historical entries directly.
drop policy if exists dms_clinic_isolation_patient_audit_logs on public.patient_audit_logs;
drop policy if exists patient_audit_logs_all_own_clinic_latest on public.patient_audit_logs;
drop policy if exists "clinic members insert patient audit logs" on public.patient_audit_logs;
drop policy if exists "clinic members read patient audit logs" on public.patient_audit_logs;

create policy patient_audit_logs_select_same_clinic
on public.patient_audit_logs for select to authenticated
using (clinic_id = (select public.current_user_clinic_id()));

create policy patient_audit_logs_insert_same_clinic
on public.patient_audit_logs for insert to authenticated
with check (clinic_id = (select public.current_user_clinic_id()));

-- Merge owner and self-update rules to avoid evaluating two permissive policies
-- while retaining exactly the same allowed row set.
drop policy if exists profiles_update_owner_safe on public.profiles;
drop policy if exists profiles_update_self_safe on public.profiles;
drop policy if exists profiles_update_owner_or_self on public.profiles;

create policy profiles_update_owner_or_self
on public.profiles for update to authenticated
using (
  id = (select auth.uid())
  or (
    (select public.current_user_is_owner())
    and clinic_id = (select public.current_user_clinic_id())
  )
)
with check (
  id = (select auth.uid())
  or (
    (select public.current_user_is_owner())
    and clinic_id = (select public.current_user_clinic_id())
  )
);

commit;
