-- Disposable local-only schema fixture for v21 migration tests.
--
-- This intentionally models only the production columns and helpers used by
-- the two v21 migrations. It is never a hosted migration and contains no data.

drop schema if exists public cascade;
create schema public;

grant all on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  active boolean default true,
  enable_patient_photos boolean not null default false,
  enable_prescription_medications boolean not null default false,
  op_fee_amount numeric not null default 300,
  country_code text not null default 'IN',
  currency_code text not null default 'INR',
  opening_time time not null default '09:00',
  closing_time time not null default '21:00'
);

create table public.profiles (
  id uuid primary key,
  clinic_id uuid references public.clinics(id) on delete cascade,
  name text not null,
  email text,
  role text not null check (
    role in (
      'owner',
      'head_doctor',
      'doctor',
      'working_doctor',
      'receptionist'
    )
  ),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_code text,
  name text not null,
  gender text,
  age integer,
  phone text,
  email text,
  address text,
  emergency_contact text,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete set null,
  appointment_time timestamptz not null,
  status text not null default 'scheduled' check (
    status in (
      'scheduled',
      'waiting',
      'checked_in',
      'booked',
      'completed',
      'done',
      'cancelled',
      'canceled',
      'no_show',
      'followup',
      'reminded'
    )
  ),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create table public.patient_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.profiles(id) on delete set null,
  visit_date timestamptz not null default now(),
  chief_complaint text,
  diagnosis text,
  doctor_notes text,
  next_appointment_date timestamptz,
  created_at timestamptz not null default now(),
  visit_status text default 'completed',
  created_by uuid references public.profiles(id) on delete set null
);

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_name text not null,
  description text,
  cost numeric not null default 0,
  status text not null default 'planned' check (
    status in ('planned', 'ongoing', 'completed', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  category text
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  total_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  due_amount numeric not null default 0,
  status text not null default 'unpaid' check (
    status in ('unpaid', 'partial', 'paid')
  ),
  created_at timestamptz not null default now(),
  invoice_type text,
  payment_category text not null default 'treatment_fee' check (
    payment_category in (
      'op_fee',
      'xray_fee',
      'medication_fee',
      'treatment_fee',
      'pending_collection',
      'other'
    )
  ),
  notes text,
  created_by uuid references public.profiles(id) on delete set null
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  amount numeric not null,
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  payment_category text not null default 'pending_collection' check (
    payment_category in (
      'op_fee',
      'xray_fee',
      'medication_fee',
      'treatment_fee',
      'pending_collection',
      'other'
    )
  ),
  collected_by uuid references public.profiles(id) on delete set null
);

create or replace function public.current_profile_clinic_id()
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.clinic_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
  limit 1
$$;

create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
  limit 1
$$;

create or replace function public.collect_reception_fee(
  p_patient_id uuid,
  p_fee_type text,
  p_amount numeric,
  p_payment_method text,
  p_notes text
)
returns table (
  invoice_id uuid,
  payment_id uuid,
  amount numeric,
  fee_type text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic_id uuid;
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_remaining numeric := p_amount;
  v_applied numeric;
begin
  select profile.clinic_id
  into v_clinic_id
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.active = true
  limit 1;

  if v_clinic_id is null or p_amount <= 0 then
    raise exception 'Invalid local fee collection';
  end if;

  for v_invoice in
    select invoice.*
    from public.invoices invoice
    where invoice.clinic_id = v_clinic_id
      and invoice.patient_id = p_patient_id
      and invoice.payment_category = p_fee_type
      and invoice.due_amount > 0
    order by invoice.created_at, invoice.id
    for update
  loop
    exit when v_remaining <= 0;
    v_applied := least(v_remaining, v_invoice.due_amount);

    update public.invoices
    set
      paid_amount = paid_amount + v_applied,
      due_amount = due_amount - v_applied,
      status = case
        when due_amount - v_applied <= 0 then 'paid'
        else 'partial'
      end
    where id = v_invoice.id;

    insert into public.payments (
      clinic_id,
      invoice_id,
      patient_id,
      amount,
      payment_method,
      notes,
      payment_category,
      collected_by
    )
    values (
      v_clinic_id,
      v_invoice.id,
      p_patient_id,
      v_applied,
      p_payment_method,
      p_notes,
      p_fee_type,
      auth.uid()
    )
    returning id into v_payment_id;

    invoice_id := v_invoice.id;
    payment_id := v_payment_id;
    amount := v_applied;
    fee_type := p_fee_type;
    return next;
    v_remaining := v_remaining - v_applied;
  end loop;

  if v_remaining > 0 then
    raise exception 'Amount exceeds pending local balance';
  end if;
end;
$$;

grant execute on function public.current_profile_clinic_id()
  to authenticated;
grant execute on function public.current_profile_role()
  to authenticated;
