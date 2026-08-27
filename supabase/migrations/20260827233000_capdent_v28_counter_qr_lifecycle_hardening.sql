-- CapDent V28 counter QR lifecycle hardening.
-- Preserve late provider successes for replaced/expired/cancelled requests as
-- reconciliation-required money instead of silently applying or losing them.
-- Keep provider events idempotent and preserve terminal failure semantics.

begin;

create or replace function public.record_v28_verified_provider_event(
  p_payment_request_id uuid,
  p_provider_event_id text,
  p_provider_request_id text,
  p_event_type text,
  p_amount numeric,
  p_currency_code text,
  p_payload_digest text,
  p_success boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.patient_payment_requests%rowtype;
  v_row_count integer := 0;
  v_inserted boolean := false;
  v_event_type text := upper(trim(coalesce(p_event_type, 'payment_update')));
begin
  select * into v_request
  from public.patient_payment_requests
  where id = p_payment_request_id
  for update;

  if v_request.id is null then
    raise exception 'Payment request not found';
  end if;

  if nullif(trim(coalesce(p_provider_event_id, '')), '') is null then
    raise exception 'Provider event ID is required';
  end if;

  if nullif(trim(coalesce(p_payload_digest, '')), '') is null then
    raise exception 'Verified payload digest is required';
  end if;

  if v_request.provider_request_id is not null
     and nullif(trim(coalesce(p_provider_request_id, '')), '') is distinct from v_request.provider_request_id
  then
    raise exception 'Provider request ID does not match the prepared payment request';
  end if;

  if upper(trim(coalesce(p_currency_code, ''))) <> v_request.currency_code then
    raise exception 'Provider currency does not match the payment request';
  end if;

  if round(coalesce(p_amount, -1)::numeric, 2) <> round(v_request.amount::numeric, 2) then
    raise exception 'Provider amount does not match the payment request';
  end if;

  insert into public.patient_payment_provider_events (
    payment_request_id,
    clinic_id,
    provider,
    provider_event_id,
    provider_request_id,
    event_type,
    provider_status,
    amount,
    currency_code,
    payload_digest,
    verified,
    verified_at,
    processed_at
  ) values (
    v_request.id,
    v_request.clinic_id,
    v_request.provider,
    trim(p_provider_event_id),
    nullif(trim(coalesce(p_provider_request_id, '')), ''),
    trim(coalesce(p_event_type, 'payment_update')),
    case when p_success then 'success' else 'failed' end,
    p_amount,
    upper(trim(p_currency_code)),
    trim(p_payload_digest),
    true,
    now(),
    now()
  )
  on conflict (provider, provider_event_id) do nothing;

  get diagnostics v_row_count = row_count;
  v_inserted := v_row_count > 0;

  if not v_inserted then
    return false;
  end if;

  if p_success then
    -- If the QR was already replaced/expired/cancelled/failed locally but the
    -- provider independently confirms money arrived, never auto-apply it.
    if v_request.status in ('superseded', 'expired', 'cancelled', 'failed') then
      update public.patient_payment_requests
      set status = 'reconciliation_required',
          provider_status = 'success',
          provider_verified_at = coalesce(provider_verified_at, now()),
          last_checked_at = now(),
          failure_code = 'late_provider_success_after_terminal_request',
          failure_message = 'Provider confirmed payment after this QR/request was already replaced, expired, cancelled, or failed. Money is held for owner reconciliation and was not auto-applied.'
      where id = v_request.id
        and status <> 'reconciled';
    else
      update public.patient_payment_requests
      set status = 'provider_verified',
          provider_status = 'success',
          provider_verified_at = coalesce(provider_verified_at, now()),
          last_checked_at = now(),
          failure_code = null,
          failure_message = null
      where id = v_request.id
        and status not in ('reconciled', 'partially_reconciled_excess');
    end if;
  else
    -- A provider-side expiry is distinct from a payment failure. Do not replace
    -- a locally superseded/cancelled/reconciled state with a less useful one.
    update public.patient_payment_requests
    set status = case
          when status in ('superseded', 'cancelled', 'reconciled', 'partially_reconciled_excess') then status
          when v_event_type like '%:EXPIRED' then 'expired'
          else 'failed'
        end,
        provider_status = case when v_event_type like '%:EXPIRED' then 'expired' else 'failed' end,
        last_checked_at = now(),
        failure_code = case
          when status in ('superseded', 'cancelled', 'reconciled', 'partially_reconciled_excess') then failure_code
          when v_event_type like '%:EXPIRED' then 'provider_expired'
          else 'provider_failed'
        end,
        failure_message = case
          when status in ('superseded', 'cancelled', 'reconciled', 'partially_reconciled_excess') then failure_message
          when v_event_type like '%:EXPIRED' then 'Provider reported that the payment request expired without a successful payment.'
          else 'Provider reported that the payment did not succeed.'
        end
    where id = v_request.id;
  end if;

  return true;
end;
$$;

revoke all on function public.record_v28_verified_provider_event(uuid,text,text,text,numeric,text,text,boolean) from public, anon, authenticated;
grant execute on function public.record_v28_verified_provider_event(uuid,text,text,text,numeric,text,text,boolean) to service_role;

-- Dispatcher remains service-only and becomes safe when a late successful
-- provider payment was intentionally placed in reconciliation_required.
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
  v_due numeric(12,2) := 0;
begin
  select * into v_request
  from public.patient_payment_requests
  where id = p_payment_request_id;

  if v_request.id is null then
    raise exception 'Payment request not found';
  end if;

  if v_request.status = 'reconciliation_required' then
    if v_request.request_mode = 'counter_qr' then
      select coalesce(sum(greatest(coalesce(i.due_amount,0),0)),0)::numeric(12,2)
        into v_due
      from public.invoices i
      where i.clinic_id = v_request.clinic_id
        and i.patient_id = v_request.patient_id
        and greatest(coalesce(i.due_amount,0),0) > 0
        and lower(coalesce(nullif(trim(i.payment_category),''),nullif(trim(i.invoice_type),''),'other')) = v_request.payment_category;
    elsif v_request.consolidated_bill_id is not null then
      select coalesce(sum(greatest(coalesce(i.due_amount,0),0)),0)::numeric(12,2)
        into v_due
      from public.invoices i
      join public.consolidated_bill_items bi
        on bi.source_invoice_id = i.id
       and bi.bill_id = v_request.consolidated_bill_id
       and bi.clinic_id = v_request.clinic_id
      where i.clinic_id = v_request.clinic_id
        and i.patient_id = v_request.patient_id;
    end if;

    reconciliation_status := 'reconciliation_required';
    applied_amount := 0;
    payment_rows := 0;
    current_due := coalesce(v_due,0);
    return next;
    return;
  end if;

  if v_request.request_mode = 'counter_qr' then
    return query
    select
      c.reconciliation_status,
      c.applied_amount,
      c.payment_rows,
      c.current_category_due as current_due
    from public.reconcile_v28_verified_counter_payment(p_payment_request_id) c;
    return;
  end if;

  return query
  select
    f.reconciliation_status,
    f.applied_amount,
    f.payment_rows,
    f.current_due
  from public.reconcile_v28_verified_finalized_invoice_payment(p_payment_request_id) f;
end;
$$;

revoke all on function public.reconcile_v28_verified_patient_payment(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to service_role;

comment on function public.record_v28_verified_provider_event(uuid,text,text,text,numeric,text,text,boolean) is
  'Records a provider-verified event idempotently. Late successes after a local terminal/replaced QR are held in reconciliation_required and never auto-applied.';

comment on function public.reconcile_v28_verified_patient_payment(uuid) is
  'Service-only V28 reconciliation dispatcher. Returns a no-money-movement hold result for reconciliation_required requests.';

commit;
