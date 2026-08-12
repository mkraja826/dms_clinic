grant usage on schema public to authenticated;

alter table public.device_push_tokens enable row level security;

revoke all on table public.device_push_tokens from public, anon, authenticated;
grant select on table public.device_push_tokens to authenticated;

grant insert (
  clinic_id,
  user_id,
  install_id,
  expo_push_token,
  platform,
  device_name,
  app_version,
  active,
  last_seen_at,
  disabled_at,
  last_error,
  created_at,
  updated_at
)
on public.device_push_tokens
to authenticated;

grant update (
  expo_push_token,
  platform,
  device_name,
  app_version,
  active,
  last_seen_at,
  disabled_at,
  last_error,
  updated_at
)
on public.device_push_tokens
to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_push_tokens'
      and policyname = 'device_push_tokens_select_own_eligible'
  ) then
    create policy device_push_tokens_select_own_eligible
    on public.device_push_tokens
    for select
    to authenticated
    using (
      user_id = (select auth.uid())
      and clinic_id = (select public.current_profile_clinic_id())
      and (select public.current_profile_role()) in ('owner', 'head_doctor')
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_push_tokens'
      and policyname = 'device_push_tokens_insert_own_eligible'
  ) then
    create policy device_push_tokens_insert_own_eligible
    on public.device_push_tokens
    for insert
    to authenticated
    with check (
      user_id = (select auth.uid())
      and clinic_id = (select public.current_profile_clinic_id())
      and (select public.current_profile_role()) in ('owner', 'head_doctor')
      and active
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'device_push_tokens'
      and policyname = 'device_push_tokens_update_own_eligible'
  ) then
    create policy device_push_tokens_update_own_eligible
    on public.device_push_tokens
    for update
    to authenticated
    using (
      user_id = (select auth.uid())
      and clinic_id = (select public.current_profile_clinic_id())
      and (select public.current_profile_role()) in ('owner', 'head_doctor')
    )
    with check (
      user_id = (select auth.uid())
      and clinic_id = (select public.current_profile_clinic_id())
      and (select public.current_profile_role()) in ('owner', 'head_doctor')
    );
  end if;
end
$$;
