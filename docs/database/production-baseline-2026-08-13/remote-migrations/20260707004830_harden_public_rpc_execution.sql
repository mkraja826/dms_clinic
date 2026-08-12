-- Public release hardening: do not allow anonymous clients to execute clinic RPC functions.
-- The mobile app calls these RPCs only after Supabase login, so authenticated users keep access.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;

-- Keep future public-schema functions from becoming anonymously executable by default.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant execute on functions to authenticated;
