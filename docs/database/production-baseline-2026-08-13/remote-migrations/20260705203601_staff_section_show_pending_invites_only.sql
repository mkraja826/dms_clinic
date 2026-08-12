drop policy if exists "owners read staff invites" on public.staff_invites;
drop policy if exists "staff_invites_select_own_clinic" on public.staff_invites;

create policy "staff_invites_select_pending_own_clinic"
on public.staff_invites
for select
to authenticated
using (
  clinic_id = public.current_user_clinic_id()
  and accepted_at is null
);

create or replace function public.get_staff_section()
returns table (
  row_type text,
  id uuid,
  clinic_id uuid,
  name text,
  email text,
  phone text,
  role text,
  active boolean,
  invite_code text,
  accepted_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    'staff'::text as row_type,
    p.id,
    p.clinic_id,
    p.name,
    p.email,
    p.phone,
    p.role,
    p.active,
    null::text as invite_code,
    null::timestamptz as accepted_at,
    p.created_at
  from public.profiles p
  where p.clinic_id = public.current_user_clinic_id()
    and p.active = true

  union all

  select
    'pending_invite'::text as row_type,
    si.id,
    si.clinic_id,
    si.name,
    si.email,
    null::text as phone,
    si.role,
    true as active,
    si.invite_code,
    si.accepted_at,
    si.created_at
  from public.staff_invites si
  where si.clinic_id = public.current_user_clinic_id()
    and si.accepted_at is null
  order by created_at desc;
$$;

grant execute on function public.get_staff_section() to authenticated;
