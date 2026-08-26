-- CapDent V28 trusted online-payment reconciliation.
-- Additive only. Android cannot execute this function.
--
-- A provider callback must already have passed signature/authenticity checks and
-- moved patient_payment_requests.status to provider_verified before this runs.
-- The function then re-checks the CURRENT selected legacy invoice balance and
-- writes through the existing CapDent payments ledger exactly once.
--
-- If reception collected any amount after the hosted checkout was created and
-- the current balance no longer equals the provider-paid amount, we DO NOT
-- over-credit invoices. The request is moved to reconciliation_required for an
-- owner/admin resolution (refund/credit decision) instead.

begin;

alter table public.patient_payment_requests
  drop constraint if exists patient_payment_requests_status_check;

alter table public.patient_payment_requests
  add constraint patient_payment_requests_status_check
  check (status in (
    'prepared',
    'provider_pending',
    'pending',
    'provider_verified',
    'reconciliation_required',
    'reconciled',
    'failed',
    'expired',
    'cancelled',
    'superseded'
  ));

create table if not exists public.patient_payment_reconciliation_entries (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.patient_payment_requests(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  consolidated_bill_id uuid not null references public.consolidated_bills(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_request_id, payment_id),
  unique (payment_request_id, invoice_id)
);

comment on table public.patient_payment_reconciliation_entries is
  'Audit mapping from one verified provider request to the existing CapDent payment rows created during reconciliation.';

alter table public.patient_payment_reconciliation_entries enable row level security;
revoke all on table public.patient_payment_reconciliation_entries from anon, authenticated;
grant select on table public.patient_payment_reconciliation_entries to authenticated;

drop policy if exists patient_payment_reconciliation_entries_select_active_clinic
  on public.patient_payment_reconciliation_entries;
create policy patient_payment_reconciliation_entries_select_active_clinic
on public.patient_payment_reconciliation_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.clinic_id = patient_payment_reconciliation_entries.clinic_id
  )
);

create index if not exists patient_payment_reconciliation_entries_request_idx
  on public.patient_payment_reconciliation_entries(payment_request_id, created_at);

