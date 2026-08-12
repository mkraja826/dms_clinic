-- =========================================================
-- MDMS pilot stabilization
-- Fixes:
-- 1) profile RLS infinite recursion
-- 2) create clinic RPC
-- 3) OP quick check-in RPC signature used by APK
-- 4) live waiting queue visibility for installed APK
-- 5) auto-remove patient from waiting after doctor adds visit
-- 6) workflow dashboard summary counts
-- =========================================================

-- ---------- Helper functions: avoid recursive RLS ----------
create or replace function public.current_user_clinic_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select pr.clinic_id
  from public.profiles pr
  where pr.id = auth.uid()
    and pr.active = true
  limit 1;
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select pr.role
  from public.profiles pr
  where pr.id = auth.uid()
    and pr.active = true
  limit 1;
$$;

create or replace function public.current_user_is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('head_doctor', 'owner'), false);
$$;

grant execute on function public.current_user_clinic_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_is_owner() to authenticated;

-- ---------- Drop recursive/old SELECT policies on key tables ----------
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'clinics', 'appointments', 'patients')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.clinics enable row level security;
alter table public.appointments enable row level security;
alter table public.patients enable row level security;

-- profiles: user can see self and same-clinic staff, owners can manage same clinic
create policy profiles_select_safe
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or clinic_id = public.current_user_clinic_id()
);

create policy profiles_update_self_safe
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy profiles_update_owner_safe
on public.profiles
for update
to authenticated
using (
  public.current_user_is_owner()
  and clinic_id = public.current_user_clinic_id()
)
with check (
  public.current_user_is_owner()
  and clinic_id = public.current_user_clinic_id()
);

-- clinics: same-clinic users can read, owner/head can update
create policy clinics_select_safe
on public.clinics
for select
to authenticated
using (id = public.current_user_clinic_id());

create policy clinics_update_owner_safe
on public.clinics
for update
to authenticated
using (
  public.current_user_is_owner()
  and id = public.current_user_clinic_id()
)
with check (
  public.current_user_is_owner()
  and id = public.current_user_clinic_id()
);

-- appointments and patients direct table reads are used by the installed APK dashboard
create policy appointments_select_same_clinic_safe
on public.appointments
for select
to authenticated
using (clinic_id = public.current_user_clinic_id());

create policy patients_select_same_clinic_safe
on public.patients
for select
to authenticated
using (clinic_id = public.current_user_clinic_id());

grant select on public.profiles to authenticated;
grant select on public.clinics to authenticated;
grant select on public.appointments to authenticated;
grant select on public.patients to authenticated;

-- ---------- Create clinic RPC used by app ----------
drop function if exists public.create_owner_clinic(text, text, text, text, text) cascade;

