alter table public.staff_invites
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_reason text;

create index if not exists staff_invites_clinic_pending_idx
  on public.staff_invites (clinic_id, created_at desc)
  where accepted_at is null and cancelled_at is null;

create table if not exists public.management_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  target_type text not null check (target_type in ('staff','staff_invite','clinic')),
  target_id uuid not null,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null,
  field_name text not null,
  old_value text,
  new_value text,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists management_audit_logs_clinic_created_idx
  on public.management_audit_logs (clinic_id, created_at desc);
create index if not exists management_audit_logs_target_idx
  on public.management_audit_logs (target_type, target_id, created_at desc);

alter table public.management_audit_logs enable row level security;

drop policy if exists management_audit_logs_owner_select on public.management_audit_logs;
create policy management_audit_logs_owner_select
  on public.management_audit_logs
  for select
  to authenticated
  using (
    clinic_id = public.current_user_clinic_id()
    and public.current_user_is_owner()
  );

create or replace function public.accept_staff_invite_by_code(code text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.staff_invites;
  new_profile public.profiles;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This user already belongs to a clinic';
  end if;

  user_email := auth.jwt() ->> 'email';

  select *
  into invite
  from public.staff_invites
  where upper(invite_code) = upper(trim(code))
    and accepted_at is null
    and cancelled_at is null
  order by created_at desc
  limit 1;

  if invite.id is null then
    raise exception 'No pending invite found for this code';
  end if;

  if invite.email is not null and lower(invite.email) <> lower(coalesce(user_email, '')) then
    raise exception 'This invite code is assigned to a different email';
  end if;

  insert into public.profiles (id, clinic_id, name, email, role, active)
  values (auth.uid(), invite.clinic_id, invite.name, coalesce(user_email, invite.email), invite.role, true)
  returning * into new_profile;

  update public.staff_invites
  set accepted_at = now()
  where id = invite.id;

  return new_profile;
end;
$$;

create or replace function public.get_staff_section()
returns table(
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
    'staff'::text,
    p.id,
    p.clinic_id,
    p.name,
    p.email,
    p.phone,
    p.role,
    p.active,
    null::text,
    null::timestamptz,
    p.created_at
  from public.profiles p
  where p.clinic_id = public.current_user_clinic_id()
    and p.active = true

  union all

  select
    'pending_invite'::text,
    si.id,
    si.clinic_id,
    si.name,
    si.email,
    null::text,
    si.role,
    true,
    si.invite_code,
    si.accepted_at,
    si.created_at
  from public.staff_invites si
  where si.clinic_id = public.current_user_clinic_id()
    and si.accepted_at is null
    and si.cancelled_at is null
  order by created_at desc;
$$;

create or replace function public.admin_create_staff_invite(
  p_name text,
  p_email text,
  p_role text,
  p_reason text
)
returns public.staff_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_invite public.staff_invites;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if v_actor.id is null or v_actor.role not in ('owner','head_doctor') then
    raise exception 'Only the clinic owner or head doctor can invite staff.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'An invitation reason is required.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'Staff name is required.' using errcode = '22023';
  end if;

  select * into v_invite
  from public.create_staff_invite(trim(p_name), nullif(lower(trim(coalesce(p_email,''))), ''), p_role);

  update public.staff_invites
  set cancelled_at = null,
      cancelled_by = null,
      cancellation_reason = null
  where id = v_invite.id
  returning * into v_invite;

  insert into public.management_audit_logs
    (clinic_id, target_type, target_id, changed_by, action, field_name, old_value, new_value, reason)
  values
    (v_actor.clinic_id, 'staff_invite', v_invite.id, auth.uid(), 'created', 'invite', null,
     concat('name=', v_invite.name, '; role=', v_invite.role, '; email=', coalesce(v_invite.email,'not restricted')),
     trim(p_reason));

  return v_invite;
end;
$$;

create or replace function public.admin_cancel_staff_invite(
  p_invite_id uuid,
  p_reason text
)
returns public.staff_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_invite public.staff_invites;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if v_actor.id is null or v_actor.role not in ('owner','head_doctor') then
    raise exception 'Only the clinic owner or head doctor can cancel staff invitations.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'A cancellation reason is required.' using errcode = '22023';
  end if;

  select * into v_invite
  from public.staff_invites
  where id = p_invite_id
    and clinic_id = v_actor.clinic_id
    and accepted_at is null
    and cancelled_at is null
  for update;

  if not found then
    raise exception 'Pending invitation was not found.' using errcode = 'P0002';
  end if;

  update public.staff_invites
  set cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = trim(p_reason)
  where id = p_invite_id
  returning * into v_invite;

  insert into public.management_audit_logs
    (clinic_id, target_type, target_id, changed_by, action, field_name, old_value, new_value, reason)
  values
    (v_actor.clinic_id, 'staff_invite', v_invite.id, auth.uid(), 'cancelled', 'status', 'pending', 'cancelled', trim(p_reason));

  return v_invite;
end;
$$;

create or replace function public.admin_update_staff_member(
  p_staff_id uuid,
  p_name text,
  p_phone text,
  p_role text,
  p_active boolean,
  p_reason text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_old public.profiles;
  v_new public.profiles;
  v_role text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if v_actor.id is null or v_actor.role not in ('owner','head_doctor') then
    raise exception 'Only the clinic owner or head doctor can manage staff.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'A modification reason is required.' using errcode = '22023';
  end if;

  if p_staff_id = auth.uid() then
    raise exception 'You cannot change your own administrator access.' using errcode = '42501';
  end if;

  select * into v_old
  from public.profiles
  where id = p_staff_id and clinic_id = v_actor.clinic_id
  for update;

  if not found then
    raise exception 'Staff member was not found in your clinic.' using errcode = 'P0002';
  end if;

  if v_old.role = 'owner' then
    raise exception 'Clinic owner access cannot be changed here.' using errcode = '42501';
  end if;

  if v_actor.role = 'head_doctor' and v_old.role = 'head_doctor' then
    raise exception 'Only the clinic owner can modify another head doctor.' using errcode = '42501';
  end if;

  v_role := case when p_role = 'doctor' then 'working_doctor' else p_role end;
  if v_role not in ('head_doctor','working_doctor','receptionist') then
    raise exception 'Invalid staff role.' using errcode = '22023';
  end if;

  if v_role = 'head_doctor' and v_actor.role <> 'owner' then
    raise exception 'Only the clinic owner can assign the head-doctor role.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'Staff name is required.' using errcode = '22023';
  end if;

  update public.profiles
  set name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone,'')), ''),
      role = v_role,
      active = coalesce(p_active, active)
  where id = p_staff_id
  returning * into v_new;

  if v_old.name is not distinct from v_new.name
     and v_old.phone is not distinct from v_new.phone
     and v_old.role is not distinct from v_new.role
     and v_old.active is not distinct from v_new.active then
    raise exception 'No staff changes were detected.' using errcode = '22023';
  end if;

  insert into public.management_audit_logs
    (clinic_id, target_type, target_id, changed_by, action, field_name, old_value, new_value, reason)
  select v_actor.clinic_id, 'staff', p_staff_id, auth.uid(),
         case when changed.field_name = 'active' then 'access_changed' else 'updated' end,
         changed.field_name, changed.old_value, changed.new_value, trim(p_reason)
  from (values
    ('name', v_old.name::text, v_new.name::text),
    ('phone', v_old.phone::text, v_new.phone::text),
    ('role', v_old.role::text, v_new.role::text),
    ('active', v_old.active::text, v_new.active::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  if v_old.active and not v_new.active then
    update public.device_push_tokens
    set active = false,
        disabled_at = now(),
        updated_at = now(),
        last_error = 'Staff access deactivated by clinic administrator'
    where clinic_id = v_actor.clinic_id
      and user_id = p_staff_id
      and active = true;
  end if;

  return v_new;
end;
$$;

create or replace function public.admin_update_clinic_settings(
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_brand_color text,
  p_opening_time time,
  p_closing_time time,
  p_op_fee_amount numeric,
  p_enable_patient_photos boolean,
  p_enable_prescription_medications boolean,
  p_payment_push_enabled boolean,
  p_tooth_chart_enabled boolean,
  p_reason text
)
returns public.clinics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_old public.clinics;
  v_new public.clinics;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if v_actor.id is null or v_actor.role not in ('owner','head_doctor') then
    raise exception 'Only the clinic owner or head doctor can change clinic settings.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'A settings-change reason is required.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'Clinic name is required.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_email,'')), '') is not null
     and trim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid clinic email.' using errcode = '22023';
  end if;
  if p_brand_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Brand colour must use six-digit hex format.' using errcode = '22023';
  end if;
  if p_opening_time is null or p_closing_time is null or p_opening_time >= p_closing_time then
    raise exception 'Closing time must be after opening time.' using errcode = '22023';
  end if;
  if coalesce(p_op_fee_amount,0) < 0 or p_op_fee_amount > 1000000 then
    raise exception 'OP fee amount is outside the supported range.' using errcode = '22023';
  end if;

  select * into v_old
  from public.clinics
  where id = v_actor.clinic_id
  for update;

  update public.clinics
  set name = trim(p_name),
      phone = nullif(trim(coalesce(p_phone,'')), ''),
      email = nullif(lower(trim(coalesce(p_email,''))), ''),
      address = nullif(trim(coalesce(p_address,'')), ''),
      brand_color = upper(p_brand_color),
      opening_time = p_opening_time,
      closing_time = p_closing_time,
      op_fee_amount = p_op_fee_amount,
      enable_patient_photos = coalesce(p_enable_patient_photos,false),
      enable_prescription_medications = coalesce(p_enable_prescription_medications,false),
      payment_push_enabled = coalesce(p_payment_push_enabled,false),
      tooth_chart_enabled = coalesce(p_tooth_chart_enabled,false)
  where id = v_actor.clinic_id
  returning * into v_new;

  insert into public.management_audit_logs
    (clinic_id, target_type, target_id, changed_by, action, field_name, old_value, new_value, reason)
  select v_actor.clinic_id, 'clinic', v_actor.clinic_id, auth.uid(), 'settings_changed',
         changed.field_name, changed.old_value, changed.new_value, trim(p_reason)
  from (values
    ('name', v_old.name::text, v_new.name::text),
    ('phone', v_old.phone::text, v_new.phone::text),
    ('email', v_old.email::text, v_new.email::text),
    ('address', v_old.address::text, v_new.address::text),
    ('brand_color', v_old.brand_color::text, v_new.brand_color::text),
    ('opening_time', v_old.opening_time::text, v_new.opening_time::text),
    ('closing_time', v_old.closing_time::text, v_new.closing_time::text),
    ('op_fee_amount', v_old.op_fee_amount::text, v_new.op_fee_amount::text),
    ('enable_patient_photos', v_old.enable_patient_photos::text, v_new.enable_patient_photos::text),
    ('enable_prescription_medications', v_old.enable_prescription_medications::text, v_new.enable_prescription_medications::text),
    ('payment_push_enabled', v_old.payment_push_enabled::text, v_new.payment_push_enabled::text),
    ('tooth_chart_enabled', v_old.tooth_chart_enabled::text, v_new.tooth_chart_enabled::text)
  ) as changed(field_name, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;

  return v_new;
end;
$$;

create or replace function public.admin_get_management_overview(
  p_month_start date default date_trunc('month', now())::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor public.profiles;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and active = true;

  if v_actor.id is null or v_actor.role not in ('owner','head_doctor') then
    raise exception 'Only the clinic owner or head doctor can view clinic management.' using errcode = '42501';
  end if;

  v_start := p_month_start::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata';

  select jsonb_build_object(
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'email', p.email,
        'phone', p.phone,
        'role', p.role,
        'active', p.active,
        'created_at', p.created_at,
        'activity', jsonb_build_object(
          'patients_created', (select count(*) from public.patients x where x.clinic_id=v_actor.clinic_id and x.created_by=p.id and x.created_at>=v_start and x.created_at<v_end),
          'appointments_created', (select count(*) from public.appointments x where x.clinic_id=v_actor.clinic_id and x.created_by=p.id and x.created_at>=v_start and x.created_at<v_end),
          'visits_created', (select count(*) from public.patient_visits x where x.clinic_id=v_actor.clinic_id and x.created_by=p.id and x.created_at>=v_start and x.created_at<v_end),
          'payments_recorded', (select count(*) from public.payments x where x.clinic_id=v_actor.clinic_id and x.collected_by=p.id and x.created_at>=v_start and x.created_at<v_end),
          'files_uploaded', (select count(*) from public.files x where x.clinic_id=v_actor.clinic_id and x.uploaded_by=p.id and x.created_at>=v_start and x.created_at<v_end),
          'records_modified',
            (select count(*) from (
              select created_at from public.patient_audit_logs x where x.clinic_id=v_actor.clinic_id and x.changed_by=p.id
              union all select created_at from public.appointment_audit_logs x where x.clinic_id=v_actor.clinic_id and x.changed_by=p.id
              union all select created_at from public.clinical_audit_logs x where x.clinic_id=v_actor.clinic_id and x.changed_by=p.id
              union all select created_at from public.financial_adjustments x where x.clinic_id=v_actor.clinic_id and x.created_by=p.id
              union all select created_at from public.management_audit_logs x where x.clinic_id=v_actor.clinic_id and x.changed_by=p.id
            ) changes where changes.created_at>=v_start and changes.created_at<v_end)
        )
      ) order by case p.role when 'owner' then 1 when 'head_doctor' then 2 when 'working_doctor' then 3 else 4 end, p.name)
      from public.profiles p where p.clinic_id=v_actor.clinic_id
    ), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', si.id, 'name', si.name, 'email', si.email, 'role', si.role,
        'invite_code', si.invite_code, 'created_at', si.created_at
      ) order by si.created_at desc)
      from public.staff_invites si
      where si.clinic_id=v_actor.clinic_id and si.accepted_at is null and si.cancelled_at is null
    ), '[]'::jsonb),
    'storage', jsonb_build_object(
      'total_files', (select count(*) from public.files f where f.clinic_id=v_actor.clinic_id),
      'stored_bytes', (select coalesce(sum(f.stored_size_bytes),0) from public.files f where f.clinic_id=v_actor.clinic_id),
      'original_bytes', (select coalesce(sum(f.original_size_bytes),0) from public.files f where f.clinic_id=v_actor.clinic_id),
      'unknown_size_files', (select count(*) from public.files f where f.clinic_id=v_actor.clinic_id and f.stored_size_bytes is null),
      'by_type', coalesce((select jsonb_agg(jsonb_build_object('file_type', q.file_type, 'file_count', q.file_count, 'stored_bytes', q.stored_bytes) order by q.file_count desc)
        from (select f.file_type, count(*) file_count, coalesce(sum(f.stored_size_bytes),0) stored_bytes from public.files f where f.clinic_id=v_actor.clinic_id group by f.file_type) q), '[]'::jsonb)
    ),
    'subscription', coalesce((select jsonb_build_object(
      'plan_name', s.plan_name,
      'status', s.status,
      'trial_ends_at', s.trial_ends_at,
      'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end,
      'monthly_price', s.monthly_price,
      'visit_limit', s.visit_limit,
      'billing_provider', s.billing_provider,
      'google_play_status', s.google_play_status,
      'google_play_auto_renewing', s.google_play_auto_renewing,
      'google_play_last_verified_at', s.google_play_last_verified_at
    ) from public.clinic_subscriptions s where s.clinic_id=v_actor.clinic_id), '{}'::jsonb),
    'devices', jsonb_build_object(
      'active_tokens', (select count(*) from public.device_push_tokens d where d.clinic_id=v_actor.clinic_id and d.active),
      'inactive_tokens', (select count(*) from public.device_push_tokens d where d.clinic_id=v_actor.clinic_id and not d.active),
      'users_with_active_tokens', (select count(distinct d.user_id) from public.device_push_tokens d where d.clinic_id=v_actor.clinic_id and d.active),
      'last_seen_at', (select max(d.last_seen_at) from public.device_push_tokens d where d.clinic_id=v_actor.clinic_id),
      'error_tokens', (select count(*) from public.device_push_tokens d where d.clinic_id=v_actor.clinic_id and d.last_error is not null)
    ),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'target_type', a.target_type, 'target_id', a.target_id,
      'action', a.action, 'field_name', a.field_name, 'old_value', a.old_value,
      'new_value', a.new_value, 'reason', a.reason, 'created_at', a.created_at,
      'changed_by', jsonb_build_object('id', p.id, 'name', p.name)
    ) order by a.created_at desc)
      from (select * from public.management_audit_logs where clinic_id=v_actor.clinic_id order by created_at desc limit 100) a
      left join public.profiles p on p.id=a.changed_by), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_create_staff_invite(text,text,text,text) from public;
grant execute on function public.admin_create_staff_invite(text,text,text,text) to authenticated;
revoke all on function public.admin_cancel_staff_invite(uuid,text) from public;
grant execute on function public.admin_cancel_staff_invite(uuid,text) to authenticated;
revoke all on function public.admin_update_staff_member(uuid,text,text,text,boolean,text) from public;
grant execute on function public.admin_update_staff_member(uuid,text,text,text,boolean,text) to authenticated;
revoke all on function public.admin_update_clinic_settings(text,text,text,text,text,time,time,numeric,boolean,boolean,boolean,boolean,text) from public;
grant execute on function public.admin_update_clinic_settings(text,text,text,text,text,time,time,numeric,boolean,boolean,boolean,boolean,text) to authenticated;
revoke all on function public.admin_get_management_overview(date) from public;
grant execute on function public.admin_get_management_overview(date) to authenticated;
