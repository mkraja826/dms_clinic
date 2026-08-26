-- CapDent V28 consolidated billing foundation
--
-- Additive only. Existing invoices, payments, collect_reception_fee(), and
-- record_patient_payment() are intentionally left untouched.
--
-- Reception selects explicit existing invoice IDs and finalizes one immutable
-- patient-facing invoice snapshot. Nothing is sent automatically.

create table if not exists public.clinic_invoice_sequences (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  calendar_year integer not null,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, calendar_year),
  constraint clinic_invoice_sequences_year_check check (calendar_year between 2020 and 2200),
  constraint clinic_invoice_sequences_last_number_check check (last_number >= 0)
);

create table if not exists public.consolidated_bills (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  invoice_number text not null,
  sequence_year integer not null,
  sequence_number bigint not null,
  status text not null default 'finalized',
  country_code text not null,
  currency_code text not null,
  subtotal numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  paid_at_finalization numeric(12,2) not null default 0,
  due_at_finalization numeric(12,2) not null default 0,
  notes text,
  finalized_by uuid not null references public.profiles(id) on delete restrict,
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  void_reason text,
  constraint consolidated_bills_status_check check (status in ('finalized', 'void')),
  constraint consolidated_bills_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint consolidated_bills_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint consolidated_bills_amounts_check check (
    subtotal >= 0 and total_amount >= 0 and paid_at_finalization >= 0 and due_at_finalization >= 0
  ),
  unique (clinic_id, invoice_number),
  unique (clinic_id, sequence_year, sequence_number)
);

create table if not exists public.consolidated_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.consolidated_bills(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  source_invoice_id uuid not null references public.invoices(id) on delete restrict,
  category text not null,
  label text not null,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null default 0,
  due_amount numeric(12,2) not null default 0,
  source_created_at timestamptz not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint consolidated_bill_items_amounts_check check (
    amount >= 0 and paid_amount >= 0 and due_amount >= 0
  ),
  unique (bill_id, source_invoice_id)
);

create index if not exists consolidated_bills_clinic_patient_idx
  on public.consolidated_bills (clinic_id, patient_id, finalized_at desc);

create index if not exists consolidated_bill_items_bill_idx
  on public.consolidated_bill_items (bill_id, sort_order, source_created_at);

create index if not exists consolidated_bill_items_source_invoice_idx
  on public.consolidated_bill_items (source_invoice_id);

alter table public.clinic_invoice_sequences enable row level security;
alter table public.consolidated_bills enable row level security;
alter table public.consolidated_bill_items enable row level security;

-- Sequence state is backend-only. Authenticated clients must never be able to
-- pick their own invoice number.
revoke all on public.clinic_invoice_sequences from anon, authenticated;

revoke insert, update, delete on public.consolidated_bills from anon, authenticated;
revoke insert, update, delete on public.consolidated_bill_items from anon, authenticated;
grant select on public.consolidated_bills to authenticated;
grant select on public.consolidated_bill_items to authenticated;

-- Read finalized bills only from the user's active clinic. Existing profile
-- clinic scoping remains the compatibility boundary for V28.
drop policy if exists consolidated_bills_select_active_clinic on public.consolidated_bills;
create policy consolidated_bills_select_active_clinic
on public.consolidated_bills
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.clinic_id = consolidated_bills.clinic_id
  )
);

drop policy if exists consolidated_bill_items_select_active_clinic on public.consolidated_bill_items;
create policy consolidated_bill_items_select_active_clinic
on public.consolidated_bill_items
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.clinic_id = consolidated_bill_items.clinic_id
  )
);

