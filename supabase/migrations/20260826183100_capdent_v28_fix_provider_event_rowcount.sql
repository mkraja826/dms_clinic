-- Correct the V28 provider-event idempotency row-count handling before the
-- provider adapter is enabled. This remains service-role only and still does
-- not write into the legacy CapDent payments ledger.

begin;

drop function if exists public.record_v28_verified_provider_event(uuid, text, text, text, numeric, text, text, boolean);
create function public.record_v28_verified_provider_event(
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

  if v_inserted and p_success then
    update public.patient_payment_requests
    set status = 'provider_verified',
        provider_status = 'success',
        provider_verified_at = now(),
        last_checked_at = now(),
        failure_code = null,
        failure_message = null
    where id = v_request.id
      and status <> 'reconciled';
  elsif v_inserted and not p_success then
    update public.patient_payment_requests
    set status = 'failed',
        provider_status = 'failed',
        last_checked_at = now(),
        failure_code = 'provider_failed',
        failure_message = 'Provider reported that the payment did not succeed.'
    where id = v_request.id
      and status not in ('provider_verified', 'reconciled');
  end if;

  return v_inserted;
end;
$$;

revoke all on function public.record_v28_verified_provider_event(uuid, text, text, text, numeric, text, text, boolean) from public;
grant execute on function public.record_v28_verified_provider_event(uuid, text, text, text, numeric, text, text, boolean) to service_role;

commit;