-- Service-role only. Returns a safe reconciliation state for the provider
-- adapter/webhook worker. The function is idempotent at the payment request.
drop function if exists public.reconcile_v28_verified_patient_payment(uuid);
create function public.reconcile_v28_verified_patient_payment(p_payment_request_id uuid)
returns table(
  reconciliation_status text,
  applied_amount numeric,
  payment_rows integer,
  current_due numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.patient_payment_requests%rowtype;
  v_bill public.consolidated_bills%rowtype;
  v_invoice public.invoices%rowtype;
  v_remaining numeric(12,2);
  v_current_due numeric(12,2);
  v_apply numeric(12,2);
  v_payment_id uuid;
  v_rows integer := 0;
  v_applied numeric(12,2) := 0;
  v_method text;
begin
  select * into v_request
  from public.patient_payment_requests
  where id = p_payment_request_id
  for update;

  if v_request.id is null then
    raise exception 'Payment request not found';
  end if;

  if v_request.status = 'reconciled' then
    select coalesce(sum(e.amount), 0)::numeric(12,2), count(*)::integer
      into v_applied, v_rows
    from public.patient_payment_reconciliation_entries e
    where e.payment_request_id = v_request.id;

    reconciliation_status := 'reconciled';
    applied_amount := v_applied;
    payment_rows := v_rows;
    current_due := 0;
    return next;
    return;
  end if;

  if v_request.status <> 'provider_verified' or v_request.provider_verified_at is null then
    raise exception 'Only a provider-verified payment request can be reconciled';
  end if;

  select * into v_bill
  from public.consolidated_bills
  where id = v_request.consolidated_bill_id
    and clinic_id = v_request.clinic_id
    and patient_id = v_request.patient_id
    and status = 'finalized';

  if v_bill.id is null then
    raise exception 'Finalized consolidated invoice not found for payment request';
  end if;

  if upper(v_request.currency_code) <> upper(v_bill.currency_code) then
    raise exception 'Payment request currency does not match finalized invoice';
  end if;

  -- Serialize against the same selected legacy invoices that reception chose
  -- for the immutable consolidated invoice.
  perform 1
  from public.invoices i
  join public.consolidated_bill_items bi
    on bi.source_invoice_id = i.id
   and bi.bill_id = v_bill.id
   and bi.clinic_id = v_request.clinic_id
  where i.clinic_id = v_request.clinic_id
    and i.patient_id = v_request.patient_id
  order by bi.sort_order, i.created_at, i.id
  for update of i;

  select coalesce(sum(greatest(coalesce(i.due_amount, 0), 0)), 0)::numeric(12,2)
    into v_current_due
  from public.invoices i
  join public.consolidated_bill_items bi
    on bi.source_invoice_id = i.id
   and bi.bill_id = v_bill.id
   and bi.clinic_id = v_request.clinic_id
  where i.clinic_id = v_request.clinic_id
    and i.patient_id = v_request.patient_id;

  -- The provider has already confirmed real money was collected. If CapDent's
  -- balance changed in the meantime, do not silently over-apply it.
  if round(v_current_due, 2) <> round(v_request.amount, 2) then
    update public.patient_payment_requests
    set status = 'reconciliation_required',
        last_checked_at = now(),
        failure_code = 'balance_changed_after_checkout',
        failure_message = 'Provider payment verified, but the current CapDent invoice balance changed before reconciliation.'
    where id = v_request.id;

    reconciliation_status := 'reconciliation_required';
    applied_amount := 0;
    payment_rows := 0;
    current_due := v_current_due;
    return next;
    return;
  end if;

  v_remaining := v_request.amount;
  v_method := case when v_request.provider = 'phonepe' then 'PhonePe' else 'Card' end;

  for v_invoice in
    select i.*
    from public.invoices i
    join public.consolidated_bill_items bi
      on bi.source_invoice_id = i.id
     and bi.bill_id = v_bill.id
     and bi.clinic_id = v_request.clinic_id
    where i.clinic_id = v_request.clinic_id
      and i.patient_id = v_request.patient_id
      and greatest(coalesce(i.due_amount, 0), 0) > 0
    order by bi.sort_order, i.created_at, i.id
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_remaining, greatest(coalesce(v_invoice.due_amount, 0), 0));

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
      v_request.clinic_id,
      v_invoice.id,
      v_request.patient_id,
      v_apply,
      v_method,
      'Verified online patient payment',
      coalesce(nullif(trim(v_invoice.payment_category), ''), 'pending_collection'),
      v_request.requested_by
    )
    returning id into v_payment_id;

    -- Use the existing production financial recalculation logic so invoice
    -- paid/due/status is derived from the payment ledger and current controls.
    perform public.recalculate_invoice_financials(v_invoice.id);

    insert into public.patient_payment_reconciliation_entries (
      payment_request_id,
      clinic_id,
      patient_id,
      consolidated_bill_id,
      invoice_id,
      payment_id,
      amount
    ) values (
      v_request.id,
      v_request.clinic_id,
      v_request.patient_id,
      v_bill.id,
      v_invoice.id,
      v_payment_id,
      v_apply
    );

    v_remaining := round(v_remaining - v_apply, 2);
    v_applied := round(v_applied + v_apply, 2);
    v_rows := v_rows + 1;
  end loop;

  if abs(v_remaining) > 0.01 or round(v_applied, 2) <> round(v_request.amount, 2) then
    raise exception 'Verified payment could not be fully allocated to the selected invoices';
  end if;

  update public.patient_payment_requests
  set status = 'reconciled',
      reconciled_at = now(),
      last_checked_at = now(),
      failure_code = null,
      failure_message = null
  where id = v_request.id;

  reconciliation_status := 'reconciled';
  applied_amount := v_applied;
  payment_rows := v_rows;
  current_due := 0;
  return next;
end;
$$;

revoke all on function public.reconcile_v28_verified_patient_payment(uuid) from public;
grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to service_role;

commit;
