alter table public.appointments drop constraint if exists appointments_created_by_fkey;
notify pgrst, 'reload schema';
