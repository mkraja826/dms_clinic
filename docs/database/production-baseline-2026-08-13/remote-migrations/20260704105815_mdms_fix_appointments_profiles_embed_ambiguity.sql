-- =========================================================
-- MDMS installed APK compatibility fix
-- The installed APK queries:
-- appointments?select=*,patients(id,name,phone),profiles(id,name)
-- PostgREST returns 300 if appointments has multiple FKs to profiles.
-- Keep doctor_id FK for profiles embed; drop op_fee_waived_by FK only.
-- =========================================================

alter table public.appointments
  drop constraint if exists appointments_op_fee_waived_by_fkey;

notify pgrst, 'reload schema';
