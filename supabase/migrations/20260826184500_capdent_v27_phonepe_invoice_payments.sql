-- CapDent V27 PhonePe Payment Gateway foundation.
-- This migration creates an isolated merchant-order ledger and an idempotent,
-- service-role-only settlement RPC. It does not enable PhonePe in any client.

-- Fail before creating any PhonePe objects if the existing billing schema is
-- missing a column required for atomic settlement. Supabase applies migrations
-- transactionally, so a failed preflight leaves the database unchanged.
do $$
declare
  v_missing text[] := array[]::text[];
  v_column text;
begin
  if to_regclass('public.invoices') is null then
    raise exception 'CapDent PhonePe preflight failed: public.invoices does not exist';
  end if;

  if to_regclass('public.payments') is null then
    raise exception 'CapDent PhonePe preflight failed: public.payments does not exist';
  end if;

  foreach v_column in array array[
    'id', 'clinic_id', 'patient_id', 'total_amount', 'paid_amount',
    'due_amount', 'status', 'payment_category'
  ]
  loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'invoices'
        and column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'invoices.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'id', 'clinic_id', 'invoice_id', 'patient_id', 'amount',
    'payment_method', 'notes', 'payment_category', 'collected_by'
  ]
  loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payments'
        and column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'payments.' || v_column);
    end if;
  end loop;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'CapDent PhonePe preflight failed; missing billing columns: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

create table if not exists public.phonepe_payment_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  merchant_order_id text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  state text not null default 'CREATED',
  phonepe_order_id text,
  phonepe_transaction_id text,
  last_status_payload jsonb not null default '{}'::jsonb,
  settled_payment_id uuid references public.payments(id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists phonepe_payment_orders_clinic_created_idx
  on public.phonepe_payment_orders (clinic_id, created_at desc);

create index if not exists phonepe_payment_orders_invoice_created_idx
  on public.phonepe_payment_orders (invoice_id, created_at desc);

create unique index if not exists phonepe_payment_orders_transaction_uidx
  on public.phonepe_payment_orders (phonepe_transaction_id)
  where phonepe_transaction_id is not null;

alter table public.phonepe_payment_orders enable row level security;

revoke all on table public.phonepe_payment_orders from anon, authenticated;
grant all on table public.phonepe_payment_orders to service_role;

create or replace function public.settle_phonepe_invoice_payment_v27(
  p_merchant_order_id text,
  p_phonepe_state text,
  p_phonepe_order_id text default null,
  p_phonepe_transaction_id text default null,
  p_status_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.phonepe_payment_orders%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_amount numeric(12,2);
  v_new_paid numeric(12,2);
  v_new_due numeric(12,2);
  v_state text := upper(coalesce(nullif(trim(p_phonepe_state), ''), 'UNKNOWN'));
begin
  select *
  into v_order
  from public.phonepe_payment_orders
  where merchant_order_id = p_merchant_order_id
  for update;

  if not found then
    raise exception 'PhonePe merchant order not found';
  end if;

  -- Once CapDent has created the canonical payment row, later PhonePe status
  -- responses must never downgrade the merchant ledger away from COMPLETED.
  -- Safe provider metadata can still be refreshed for reconciliation.
  if v_order.settled_payment_id is not null then
    update public.phonepe_payment_orders
    set state = 'COMPLETED',
        phonepe_order_id = coalesce(nullif(p_phonepe_order_id, ''), phonepe_order_id),
        phonepe_transaction_id = coalesce(nullif(p_phonepe_transaction_id, ''), phonepe_transaction_id),
        last_status_payload = coalesce(p_status_payload, '{}'::jsonb),
        updated_at = now()
    where id = v_order.id;

    return jsonb_build_object(
      'settled', true,
      'idempotent', true,
      'state', 'COMPLETED',
      'paymentId', v_order.settled_payment_id
    );
  end if;

  update public.phonepe_payment_orders
  set state = v_state,
      phonepe_order_id = coalesce(nullif(p_phonepe_order_id, ''), phonepe_order_id),
      phonepe_transaction_id = coalesce(nullif(p_phonepe_transaction_id, ''), phonepe_transaction_id),
      last_status_payload = coalesce(p_status_payload, '{}'::jsonb),
      updated_at = now()
  where id = v_order.id;

  if v_state <> 'COMPLETED' then
    return jsonb_build_object(
      'settled', false,
      'idempotent', false,
      'state', v_state
    );
  end if;

  select *
  into v_invoice
  from public.invoices
  where id = v_order.invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found for PhonePe merchant order';
  end if;

  if v_invoice.clinic_id <> v_order.clinic_id or v_invoice.patient_id <> v_order.patient_id then
    raise exception 'PhonePe order does not match invoice ownership';
  end if;

  if round(coalesce(v_invoice.due_amount, 0)::numeric * 100) <> v_order.amount_paise then
    update public.phonepe_payment_orders
    set state = 'REVIEW_REQUIRED',
        updated_at = now()
    where id = v_order.id;

    return jsonb_build_object(
      'settled', false,
      'idempotent', false,
      'state', 'REVIEW_REQUIRED',
      'reason', 'invoice_due_changed'
    );
  end if;

  v_amount := round(v_order.amount_paise::numeric / 100, 2);
  v_new_paid := least(coalesce(v_invoice.total_amount, 0), coalesce(v_invoice.paid_amount, 0) + v_amount);
  v_new_due := greatest(coalesce(v_invoice.total_amount, 0) - v_new_paid, 0);

  insert into public.payments (
    clinic_id,
    invoice_id,
    patient_id,
    amount,
    payment_method,
    notes,
    payment_category,
    collected_by
  ) values (
    v_order.clinic_id,
    v_order.invoice_id,
    v_order.patient_id,
    v_amount,
    'PhonePe',
    'Verified PhonePe payment ' || v_order.merchant_order_id,
    coalesce(v_invoice.payment_category, 'pending_collection'),
    v_order.created_by
  )
  returning id into v_payment_id;

  update public.invoices
  set paid_amount = v_new_paid,
      due_amount = v_new_due,
      status = case
        when v_new_due <= 0 then 'paid'
        when v_new_paid > 0 then 'partial'
        else 'unpaid'
      end
  where id = v_order.invoice_id;

  update public.phonepe_payment_orders
  set state = 'COMPLETED',
      settled_payment_id = v_payment_id,
      settled_at = now(),
      updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'settled', true,
    'idempotent', false,
    'state', 'COMPLETED',
    'paymentId', v_payment_id,
    'invoiceId', v_order.invoice_id
  );
end;
$$;

revoke all on function public.settle_phonepe_invoice_payment_v27(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.settle_phonepe_invoice_payment_v27(text, text, text, text, jsonb) to service_role;