create or replace function public.get_v28_invoice_candidates(
  p_patient_id uuid,
  p_since timestamptz default null
)
returns table (
  invoice_id uuid,
  invoice_type text,
  payment_category text,
  label text,
  total_amount numeric,
  paid_amount numeric,
  due_amount numeric,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_patient_clinic_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id, pr.role
  into v_clinic_id, v_role
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  if v_role not in ('owner', 'head_doctor', 'receptionist') then
    raise exception 'Only owner or reception can prepare patient invoices';
  end if;

  select pt.clinic_id
  into v_patient_clinic_id
  from public.patients pt
  where pt.id = p_patient_id
  limit 1;

  if v_patient_clinic_id is null or v_patient_clinic_id <> v_clinic_id then
    raise exception 'Patient does not belong to your clinic';
  end if;

  return query
  select
    i.id,
    i.invoice_type,
    i.payment_category,
    case lower(coalesce(i.invoice_type, i.payment_category, ''))
      when 'op_fee' then 'Consultation / OP Fee'
      when 'consultation_fee' then 'Consultation / OP Fee'
      when 'xray_fee' then 'X-ray Fee'
      when 'medication_fee' then 'Medication Fee'
      when 'treatment_fee' then 'Treatment Fee'
      when 'treatment' then 'Treatment Fee'
      when 'pending_collection' then 'Pending Collection'
      when 'other' then 'Other Clinic Fee'
      else 'Dental Services'
    end as label,
    coalesce(i.total_amount, 0)::numeric,
    coalesce(i.paid_amount, 0)::numeric,
    coalesce(i.due_amount, 0)::numeric,
    coalesce(i.status, 'unpaid')::text,
    i.created_at
  from public.invoices i
  where i.clinic_id = v_clinic_id
    and i.patient_id = p_patient_id
    and i.created_at >= coalesce(p_since, now() - interval '30 days')
    and not exists (
      select 1
      from public.consolidated_bill_items cbi
      join public.consolidated_bills cb on cb.id = cbi.bill_id
      where cbi.source_invoice_id = i.id
        and cb.status = 'finalized'
    )
  order by i.created_at asc, i.id asc;
end;
$$;

revoke all on function public.get_v28_invoice_candidates(uuid, timestamptz) from public;
grant execute on function public.get_v28_invoice_candidates(uuid, timestamptz) to authenticated;

create or replace function public.finalize_v28_consolidated_bill(
  p_patient_id uuid,
  p_source_invoice_ids uuid[],
  p_notes text default null
)
returns table (
  bill_id uuid,
  invoice_number text,
  total_amount numeric,
  paid_amount numeric,
  due_amount numeric,
  country_code text,
  currency_code text,
  finalized_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_patient_clinic_id uuid;
  v_country_code text;
  v_currency_code text;
  v_count integer;
  v_unique_count integer;
  v_sequence_year integer;
  v_sequence_number bigint;
  v_invoice_number text;
  v_bill_id uuid;
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_due numeric(12,2);
  v_finalized_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_source_invoice_ids is null or cardinality(p_source_invoice_ids) = 0 then
    raise exception 'Select at least one charge before finalizing the invoice';
  end if;

  if cardinality(p_source_invoice_ids) > 50 then
    raise exception 'Too many source invoices selected';
  end if;

  select count(distinct source_id)
  into v_unique_count
  from unnest(p_source_invoice_ids) as source_id;

  if v_unique_count <> cardinality(p_source_invoice_ids) then
    raise exception 'Duplicate source invoice selected';
  end if;

  select pr.clinic_id, pr.role
  into v_clinic_id, v_role
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  if v_role not in ('owner', 'head_doctor', 'receptionist') then
    raise exception 'Only owner or reception can finalize patient invoices';
  end if;

  select pt.clinic_id
  into v_patient_clinic_id
  from public.patients pt
  where pt.id = p_patient_id
  limit 1;

  if v_patient_clinic_id is null or v_patient_clinic_id <> v_clinic_id then
    raise exception 'Patient does not belong to your clinic';
  end if;

  -- Prevent two simultaneous finalizations from consuming the same source
  -- invoices for the same patient.
  perform pg_advisory_xact_lock(hashtext(v_clinic_id::text), hashtext(p_patient_id::text));

  select upper(trim(coalesce(c.country_code, ''))), upper(trim(coalesce(c.currency_code, '')))
  into v_country_code, v_currency_code
  from public.clinics c
  where c.id = v_clinic_id
  limit 1;

  if v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Clinic country must be configured before finalizing a V28 invoice';
  end if;

  if v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Clinic currency must be configured before finalizing a V28 invoice';
  end if;

  select count(*)
  into v_count
  from public.invoices i
  where i.id = any(p_source_invoice_ids)
    and i.clinic_id = v_clinic_id
    and i.patient_id = p_patient_id;

  if v_count <> cardinality(p_source_invoice_ids) then
    raise exception 'One or more selected charges do not belong to this patient and clinic';
  end if;

  if exists (
    select 1
    from public.consolidated_bill_items cbi
    join public.consolidated_bills cb on cb.id = cbi.bill_id
    where cbi.source_invoice_id = any(p_source_invoice_ids)
      and cb.status = 'finalized'
  ) then
    raise exception 'One or more selected charges are already part of a finalized invoice';
  end if;

  select
    coalesce(sum(coalesce(i.total_amount, 0)), 0),
    coalesce(sum(coalesce(i.paid_amount, 0)), 0),
    coalesce(sum(coalesce(i.due_amount, 0)), 0)
  into v_total, v_paid, v_due
  from public.invoices i
  where i.id = any(p_source_invoice_ids)
    and i.clinic_id = v_clinic_id
    and i.patient_id = p_patient_id;

  if v_total <= 0 then
    raise exception 'Final invoice total must be greater than zero';
  end if;

  v_sequence_year := extract(year from v_finalized_at)::integer;

  insert into public.clinic_invoice_sequences (
    clinic_id,
    calendar_year,
    last_number,
    updated_at
  )
  values (
    v_clinic_id,
    v_sequence_year,
    1,
    v_finalized_at
  )
  on conflict (clinic_id, calendar_year)
  do update set
    last_number = public.clinic_invoice_sequences.last_number + 1,
    updated_at = excluded.updated_at
  returning last_number into v_sequence_number;

  v_invoice_number := 'CD-' || v_sequence_year::text || '-' || lpad(v_sequence_number::text, 6, '0');

  insert into public.consolidated_bills (
    clinic_id,
    patient_id,
    invoice_number,
    sequence_year,
    sequence_number,
    status,
    country_code,
    currency_code,
    subtotal,
    total_amount,
    paid_at_finalization,
    due_at_finalization,
    notes,
    finalized_by,
    finalized_at,
    created_at
  )
  values (
    v_clinic_id,
    p_patient_id,
    v_invoice_number,
    v_sequence_year,
    v_sequence_number,
    'finalized',
    v_country_code,
    v_currency_code,
    v_total,
    v_total,
    least(v_paid, v_total),
    greatest(v_due, 0),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id,
    v_finalized_at,
    v_finalized_at
  )
  returning id into v_bill_id;

  insert into public.consolidated_bill_items (
    bill_id,
    clinic_id,
    source_invoice_id,
    category,
    label,
    amount,
    paid_amount,
    due_amount,
    source_created_at,
    sort_order
  )
  select
    v_bill_id,
    v_clinic_id,
    i.id,
    lower(coalesce(i.invoice_type, i.payment_category, 'other')),
    case lower(coalesce(i.invoice_type, i.payment_category, ''))
      when 'op_fee' then 'Consultation / OP Fee'
      when 'consultation_fee' then 'Consultation / OP Fee'
      when 'xray_fee' then 'X-ray Fee'
      when 'medication_fee' then 'Medication Fee'
      when 'treatment_fee' then 'Treatment Fee'
      when 'treatment' then 'Treatment Fee'
      when 'pending_collection' then 'Pending Collection'
      when 'other' then 'Other Clinic Fee'
      else 'Dental Services'
    end,
    coalesce(i.total_amount, 0),
    least(coalesce(i.paid_amount, 0), coalesce(i.total_amount, 0)),
    greatest(coalesce(i.due_amount, 0), 0),
    i.created_at,
    row_number() over (order by i.created_at asc, i.id asc)::integer
  from public.invoices i
  where i.id = any(p_source_invoice_ids)
    and i.clinic_id = v_clinic_id
    and i.patient_id = p_patient_id
  order by i.created_at asc, i.id asc;

  bill_id := v_bill_id;
  invoice_number := v_invoice_number;
  total_amount := v_total;
  paid_amount := least(v_paid, v_total);
  due_amount := greatest(v_due, 0);
  country_code := v_country_code;
  currency_code := v_currency_code;
  finalized_at := v_finalized_at;
  return next;
end;
$$;

revoke all on function public.finalize_v28_consolidated_bill(uuid, uuid[], text) from public;
grant execute on function public.finalize_v28_consolidated_bill(uuid, uuid[], text) to authenticated;

comment on table public.consolidated_bills is
  'V28 immutable receptionist-finalized patient-facing invoice header. Does not replace legacy invoices.';
comment on table public.consolidated_bill_items is
  'V28 immutable snapshots of explicit legacy invoice rows selected during finalization.';
comment on function public.finalize_v28_consolidated_bill(uuid, uuid[], text) is
  'Finalizes one consolidated patient invoice without mutating source invoices/payments or sending patient messages.';
