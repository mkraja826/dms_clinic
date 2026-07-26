-- Consolidate clinical Storage authorization and remove exact duplicate RLS
-- policies without changing the clinic roles allowed by the application.

begin;

-- Reject unexpectedly large/non-image uploads at the Storage API boundary.
-- Existing objects are unaffected. The MIME list retains compatibility with
-- older CapDent builds while v18 uploads image/webp.
update storage.buckets
set
  file_size_limit = case
    when id = 'xrays' then 26214400
    when id in ('patient-files', 'prescriptions') then 15728640
    when id = 'clinic-logos' then 5242880
    else file_size_limit
  end,
  allowed_mime_types = array[
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]::text[]
where id in ('patient-files', 'prescriptions', 'xrays', 'clinic-logos');

-- Remove overlapping legacy policies, including policies assigned to PUBLIC.
drop policy if exists "clinic members delete clinical files" on storage.objects;
drop policy if exists "clinic members read storage files" on storage.objects;
drop policy if exists "clinic members update clinical files" on storage.objects;
drop policy if exists "clinic members upload clinical files" on storage.objects;
drop policy if exists "owners doctors update clinical files" on storage.objects;
drop policy if exists "owners doctors upload clinical files" on storage.objects;
drop policy if exists dms_storage_clinic_path_isolation on storage.objects;
drop policy if exists dms_storage_delete_own_clinic on storage.objects;
drop policy if exists dms_storage_insert_own_clinic on storage.objects;
drop policy if exists dms_storage_select_own_clinic on storage.objects;
drop policy if exists dms_storage_update_own_clinic on storage.objects;
drop policy if exists clinical_storage_select_same_clinic on storage.objects;
drop policy if exists clinical_storage_insert_same_clinic on storage.objects;
drop policy if exists clinical_storage_update_same_clinic on storage.objects;
drop policy if exists clinical_storage_delete_same_clinic on storage.objects;

create policy clinical_storage_select_same_clinic
on storage.objects
for select
to authenticated
using (
  bucket_id in ('prescriptions', 'xrays', 'patient-files')
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
);

create policy clinical_storage_insert_same_clinic
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('prescriptions', 'xrays', 'patient-files')
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
  and (select public.current_profile_role()) in (
    'owner', 'head_doctor', 'doctor', 'working_doctor', 'receptionist'
  )
);

create policy clinical_storage_update_same_clinic
on storage.objects
for update
to authenticated
using (
  bucket_id in ('prescriptions', 'xrays', 'patient-files')
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
  and (select public.current_profile_role()) in (
    'owner', 'head_doctor', 'doctor', 'working_doctor', 'receptionist'
  )
)
with check (
  bucket_id in ('prescriptions', 'xrays', 'patient-files')
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
  and (select public.current_profile_role()) in (
    'owner', 'head_doctor', 'doctor', 'working_doctor', 'receptionist'
  )
);

create policy clinical_storage_delete_same_clinic
on storage.objects
for delete
to authenticated
using (
  bucket_id in ('prescriptions', 'xrays', 'patient-files')
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
  and (select public.current_profile_role()) in (
    'owner', 'head_doctor', 'doctor', 'working_doctor', 'receptionist'
  )
);

-- Signed clinic-logo URLs require SELECT permission even while the bucket is
-- public. Listing remains limited to the signed-in user's clinic path.
drop policy if exists clinic_logos_select_own_clinic on storage.objects;
create policy clinic_logos_select_own_clinic
on storage.objects
for select
to authenticated
using (
  bucket_id = 'clinic-logos'
  and (storage.foldername(name))[1] = (select public.current_profile_clinic_id())::text
);

-- These functions are trigger/internal entry points and must never be exposed
-- as callable mobile RPCs. PostgreSQL triggers do not require client EXECUTE.
revoke all on function public.complete_open_appointment_after_visit()
  from public, anon, authenticated;
revoke all on function public.initialize_capdent_pricing_for_new_clinic()
  from public, anon, authenticated;
revoke all on function public.set_medical_history_clinic_id()
  from public, anon, authenticated;
revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

-- Drop only byte-for-byte equivalent legacy RLS duplicates.
drop policy if exists files_all_own_clinic_latest on public.files;
drop policy if exists invoices_all_own_clinic_latest on public.invoices;
drop policy if exists patient_visits_all_own_clinic_latest on public.patient_visits;
drop policy if exists payments_all_own_clinic_latest on public.payments;
drop policy if exists treatments_all_own_clinic_latest on public.treatments;

commit;
