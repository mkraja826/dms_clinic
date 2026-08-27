-- CapDent V28 owner/head-doctor controlled resolution for provider-verified payments
-- whose current CapDent balance changed after checkout creation.
--
-- This never refunds money and never over-credits invoices. It applies only the
-- amount still genuinely due across the finalized source invoices. Any verified
-- excess remains explicitly recorded for separate refund/credit handling.

begin;

create table if not exists public.patient_payment_resolution_actions (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.patient_payment_requests(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  action_type text not null,
  verified_amount numeric(12,2) not null check (verified_amount > 0),
  applied_amount numeric(12,2) not null default 0 check (applied_amount >= 0),
  excess_amount numeric(12,2) not null default 0 check (excess_amount >= 0),
  resolved_by uuid not null references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  constraint patient_payment_resolution_actions_type_check check (action_type in ('apply_current_due')),
  constraint patient_payment_resolution_actions_amount_check check (
    round(applied_amount + excess_amount, 2) = round(verified_amount, 2)
  ),
  unique (payment_request_id, action_type)
);

alter table public.patient_payment_resolution_actions enable row level security;
revoke insert, update, delete on public.patient_payment_resolution_actions from anon, authenticated;
grant select on public.patient_payment_resolution_actions to authenticated;

drop policy if exists patient_payment_resolution_actions_select_active_clinic
  on public.patient_payment_resolution_actions;
create policy patient_payment_resolution_actions_select_active_clinic
on public.patient_payment_resolution_actions
for select
to authenticated
using (
  exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.clinic_id = patient_payment_resolution_actions.clinic_id
  )
);

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
    'partially_reconciled_excess',
    'reconciled',
    'failed',
    'expired',
    'cancelled',
    'superseded'
  ));

create or replace function public.resolve_v28_reconciliation_apply_current_due(
  p_payment_request_id uuid,
  p_notes text default null
)
returns table(
  resolution_status text,
  verified_amount numeric,
  applied_amount numeric,
  excess_amount numeric,
  payment_rows integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_request public.patient_payment_requests%rowtype;
  v_bill public.consolidated_bills%rowtype;
  v_account public.clinic_payment_accounts%rowtype;
  v_item record;
  v_current_due numeric(12,2);
  v_remaining numeric(12,2);
  v_apply numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_excess numeric(12,2) := 0;
  v_rows integer := 0;
  v_payment_id uuid;
  v_category text;
  v_method text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id, pr.role
    into v_clinic_id, v_role
  from public.profiles pr
  where pr.id = v_user_id and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  if v_role not in ('owner', 'head_doctor') then
    raise exception 'Only the clinic owner or head doctor can resolve payment reconciliation exceptions';
  end if;

  select * into v_request
  from public.patient_payment_requests
  where id = p_payment_request_id
    and clinic_id = v_clinic_id
  for update;

  if v_request.id is null then
    raise exception 'Payment request not found in your clinic';
  end if;

  if v_request.status <> 'reconciliation_required' or v_request.provider_verified_at is null then
    raise exception 'Only reconciliation-required verified payments can use this resolution';
  end if;

  if exists (
    select 1 from public.patient_payment_resolution_actions a
    where a.payment_request_id = v_request.id
      and a.action_type = 'apply_current_due'
  ) then
    raise exception 'This reconciliation case has already been resolved';
  end if;

  select * into v_bill
  from public.consolidated_bills
  where id = v_request.consolidated_bill_id
    and clinic_id = v_request.clinic_id
    and patient_id = v_request.patient_id
    and status = 'finalized';

  if v_bill.id is null then
    raise exception 'Finalized invoice not found';
  end if;

  select * into v_account
  from public.clinic_payment_accounts
  where id = v_request.payment_account_id
    and clinic_id = v_request.clinic_id
    and provider = v_request.provider;

  if v_account.id is null then
    raise exception 'Receiving account linked to payment request was not found';
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

  if v_current_due < 0 then
    v_current_due := 0;
  end if;

  v_remaining := least(v_request.amount, v_current_due);
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
    if v_apply <= 0 then continue; end if;

    v_category := lower(coalesce(
      nullif(trim(v_item.bill_category), ''),
      nullif(trim(v_item.payment_category), ''),
      nullif(trim(v_item.invoice_type), ''),
      'pending_collection'
    ));

    insert into public.payments (
      clinic_id, invoice_id, patient_id, amount, payment_method, notes,
      payment_category, collected_by
    ) values (
      v_request.clinic_id,
      v_item.id,
      v_request.patient_id,
      v_apply,
      v_method,
      'Owner-resolved verified online payment: applied only current due',
      v_category,
      v_user_id
    ) returning id into v_payment_id;

    perform public.recalculate_invoice_financials(v_item.id);

    insert into public.patient_payment_reconciliation_entries (
      payment_request_id, clinic_id, patient_id, consolidated_bill_id,
      invoice_id, payment_id, amount, payment_account_id, provider,
      provider_merchant_id_snapshot, account_label_snapshot,
      payment_category, line_label
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

  if abs(v_remaining) > 0.01 then
    raise exception 'Current due could not be fully applied to finalized invoice items';
  end if;

  v_excess := greatest(round(v_request.amount - v_applied, 2), 0);

  insert into public.patient_payment_resolution_actions (
    payment_request_id, clinic_id, patient_id, action_type,
    verified_amount, applied_amount, excess_amount, resolved_by, notes
  ) values (
    v_request.id,
    v_request.clinic_id,
    v_request.patient_id,
    'apply_current_due',
    v_request.amount,
    v_applied,
    v_excess,
    v_user_id,
    nullif(trim(coalesce(p_notes, '')), '')
  );

  update public.patient_payment_requests
  set status = case when v_excess > 0 then 'partially_reconciled_excess' else 'reconciled' end,
      reconciled_at = case when v_excess = 0 then now() else reconciled_at end,
      last_checked_at = now(),
      failure_code = case when v_excess > 0 then 'verified_excess_requires_owner_action' else null end,
      failure_message = case
        when v_excess > 0 then 'Verified provider payment exceeded the current CapDent due. Current due was applied; excess remains unresolved for refund or credit handling.'
        else null
      end
  where id = v_request.id;

  resolution_status := case when v_excess > 0 then 'partially_reconciled_excess' else 'reconciled' end;
  verified_amount := v_request.amount;
  applied_amount := v_applied;
  excess_amount := v_excess;
  payment_rows := v_rows;
  return next;
end;
$$;

revoke all on function public.resolve_v28_reconciliation_apply_current_due(uuid, text) from public;
grant execute on function public.resolve_v28_reconciliation_apply_current_due(uuid, text) to authenticated;

comment on function public.resolve_v28_reconciliation_apply_current_due(uuid, text) is
  'Owner/head-doctor controlled resolution: applies only currently due amount from a verified provider payment and leaves any excess explicitly unresolved. Never performs provider refunds.';

commit;
