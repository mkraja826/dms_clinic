-- Production hardening for CapDent v18.
-- This migration is forward-only and preserves all application RPC signatures.

begin;

-- Migration helper: never expose schema-changing SECURITY DEFINER code through
-- the Data API. PostgreSQL grants EXECUTE to PUBLIC by default unless revoked.
revoke all on function public.apply_dms_clinic_isolation_policy(text, text)
  from public, anon, authenticated;
grant execute on function public.apply_dms_clinic_isolation_policy(text, text)
  to service_role;

-- Runtime RPCs retain authenticated access, but anonymous/PUBLIC execution is
-- removed explicitly. Each function already performs its own clinic/role check.
revoke all on function public.collect_reception_fee(uuid, text, numeric, text, text)
  from public, anon;
grant execute on function public.collect_reception_fee(uuid, text, numeric, text, text)
  to authenticated;

revoke all on function public.create_staff_invite(text, text, text)
  from public, anon;
grant execute on function public.create_staff_invite(text, text, text)
  to authenticated;

revoke all on function public.current_profile_clinic_id()
  from public, anon;
grant execute on function public.current_profile_clinic_id()
  to authenticated;

revoke all on function public.current_profile_role()
  from public, anon;
grant execute on function public.current_profile_role()
  to authenticated;

revoke all on function public.get_clinic_dashboard_v2()
  from public, anon;
grant execute on function public.get_clinic_dashboard_v2()
  to authenticated;

revoke all on function public.is_clinic_doctor(uuid, uuid)
  from public, anon;
grant execute on function public.is_clinic_doctor(uuid, uuid)
  to authenticated;

revoke all on function public.owner_update_staff_access(uuid, text, boolean)
  from public, anon;
grant execute on function public.owner_update_staff_access(uuid, text, boolean)
  to authenticated;

-- Trigger functions are invoked by PostgreSQL triggers, not by mobile clients.
revoke all on function public.set_patient_visit_staff_fields()
  from public, anon, authenticated;
revoke all on function public.set_record_created_by_staff()
  from public, anon, authenticated;
revoke all on function public.set_treatment_status_from_visit_followup()
  from public, anon, authenticated;

-- Pin mutable search paths reported by the database advisor.
alter function public.generate_invite_code()
  set search_path = public, pg_temp;
alter function public.invoice_status(numeric, numeric)
  set search_path = public, pg_temp;

-- Remove legacy broad Storage policies. Clinic-scoped policies remain in place;
-- removing these permissive duplicates closes cross-clinic write paths.
drop policy if exists "Authenticated users can read patient files" on storage.objects;
drop policy if exists "Authenticated users can upload patient files" on storage.objects;
drop policy if exists "Authenticated users can update patient files" on storage.objects;
drop policy if exists dms_storage_select on storage.objects;
drop policy if exists dms_storage_insert on storage.objects;
drop policy if exists dms_storage_update on storage.objects;
drop policy if exists dms_storage_delete on storage.objects;

-- Cover foreign keys introduced by v18 billing and medication features.
create index if not exists google_play_subscription_events_profile_id_idx
  on public.google_play_subscription_events (profile_id);
create index if not exists google_play_subscription_events_subscription_id_idx
  on public.google_play_subscription_events (subscription_id);
create index if not exists patient_medications_prescribed_by_idx
  on public.patient_medications (prescribed_by);

-- Remove redundant indexes while retaining the constraint-owned unique index
-- and the canonical patients(clinic_id) index.
drop index if exists public.medical_history_patient_id_unique;
drop index if exists public.patients_clinic_idx;

commit;
