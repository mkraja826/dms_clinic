-- Replace overlapping permissive policies with one clinic-scoped policy per
-- core workflow table. Existing effective CRUD access remains the same.

begin;

-- Appointments
drop policy if exists dms_clinic_isolation_appointments on public.appointments;
drop policy if exists appointments_select_same_clinic_safe on public.appointments;
drop policy if exists appointments_all_own_clinic on public.appointments;
create policy appointments_all_own_clinic
on public.appointments for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Clinical file records
drop policy if exists dms_clinic_isolation_files on public.files;
drop policy if exists "owners doctors manage files" on public.files;
drop policy if exists "clinic members delete files" on public.files;
drop policy if exists "clinic members insert files" on public.files;
drop policy if exists "clinic members read files" on public.files;
drop policy if exists "clinic members update files" on public.files;
drop policy if exists files_all_own_clinic on public.files;
create policy files_all_own_clinic
on public.files for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Invoices
drop policy if exists dms_clinic_isolation_invoices on public.invoices;
drop policy if exists "owners receptionists manage invoices" on public.invoices;
drop policy if exists "clinic members read invoices" on public.invoices;
drop policy if exists invoices_all_own_clinic on public.invoices;
create policy invoices_all_own_clinic
on public.invoices for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Visits
drop policy if exists dms_clinic_isolation_patient_visits on public.patient_visits;
drop policy if exists "owners doctors manage visits" on public.patient_visits;
drop policy if exists "clinic members read visits" on public.patient_visits;
drop policy if exists patient_visits_all_own_clinic on public.patient_visits;
create policy patient_visits_all_own_clinic
on public.patient_visits for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Patients
drop policy if exists dms_clinic_isolation_patients on public.patients;
drop policy if exists patients_select_same_clinic_safe on public.patients;
drop policy if exists patients_all_own_clinic on public.patients;
create policy patients_all_own_clinic
on public.patients for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Payments
drop policy if exists dms_clinic_isolation_payments on public.payments;
drop policy if exists "owners receptionists manage payments" on public.payments;
drop policy if exists "clinic members read payments" on public.payments;
drop policy if exists payments_all_own_clinic on public.payments;
create policy payments_all_own_clinic
on public.payments for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Treatments
drop policy if exists dms_clinic_isolation_treatments on public.treatments;
drop policy if exists "owners doctors manage treatments" on public.treatments;
drop policy if exists "clinic members read treatments" on public.treatments;
drop policy if exists treatments_all_own_clinic on public.treatments;
create policy treatments_all_own_clinic
on public.treatments for all to authenticated
using (clinic_id = (select public.current_user_clinic_id()))
with check (clinic_id = (select public.current_user_clinic_id()));

-- Profiles previously had a broad ALL policy that bypassed the intended
-- owner/self update rules. Keep clinic read access, but restrict updates.
drop policy if exists dms_clinic_isolation_profiles on public.profiles;
drop policy if exists profiles_select_safe on public.profiles;
drop policy if exists profiles_update_owner_safe on public.profiles;
drop policy if exists profiles_update_self_safe on public.profiles;

create policy profiles_select_safe
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or clinic_id = (select public.current_user_clinic_id())
);

create policy profiles_update_owner_safe
on public.profiles for update to authenticated
using (
  (select public.current_user_is_owner())
  and clinic_id = (select public.current_user_clinic_id())
)
with check (
  (select public.current_user_is_owner())
  and clinic_id = (select public.current_user_clinic_id())
);

create policy profiles_update_self_safe
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Staff invite mutations are owner/head-doctor operations. App creation and
-- acceptance use audited SECURITY DEFINER RPCs; direct reads remain pending-only.
drop policy if exists dms_clinic_isolation_staff_invites on public.staff_invites;
drop policy if exists "owners create staff invites" on public.staff_invites;
drop policy if exists "owners update staff invites" on public.staff_invites;
drop policy if exists staff_invites_insert_head on public.staff_invites;
drop policy if exists staff_invites_insert_head_doctor on public.staff_invites;
drop policy if exists staff_invites_update_head on public.staff_invites;
drop policy if exists staff_invites_update_head_doctor on public.staff_invites;
drop policy if exists staff_invites_delete_head_doctor on public.staff_invites;
drop policy if exists staff_invites_select_pending_own_clinic on public.staff_invites;

create policy staff_invites_select_pending_own_clinic
on public.staff_invites for select to authenticated
using (
  clinic_id = (select public.current_user_clinic_id())
  and accepted_at is null
);

create policy staff_invites_insert_owner
on public.staff_invites for insert to authenticated
with check (
  clinic_id = (select public.current_user_clinic_id())
  and (select public.current_user_is_head_doctor())
);

create policy staff_invites_update_owner
on public.staff_invites for update to authenticated
using (
  clinic_id = (select public.current_user_clinic_id())
  and (select public.current_user_is_head_doctor())
)
with check (
  clinic_id = (select public.current_user_clinic_id())
  and (select public.current_user_is_head_doctor())
);

create policy staff_invites_delete_owner
on public.staff_invites for delete to authenticated
using (
  clinic_id = (select public.current_user_clinic_id())
  and (select public.current_user_is_head_doctor())
);

commit;
