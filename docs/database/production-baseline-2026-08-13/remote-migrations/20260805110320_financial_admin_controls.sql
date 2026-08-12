alter table public.payments
  add column if not exists status text not null default 'active',
  add column if not exists original_payment_id uuid references public.payments(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

alter table public.invoices
  add column if not exists original_total_amount numeric,
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists waived_amount numeric not null default 0,
  add column if not exists refunded_amount numeric not null default 0,
  add column if not exists version_number integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

update public.invoices
set original_total_amount = total_amount
where original_total_amount is null;

alter table public.invoices
  alter column original_total_amount set not null;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('active', 'corrected', 'voided', 'refund'));

alter table public.invoices drop constraint if exists invoices_financial_amounts_check;
alter table public.invoices
  add constraint invoices_financial_amounts_check
  check (
    original_total_amount >= 0
    and total_amount >= 0
    and paid_amount >= 0
    and due_amount >= 0
    and discount_amount >= 0
    and waived_amount >= 0
    and refunded_amount >= 0
    and version_number >= 1
  );

create index if not exists payments_invoice_status_idx
  on public.payments (invoice_id, status, created_at);
create index if not exists payments_original_payment_idx
  on public.payments (original_payment_id, created_at);
create index if not exists invoices_clinic_updated_idx
  on public.invoices (clinic_id, updated_at desc);

create table if not exists public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete set null,
  related_payment_id uuid references public.payments(id) on delete set null,
  adjustment_type text not null check (
    adjustment_type in ('payment_correction', 'payment_void', 'refund', 'refund_void', 'discount', 'waiver')
  ),
  amount numeric not null check (amount >= 0),
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  reason text not null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists financial_adjustments_clinic_created_idx
  on public.financial_adjustments (clinic_id, created_at desc);
create index if not exists financial_adjustments_invoice_created_idx
  on public.financial_adjustments (invoice_id, created_at desc);
create index if not exists financial_adjustments_payment_created_idx
  on public.financial_adjustments (payment_id, created_at desc);

create table if not exists public.invoice_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  version_number integer not null,
  change_type text not null,
  adjustment_id uuid references public.financial_adjustments(id) on delete set null,
  snapshot jsonb not null,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (invoice_id, version_number)
);

create index if not exists invoice_versions_clinic_created_idx
  on public.invoice_versions (clinic_id, created_at desc);
create index if not exists invoice_versions_invoice_version_idx
  on public.invoice_versions (invoice_id, version_number desc);

alter table public.financial_adjustments enable row level security;
alter table public.invoice_versions enable row level security;

drop policy if exists financial_adjustments_owner_select on public.financial_adjustments;
create policy financial_adjustments_owner_select
  on public.financial_adjustments
  for select
  to authenticated
  using (
    clinic_id = public.current_user_clinic_id()
    and public.current_user_is_owner()
  );

drop policy if exists invoice_versions_owner_select on public.invoice_versions;
create policy invoice_versions_owner_select
  on public.invoice_versions
  for select
  to authenticated
  using (
    clinic_id = public.current_user_clinic_id()
    and public.current_user_is_owner()
  );

