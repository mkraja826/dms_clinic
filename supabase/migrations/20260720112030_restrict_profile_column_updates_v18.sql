-- Protect profile authority fields at the Postgres privilege layer. RLS limits
-- which rows may be updated; column grants additionally limit what may change.

begin;

-- Profiles are never part of the anonymous website surface.
revoke all privileges on table public.profiles from anon;

-- Staff role/activation changes use owner_update_staff_access(), while clinic
-- assignment and invite acceptance use audited SECURITY DEFINER RPCs. Direct
-- clients only need to read profiles and edit non-authority personal fields.
revoke insert, delete, truncate, references, trigger, update
  on table public.profiles
  from authenticated;

grant select on table public.profiles to authenticated;
grant update (name, phone) on table public.profiles to authenticated;

commit;
