-- CapDent V28: trace each verified online payment to the exact clinic receiving
-- account and finalized bill category used during reconciliation.

begin;

alter table public.patient_payment_reconciliation_entries
  add column if not exists payment_account_id uuid references public.clinic_payment_accounts(id) on delete restrict,
  add column if not exists provider text,
  add column if not exists provider_merchant_id_snapshot text,
  add column if not exists account_label_snapshot text,
  add column if not exists payment_category text,
  add column if not exists line_label text;

create index if not exists patient_payment_reconciliation_entries_account_idx
  on public.patient_payment_reconciliation_entries(payment_account_id, created_at);

comment on column public.patient_payment_reconciliation_entries.payment_account_id is
  'Exact clinic receiving account used by the verified provider request.';
comment on column public.patient_payment_reconciliation_entries.provider_merchant_id_snapshot is
  'Provider merchant identifier snapshot for audit. This is not an API secret.';
comment on column public.patient_payment_reconciliation_entries.payment_category is
  'Finalized bill category allocated to this existing CapDent payment row.';

create or replace function public.reconcile_v28_verified_patient_payment(p_payment_request_id uuid)
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
  v_account public.clinic_payment_accounts%rowtype;
  v_item record;
  v_remaining numeric(12,2);
  v_current_due numeric(12,2);
  v_apply numeric(12,2);
  v_payment_id uuid;
  v_rows integer := 0;
  v_applied numeric(12,2) := 0;
  v_method text;
  v_category text;
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

  select * into v_account
  from public.clinic_payment_accounts
  where id = v_request.payment_account_id
    and clinic_id = v_request.clinic_id
    and provider = v_request.provider;

  if v_account.id is null then
    raise exception 'Receiving account linked to payment request was not found';
  end if;

  if upper(v_request.currency_code) <> upper(v_bill.currency_code) then
    raise exception 'Payment request currency does not match finalized invoice';
  end if;

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

  for v_item in
    select
      i.*,
      bi.category as bill_category,
      bi.label as bill_label,
      bi.sort_order as bill_sort_order
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
    v_apply := least(v_remaining, greatest(coalesce(v_item.due_amount, 0), 0));
    v_category := lower(coalesce(
      nullif(trim(v_item.bill_category), ''),
      nullif(trim(v_item.payment_category), ''),
      nullif(trim(v_item.invoice_type), ''),
      'pending_collection'
    ));

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
      v_item.id,
      v_request.patient_id,
      v_apply,
      v_method,
      'Verified online patient payment',
      v_category,
      v_request.requested_by
    )
    returning id into v_payment_id;

    perform public.recalculate_invoice_financials(v_item.id);

    insert into public.patient_payment_reconciliation_entries (
      payment_request_id,
      clinic_id,
      patient_id,
      consolidated_bill_id,
      invoice_id,
      payment_id,
      amount,
      payment_account_id,
      provider,
      provider_merchant_id_snapshot,
      account_label_snapshot,
      payment_category,
      line_label
    ) values (
      v_request.id,
      v_request.clinic_id,
      v_request.patient_id,
      v_bill.id,
      v_item.id,
      v_payment_id,
      v_apply,
      v_account.id,
      v_request.provider,
      v_account.provider_merchant_id,
      v_account.account_label,
      v_category,
      coalesce(nullif(trim(v_item.bill_label), ''), 'Dental Services')
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
