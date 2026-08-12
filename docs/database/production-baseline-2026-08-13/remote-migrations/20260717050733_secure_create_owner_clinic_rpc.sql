-- Clinic creation requires an authenticated Supabase user.
-- Remove the default PUBLIC/anon execute permission while preserving signed-in onboarding.

revoke execute on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text
) to authenticated;

revoke execute on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  time without time zone,
  time without time zone
) from public, anon;

grant execute on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  time without time zone,
  time without time zone
) to authenticated;