create or replace function public.set_invoice_financial_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.original_total_amount := coalesce(new.original_total_amount, new.total_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.waived_amount := coalesce(new.waived_amount, 0);
  new.refunded_amount := coalesce(new.refunded_amount, 0);
  new.version_number := coalesce(new.version_number, 1);
  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$$;

drop trigger if exists invoices_set_financial_defaults on public.invoices;
create trigger invoices_set_financial_defaults
before insert on public.invoices
for each row execute function public.set_invoice_financial_defaults();

create or replace function public.seed_invoice_version_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.invoice_versions (
    clinic_id, patient_id, invoice_id, version_number, change_type,
    snapshot, reason, created_by, created_at
  ) values (
    new.clinic_id,
    new.patient_id,
    new.id,
    new.version_number,
    'created',
    jsonb_build_object(
      'original_total_amount', new.original_total_amount,
      'total_amount', new.total_amount,
      'paid_amount', new.paid_amount,
      'due_amount', new.due_amount,
      'discount_amount', new.discount_amount,
      'waived_amount', new.waived_amount,
      'refunded_amount', new.refunded_amount,
      'status', new.status,
      'invoice_type', new.invoice_type,
      'payment_category', new.payment_category,
      'notes', new.notes
    ),
    'Initial invoice version',
    new.created_by,
    new.created_at
  ) on conflict (invoice_id, version_number) do nothing;
  return new;
end;
$$;

drop trigger if exists invoices_seed_version on public.invoices;
create trigger invoices_seed_version
after insert on public.invoices
for each row execute function public.seed_invoice_version_after_insert();

insert into public.invoice_versions (
  clinic_id, patient_id, invoice_id, version_number, change_type,
  snapshot, reason, created_by, created_at
)
select
  i.clinic_id,
  i.patient_id,
  i.id,
  i.version_number,
  'baseline',
  jsonb_build_object(
    'original_total_amount', i.original_total_amount,
    'total_amount', i.total_amount,
    'paid_amount', i.paid_amount,
    'due_amount', i.due_amount,
    'discount_amount', i.discount_amount,
    'waived_amount', i.waived_amount,
    'refunded_amount', i.refunded_amount,
    'status', i.status,
    'invoice_type', i.invoice_type,
    'payment_category', i.payment_category,
    'notes', i.notes
  ),
  'Baseline captured when financial administration was enabled',
  i.created_by,
  i.created_at
from public.invoices i
on conflict (invoice_id, version_number) do nothing;

create or replace function public.recalculate_invoice_financials(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_paid numeric;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  select coalesce(sum(p.amount), 0)
  into v_paid
  from public.payments p
  where p.invoice_id = p_invoice_id
    and p.status in ('active', 'corrected', 'refund');

  if v_paid < 0 then
    raise exception 'Refunds cannot exceed payments received.' using errcode = '22023';
  end if;

  if v_paid > v_invoice.total_amount + 0.01 then
    raise exception 'Effective payments cannot exceed the current invoice total.' using errcode = '22023';
  end if;

  update public.invoices
  set
    paid_amount = v_paid,
    due_amount = greatest(total_amount - v_paid, 0),
    status = public.invoice_status(total_amount, v_paid),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

create or replace function public.append_invoice_version(
  p_invoice_id uuid,
  p_change_type text,
  p_adjustment_id uuid,
  p_reason text
)
returns public.invoice_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_version public.invoice_versions;
begin
  update public.invoices
  set version_number = version_number + 1,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_invoice_id
  returning * into v_invoice;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  insert into public.invoice_versions (
    clinic_id, patient_id, invoice_id, version_number, change_type,
    adjustment_id, snapshot, reason, created_by
  ) values (
    v_invoice.clinic_id,
    v_invoice.patient_id,
    v_invoice.id,
    v_invoice.version_number,
    p_change_type,
    p_adjustment_id,
    jsonb_build_object(
      'original_total_amount', v_invoice.original_total_amount,
      'total_amount', v_invoice.total_amount,
      'paid_amount', v_invoice.paid_amount,
      'due_amount', v_invoice.due_amount,
      'discount_amount', v_invoice.discount_amount,
      'waived_amount', v_invoice.waived_amount,
      'refunded_amount', v_invoice.refunded_amount,
      'status', v_invoice.status,
      'invoice_type', v_invoice.invoice_type,
      'payment_category', v_invoice.payment_category,
      'notes', v_invoice.notes
    ),
    trim(p_reason),
    auth.uid()
  ) returning * into v_version;

  return v_version;
end;
$$;

create or replace function public.admin_correct_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_category text,
  p_notes text,
  p_paid_at timestamptz,
  p_reason text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old_payment public.payments;
  v_new_payment public.payments;
  v_old_invoice public.invoices;
  v_new_invoice public.invoices;
  v_other_net numeric;
  v_adjustment_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can correct payments.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A correction reason is required.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Corrected payment amount must be greater than zero.' using errcode = '22023';
  end if;
  if p_payment_category not in ('op_fee', 'xray_fee', 'medication_fee', 'treatment_fee', 'pending_collection', 'other') then
    raise exception 'Invalid payment category.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'Payment method is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_old_payment
  from public.payments
  where id = p_payment_id and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Payment was not found in your clinic.' using errcode = 'P0002';
  end if;
  if v_old_payment.status not in ('active', 'corrected') or v_old_payment.amount <= 0 then
    raise exception 'Only an active positive payment can be corrected.' using errcode = '22023';
  end if;

  select * into v_old_invoice
  from public.invoices
  where id = v_old_payment.invoice_id and clinic_id = v_clinic_id
  for update;

  select coalesce(sum(amount), 0)
  into v_other_net
  from public.payments
  where invoice_id = v_old_payment.invoice_id
    and id <> v_old_payment.id
    and status in ('active', 'corrected', 'refund');

  if v_other_net + p_amount < 0 or v_other_net + p_amount > v_old_invoice.total_amount + 0.01 then
    raise exception 'Corrected payment would make the invoice balance invalid.' using errcode = '22023';
  end if;

  update public.payments
  set
    amount = p_amount,
    payment_method = trim(p_payment_method),
    payment_category = p_payment_category,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    created_at = coalesce(p_paid_at, created_at),
    status = 'corrected',
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_payment_id
  returning * into v_new_payment;

  v_new_invoice := public.recalculate_invoice_financials(v_old_payment.invoice_id);

  insert into public.financial_adjustments (
    clinic_id, patient_id, invoice_id, payment_id, adjustment_type, amount,
    old_values, new_values, reason, notes, created_by
  ) values (
    v_clinic_id,
    v_old_payment.patient_id,
    v_old_payment.invoice_id,
    v_old_payment.id,
    'payment_correction',
    abs(p_amount - v_old_payment.amount),
    jsonb_build_object('payment', to_jsonb(v_old_payment), 'invoice', to_jsonb(v_old_invoice)),
    jsonb_build_object('payment', to_jsonb(v_new_payment), 'invoice', to_jsonb(v_new_invoice)),
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_adjustment_id;

  perform public.append_invoice_version(v_old_payment.invoice_id, 'payment_correction', v_adjustment_id, p_reason);
  return v_new_payment;
end;
$$;

create or replace function public.admin_void_payment(
  p_payment_id uuid,
  p_reason text,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old_payment public.payments;
  v_new_payment public.payments;
  v_old_invoice public.invoices;
  v_new_invoice public.invoices;
  v_adjustment_id uuid;
  v_type text;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can void financial entries.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A void reason is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_old_payment
  from public.payments
  where id = p_payment_id and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Payment was not found in your clinic.' using errcode = 'P0002';
  end if;
  if v_old_payment.status = 'voided' then
    raise exception 'This financial entry is already voided.' using errcode = '22023';
  end if;

  select * into v_old_invoice
  from public.invoices
  where id = v_old_payment.invoice_id and clinic_id = v_clinic_id
  for update;

  v_type := case when v_old_payment.status = 'refund' then 'refund_void' else 'payment_void' end;

  update public.payments
  set amount = 0,
      status = 'voided',
      notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_payment_id
  returning * into v_new_payment;

  if v_old_payment.status = 'refund' then
    update public.invoices
    set refunded_amount = greatest(refunded_amount - abs(v_old_payment.amount), 0)
    where id = v_old_payment.invoice_id;
  end if;

  v_new_invoice := public.recalculate_invoice_financials(v_old_payment.invoice_id);

  insert into public.financial_adjustments (
    clinic_id, patient_id, invoice_id, payment_id, adjustment_type, amount,
    old_values, new_values, reason, notes, created_by
  ) values (
    v_clinic_id,
    v_old_payment.patient_id,
    v_old_payment.invoice_id,
    v_old_payment.id,
    v_type,
    abs(v_old_payment.amount),
    jsonb_build_object('payment', to_jsonb(v_old_payment), 'invoice', to_jsonb(v_old_invoice)),
    jsonb_build_object('payment', to_jsonb(v_new_payment), 'invoice', to_jsonb(v_new_invoice)),
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_adjustment_id;

  perform public.append_invoice_version(v_old_payment.invoice_id, v_type, v_adjustment_id, p_reason);
  return v_new_payment;
end;
$$;

create or replace function public.admin_refund_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_refund_method text,
  p_notes text,
  p_reason text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_original public.payments;
  v_refund public.payments;
  v_old_invoice public.invoices;
  v_new_invoice public.invoices;
  v_refunded numeric;
  v_adjustment_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can issue refunds.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A refund reason is required.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Refund amount must be greater than zero.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_refund_method, '')), '') is null then
    raise exception 'Refund method is required.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  select * into v_original
  from public.payments
  where id = p_payment_id and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Payment was not found in your clinic.' using errcode = 'P0002';
  end if;
  if v_original.status not in ('active', 'corrected') or v_original.amount <= 0 then
    raise exception 'Only an active positive payment can be refunded.' using errcode = '22023';
  end if;

  select * into v_old_invoice
  from public.invoices
  where id = v_original.invoice_id and clinic_id = v_clinic_id
  for update;

  select coalesce(-sum(amount), 0)
  into v_refunded
  from public.payments
  where original_payment_id = v_original.id
    and status = 'refund';

  if p_amount > v_original.amount - v_refunded + 0.01 then
    raise exception 'Refund exceeds the refundable amount for this payment.' using errcode = '22023';
  end if;
  if p_amount > v_old_invoice.paid_amount + 0.01 then
    raise exception 'Refund exceeds the effective amount paid on this invoice.' using errcode = '22023';
  end if;

  insert into public.payments (
    clinic_id, invoice_id, patient_id, amount, payment_method, notes,
    payment_category, collected_by, status, original_payment_id, updated_by
  ) values (
    v_clinic_id,
    v_original.invoice_id,
    v_original.patient_id,
    -p_amount,
    trim(p_refund_method),
    coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Clinic Admin refund'),
    v_original.payment_category,
    auth.uid(),
    'refund',
    v_original.id,
    auth.uid()
  ) returning * into v_refund;

  update public.invoices
  set refunded_amount = refunded_amount + p_amount
  where id = v_original.invoice_id;

  v_new_invoice := public.recalculate_invoice_financials(v_original.invoice_id);

  insert into public.financial_adjustments (
    clinic_id, patient_id, invoice_id, payment_id, related_payment_id,
    adjustment_type, amount, old_values, new_values, reason, notes, created_by
  ) values (
    v_clinic_id,
    v_original.patient_id,
    v_original.invoice_id,
    v_original.id,
    v_refund.id,
    'refund',
    p_amount,
    jsonb_build_object('payment', to_jsonb(v_original), 'invoice', to_jsonb(v_old_invoice)),
    jsonb_build_object('refund_payment', to_jsonb(v_refund), 'invoice', to_jsonb(v_new_invoice)),
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_adjustment_id;

  perform public.append_invoice_version(v_original.invoice_id, 'refund', v_adjustment_id, p_reason);
  return v_refund;
end;
$$;

create or replace function public.admin_apply_invoice_discount(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old public.invoices;
  v_new public.invoices;
  v_adjustment_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can apply discounts.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A discount reason is required.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Discount amount must be greater than zero.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();
  select * into v_old
  from public.invoices
  where id = p_invoice_id and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Invoice was not found in your clinic.' using errcode = 'P0002';
  end if;
  if p_amount > v_old.due_amount + 0.01 then
    raise exception 'Discount cannot exceed the current outstanding amount.' using errcode = '22023';
  end if;

  update public.invoices
  set total_amount = total_amount - p_amount,
      discount_amount = discount_amount + p_amount,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_invoice_id;

  v_new := public.recalculate_invoice_financials(p_invoice_id);

  insert into public.financial_adjustments (
    clinic_id, patient_id, invoice_id, adjustment_type, amount,
    old_values, new_values, reason, notes, created_by
  ) values (
    v_clinic_id,
    v_old.patient_id,
    v_old.id,
    'discount',
    p_amount,
    to_jsonb(v_old),
    to_jsonb(v_new),
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_adjustment_id;

  perform public.append_invoice_version(p_invoice_id, 'discount', v_adjustment_id, p_reason);
  select * into v_new from public.invoices where id = p_invoice_id;
  return v_new;
end;
$$;

create or replace function public.admin_waive_invoice_due(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_old public.invoices;
  v_new public.invoices;
  v_adjustment_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can waive outstanding balances.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A waiver reason is required.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Waiver amount must be greater than zero.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();
  select * into v_old
  from public.invoices
  where id = p_invoice_id and clinic_id = v_clinic_id
  for update;

  if not found then
    raise exception 'Invoice was not found in your clinic.' using errcode = 'P0002';
  end if;
  if p_amount > v_old.due_amount + 0.01 then
    raise exception 'Waiver cannot exceed the current outstanding amount.' using errcode = '22023';
  end if;

  update public.invoices
  set total_amount = total_amount - p_amount,
      waived_amount = waived_amount + p_amount,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_invoice_id;

  v_new := public.recalculate_invoice_financials(p_invoice_id);

  insert into public.financial_adjustments (
    clinic_id, patient_id, invoice_id, adjustment_type, amount,
    old_values, new_values, reason, notes, created_by
  ) values (
    v_clinic_id,
    v_old.patient_id,
    v_old.id,
    'waiver',
    p_amount,
    to_jsonb(v_old),
    to_jsonb(v_new),
    trim(p_reason),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  ) returning id into v_adjustment_id;

  perform public.append_invoice_version(p_invoice_id, 'waiver', v_adjustment_id, p_reason);
  select * into v_new from public.invoices where id = p_invoice_id;
  return v_new;
end;
$$;

create or replace function public.enqueue_capdent_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.amount > 0
    and coalesce(new.status, 'active') in ('active', 'corrected')
    and coalesce(
      (select c.payment_push_enabled from public.clinics c where c.id = new.clinic_id),
      false
    )
  then
    insert into public.payment_notification_jobs (clinic_id, payment_id)
    values (new.clinic_id, new.id)
    on conflict (payment_id) do nothing;
  end if;

  return new;
exception
  when others then
    raise warning 'CapDent payment notification enqueue skipped for payment %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.recalculate_invoice_financials(uuid) from public, authenticated;
revoke all on function public.append_invoice_version(uuid, text, uuid, text) from public, authenticated;

revoke all on function public.admin_correct_payment(uuid, numeric, text, text, text, timestamptz, text) from public;
grant execute on function public.admin_correct_payment(uuid, numeric, text, text, text, timestamptz, text) to authenticated;

revoke all on function public.admin_void_payment(uuid, text, text) from public;
grant execute on function public.admin_void_payment(uuid, text, text) to authenticated;

revoke all on function public.admin_refund_payment(uuid, numeric, text, text, text) from public;
grant execute on function public.admin_refund_payment(uuid, numeric, text, text, text) to authenticated;

revoke all on function public.admin_apply_invoice_discount(uuid, numeric, text, text) from public;
grant execute on function public.admin_apply_invoice_discount(uuid, numeric, text, text) to authenticated;

revoke all on function public.admin_waive_invoice_due(uuid, numeric, text, text) from public;
grant execute on function public.admin_waive_invoice_due(uuid, numeric, text, text) to authenticated;