create or replace function public.create_owner_clinic(
  clinic_name text,
  owner_name text,
  clinic_phone text default null,
  clinic_email text default null,
  clinic_address text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_clinic_id uuid;
  v_profile public.profiles;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(trim(clinic_name), '') = '' then
    raise exception 'Clinic name is required';
  end if;

  if coalesce(trim(owner_name), '') = '' then
    raise exception 'Owner name is required';
  end if;

  select au.email
  into v_user_email
  from auth.users au
  where au.id = v_user_id
  limit 1;

  v_user_email := coalesce(nullif(trim(coalesce(clinic_email, '')), ''), v_user_email, '');

  insert into public.clinics (name, phone, email, address, active)
  values (
    trim(clinic_name),
    nullif(trim(coalesce(clinic_phone, '')), ''),
    nullif(trim(v_user_email), ''),
    nullif(trim(coalesce(clinic_address, '')), ''),
    true
  )
  returning id into v_clinic_id;

  insert into public.profiles (id, clinic_id, name, email, role, active)
  values (v_user_id, v_clinic_id, trim(owner_name), v_user_email, 'head_doctor', true)
  on conflict (id)
  do update set
    clinic_id = excluded.clinic_id,
    name = excluded.name,
    email = excluded.email,
    role = 'head_doctor',
    active = true
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.create_owner_clinic(text, text, text, text, text) to authenticated;

-- ---------- Reception quick check-in RPC used by APK ----------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reception_quick_checkin'
  loop
    execute 'drop function if exists ' || r.fn || ' cascade';
  end loop;
end $$;

create or replace function public.reception_quick_checkin(
  p_patient_id uuid default null,
  p_name text default null,
  p_phone text default null,
  p_age integer default null,
  p_gender text default null,
  p_address text default null,
  p_op_amount numeric default 300,
  p_payment_method text default 'Cash',
  p_op_status text default 'paid',
  p_waiver_reason text default null
)
returns table (
  patient_id uuid,
  appointment_id uuid,
  invoice_id uuid,
  payment_id uuid,
  op_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinic_id uuid;
  v_patient_id uuid;
  v_patient_clinic_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_amount numeric;
  v_patient_code text;
  v_op_status text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id
  into v_clinic_id
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  v_op_status := lower(trim(coalesce(p_op_status, 'paid')));
  if v_op_status not in ('paid', 'pending', 'waived') then
    v_op_status := 'paid';
  end if;

  v_amount := coalesce(p_op_amount, 300);
  if v_op_status in ('paid', 'pending') and v_amount <= 0 then
    raise exception 'OP fee must be greater than zero';
  end if;
  if v_op_status = 'waived' then
    v_amount := 0;
  end if;

  if p_patient_id is null then
    if coalesce(trim(p_name), '') = '' then
      raise exception 'Patient name is required';
    end if;

    v_patient_code := 'P-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));

    insert into public.patients (clinic_id, patient_code, name, phone, age, gender, address)
    values (
      v_clinic_id,
      v_patient_code,
      trim(p_name),
      nullif(trim(coalesce(p_phone, '')), ''),
      p_age,
      nullif(trim(coalesce(p_gender, '')), ''),
      nullif(trim(coalesce(p_address, '')), '')
    )
    returning id into v_patient_id;
  else
    select pt.clinic_id
    into v_patient_clinic_id
    from public.patients pt
    where pt.id = p_patient_id
    limit 1;

    if v_patient_clinic_id is null then
      raise exception 'Patient not found';
    end if;

    if v_patient_clinic_id <> v_clinic_id then
      raise exception 'Patient does not belong to your clinic';
    end if;

    v_patient_id := p_patient_id;
  end if;

  if v_op_status = 'paid' then
    insert into public.invoices (
      clinic_id, patient_id, total_amount, paid_amount, due_amount,
      status, invoice_type, payment_category, notes
    )
    values (
      v_clinic_id, v_patient_id, v_amount, v_amount, 0,
      'paid', 'op_fee', 'op_fee', 'OP fee collected during quick check-in'
    )
    returning id into v_invoice_id;

    insert into public.payments (
      clinic_id, patient_id, invoice_id, amount, payment_method,
      notes, payment_category, collected_by
    )
    values (
      v_clinic_id, v_patient_id, v_invoice_id, v_amount,
      coalesce(nullif(trim(p_payment_method), ''), 'Cash'),
      'OP fee - patient checked in', 'op_fee', v_user_id
    )
    returning id into v_payment_id;

  elsif v_op_status = 'pending' then
    insert into public.invoices (
      clinic_id, patient_id, total_amount, paid_amount, due_amount,
      status, invoice_type, payment_category, notes
    )
    values (
      v_clinic_id, v_patient_id, v_amount, 0, v_amount,
      'unpaid', 'op_fee', 'op_fee', 'OP fee pending during quick check-in'
    )
    returning id into v_invoice_id;

    v_payment_id := null;
  else
    v_invoice_id := null;
    v_payment_id := null;
  end if;

  -- doctor_id intentionally stays null. Doctor is saved in patient_visits.doctor_id when visit is added.
  insert into public.appointments (
    clinic_id, patient_id, doctor_id, appointment_time, status,
    notes, op_fee_amount, op_fee_status, op_fee_waiver_reason,
    op_fee_waived_by, op_fee_waived_at
  )
  values (
    v_clinic_id, v_patient_id, null, now(), 'scheduled',
    case
      when v_op_status = 'paid' then 'Walk-in / OP fee collected / waiting'
      when v_op_status = 'pending' then 'Walk-in / OP fee pending / waiting'
      when v_op_status = 'waived' then 'Walk-in / OP fee waived / waiting'
      else 'Walk-in / waiting'
    end,
    v_amount,
    v_op_status,
    case when v_op_status = 'waived' then nullif(trim(coalesce(p_waiver_reason, '')), '') else null end,
    case when v_op_status = 'waived' then v_user_id else null end,
    case when v_op_status = 'waived' then now() else null end
  )
  returning id into v_appointment_id;

  return query
  select v_patient_id, v_appointment_id, v_invoice_id, v_payment_id, v_amount;
end;
$$;

grant execute on function public.reception_quick_checkin(uuid, text, text, integer, text, text, numeric, text, text, text) to authenticated;

-- ---------- Auto-complete open queue appointment after doctor creates visit ----------
create or replace function public.complete_open_appointment_after_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.appointments ap
  set status = 'completed'
  where ap.clinic_id = new.clinic_id
    and ap.patient_id = new.patient_id
    and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', coalesce(new.visit_date, now()))::date
    and lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked');

  return new;
end;
$$;

drop trigger if exists trg_complete_open_appointment_after_visit on public.patient_visits;

create trigger trg_complete_open_appointment_after_visit
after insert on public.patient_visits
for each row
execute function public.complete_open_appointment_after_visit();

-- ---------- Workflow dashboard summary RPC ----------
drop function if exists public.get_workflow_dashboard_summary() cascade;

create or replace function public.get_workflow_dashboard_summary()
returns table (
  today_revenue numeric,
  pending_payments numeric,
  op_fee_revenue_today numeric,
  xray_revenue_today numeric,
  medication_revenue_today numeric,
  treatment_revenue_today numeric,
  pending_collected_today numeric,
  other_revenue_today numeric,
  today_patient_count integer,
  waiting_count integer,
  completed_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinic_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id
  into v_clinic_id
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  return query
  select
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(inv.due_amount)::numeric from public.invoices inv where inv.clinic_id = v_clinic_id and inv.due_amount > 0 and lower(coalesce(inv.status, '')) in ('unpaid', 'partial')), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and py.payment_category = 'op_fee' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and py.payment_category = 'xray_fee' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and py.payment_category = 'medication_fee' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and py.payment_category = 'treatment_fee' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and py.payment_category = 'pending_collection' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id = v_clinic_id and coalesce(py.payment_category, 'other') = 'other' and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select count(*)::integer from public.appointments ap where ap.clinic_id = v_clinic_id and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date), 0),
    coalesce((select count(*)::integer from public.appointments ap where ap.clinic_id = v_clinic_id and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date and lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked')), 0),
    coalesce((select count(*)::integer from public.appointments ap where ap.clinic_id = v_clinic_id and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date and lower(coalesce(ap.status, '')) in ('completed', 'done')), 0);
end;
$$;

grant execute on function public.get_workflow_dashboard_summary() to authenticated;

-- ---------- Keep existing open rows queue-compatible ----------
update public.appointments ap
set doctor_id = null
where lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked');

notify pgrst, 'reload schema';
