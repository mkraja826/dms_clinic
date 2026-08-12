drop policy if exists profiles_select_safe on public.profiles;
drop policy if exists profiles_update_self_safe on public.profiles;

create policy profiles_select_safe
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or clinic_id = public.current_user_clinic_id()
);

create policy profiles_update_self_safe
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));
