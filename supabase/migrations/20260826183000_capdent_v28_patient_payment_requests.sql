-- CapDent V28 patient online-payment request and provider-event foundation.
-- Additive only. This migration does NOT call or modify the existing
-- record_patient_payment(), collect_reception_fee(), payments, or invoices paths.
--
-- Flow:
-- finalized consolidated bill -> server prepares exact remaining-balance request
-- -> trusted provider adapter attaches checkout URL/provider request ID
-- -> trusted webhook records a verified event
-- -> a later reconciliation layer writes the verified payment into CapDent's
--    existing ledger exactly once.
--
-- Provider routing is server-authoritative:
-- explicit clinic country IN -> PhonePe
-- any other explicitly configured country -> card
-- missing/invalid country -> no online payment request.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.patient_payment_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  consolidated_bill_id uuid not null references public.consolidated_bills(id) on delete restrict,
  payment_account_id uuid not null references public.clinic_payment_accounts(id) on delete restrict,
  provider text not null check (provider in ('phonepe', 'card')),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'prepared'
    check (status in (
      'prepared',
      'provider_pending',
      'pending',
      'provider_verified',
      'reconciled',
      'failed',
      'expired',
      'cancelled',
      'superseded'
    )),
  idempotency_key text not null unique,
  provider_request_id text,
  checkout_url text,
  provider_status text,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  provider_verified_at timestamptz,
  reconciled_at timestamptz,
  expires_at timestamptz,
  last_checked_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists patient_payment_requests_provider_request_uidx
  on public.patient_payment_requests(provider, provider_request_id)
  where provider_request_id is not null;

create index if not exists patient_payment_requests_bill_idx
  on public.patient_payment_requests(consolidated_bill_id, created_at desc);

create index if not exists patient_payment_requests_clinic_status_idx
  on public.patient_payment_requests(clinic_id, status, created_at desc);

-- At most one live request per finalized bill. If the actual remaining balance
-- changes, prepare_v28_patient_payment_request() supersedes the stale request
-- before creating a new one.
create unique index if not exists patient_payment_requests_one_live_bill_idx
  on public.patient_payment_requests(consolidated_bill_id)
  where status in ('prepared', 'provider_pending', 'pending', 'provider_verified');

create table if not exists public.patient_payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.patient_payment_requests(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  provider text not null check (provider in ('phonepe', 'card')),
  provider_event_id text not null,
  provider_request_id text,
  event_type text not null,
  provider_status text,
  amount numeric(12,2),
  currency_code text,
  payload_digest text not null,
  verified boolean not null default false,
  received_at timestamptz not null default now(),
  verified_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

comment on table public.patient_payment_provider_events is
  'Minimal verified provider event metadata. Raw webhook payloads, credentials, secrets, patient notes, and other PHI must not be stored here.';

create index if not exists patient_payment_provider_events_request_idx
  on public.patient_payment_provider_events(payment_request_id, received_at desc);

create or replace function public.touch_patient_payment_request_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists patient_payment_requests_touch_updated_at
  on public.patient_payment_requests;
create trigger patient_payment_requests_touch_updated_at
before update on public.patient_payment_requests
for each row execute function public.touch_patient_payment_request_updated_at();

alter table public.patient_payment_requests enable row level security;
alter table public.patient_payment_provider_events enable row level security;

-- Authenticated clients may read safe request status for their active clinic,
-- but they cannot create, alter, mark paid, or attach provider URLs directly.
revoke all on table public.patient_payment_requests from anon, authenticated;
grant select on table public.patient_payment_requests to authenticated;
revoke all on table public.patient_payment_provider_events from anon, authenticated;

drop policy if exists patient_payment_requests_select_active_clinic
  on public.patient_payment_requests;
create policy patient_payment_requests_select_active_clinic
on public.patient_payment_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.active = true
      and pr.clinic_id = patient_payment_requests.clinic_id
  )
);

-- Reception/owner prepares a request for the current exact remaining balance.
-- This does not contact PhonePe/card provider and does not create a payment.
drop function if exists public.prepare_v28_patient_payment_request(uuid);
create function public.prepare_v28_patient_payment_request(p_bill_id uuid)
returns table(
  payment_request_id uuid,
  provider text,
  amount numeric,
  currency_code text,
  request_status text,
  checkout_url text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_bill public.consolidated_bills%rowtype;
  v_account public.clinic_payment_accounts%rowtype;
  v_country text;
  v_currency text;
  v_provider text;
  v_current_due numeric(12,2);
  v_existing public.patient_payment_requests%rowtype;
  v_request public.patient_payment_requests%rowtype;
  v_idempotency text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id
    and active = true;

  if v_profile.id is null or v_profile.clinic_id is null then
    raise exception 'Active clinic profile not found';
  end if;

  if lower(coalesce(v_profile.role, '')) not in ('owner', 'head_doctor', 'receptionist', 'reception') then
    raise exception 'Only reception or clinic owners can prepare patient payment requests';
  end if;

  select * into v_bill
  from public.consolidated_bills
  where id = p_bill_id
    and clinic_id = v_profile.clinic_id
    and status = 'finalized';

  if v_bill.id is null then
    raise exception 'Finalized invoice not found in this clinic';
  end if;

  -- Use the current legacy invoice due amounts, not only due_at_finalization,
  -- so a payment collected after finalization cannot produce an oversized link.
  select coalesce(sum(greatest(coalesce(i.due_amount, 0), 0)), 0)::numeric(12,2)
    into v_current_due
  from public.consolidated_bill_items bi
  join public.invoices i on i.id = bi.source_invoice_id
  where bi.bill_id = v_bill.id
    and bi.clinic_id = v_profile.clinic_id
    and i.clinic_id = v_profile.clinic_id
    and i.patient_id = v_bill.patient_id;

  if coalesce(v_current_due, 0) <= 0 then
    raise exception 'This finalized invoice has no remaining balance';
  end if;

  select upper(trim(coalesce(c.country_code, ''))),
         upper(trim(coalesce(c.currency_code, '')))
    into v_country, v_currency
  from public.clinics c
  where c.id = v_profile.clinic_id;

  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'Clinic country must be configured before online payments can be used';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Clinic currency must be configured before online payments can be used';
  end if;

  if upper(v_bill.country_code) <> v_country or upper(v_bill.currency_code) <> v_currency then
    raise exception 'Finalized invoice country/currency no longer matches the clinic payment configuration';
  end if;

  v_provider := case when v_country = 'IN' then 'phonepe' else 'card' end;

  select * into v_account
  from public.clinic_payment_accounts a
  where a.clinic_id = v_profile.clinic_id
    and a.provider = v_provider
    and upper(a.country_code) = v_country
    and upper(a.currency_code) = v_currency
    and a.status = 'connected'
    and a.payments_enabled = true
    and a.settlements_enabled = true
  limit 1;

  if v_account.id is null then
    raise exception 'The clinic receiving account is not connected and payment-enabled for this country';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile.clinic_id::text), hashtext(v_bill.id::text));

  select * into v_existing
  from public.patient_payment_requests r
  where r.consolidated_bill_id = v_bill.id
    and r.status in ('prepared', 'provider_pending', 'pending', 'provider_verified')
  order by r.created_at desc
  limit 1
  for update;

  if v_existing.id is not null
     and v_existing.provider = v_provider
     and v_existing.currency_code = v_currency
     and v_existing.amount = v_current_due
     and (v_existing.expires_at is null or v_existing.expires_at > now()) then
    payment_request_id := v_existing.id;
    provider := v_existing.provider;
    amount := v_existing.amount;
    currency_code := v_existing.currency_code;
    request_status := v_existing.status;
    checkout_url := v_existing.checkout_url;
    expires_at := v_existing.expires_at;
    return next;
    return;
  end if;

  if v_existing.id is not null then
    update public.patient_payment_requests
    set status = 'superseded',
        failure_code = 'balance_changed',
        failure_message = 'Superseded because the current invoice balance changed.'
    where id = v_existing.id;
  end if;

  v_idempotency := encode(
    digest(
      v_profile.clinic_id::text || ':' || v_bill.id::text || ':' ||
      v_current_due::text || ':' || v_currency || ':' || gen_random_uuid()::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.patient_payment_requests (
    clinic_id,
    patient_id,
    consolidated_bill_id,
    payment_account_id,
    provider,
    country_code,
    currency_code,
    amount,
    status,
    idempotency_key,
    requested_by
  ) values (
    v_profile.clinic_id,
    v_bill.patient_id,
    v_bill.id,
    v_account.id,
    v_provider,
    v_country,
    v_currency,
    v_current_due,
    'prepared',
    v_idempotency,
    v_user_id
  ) returning * into v_request;

  payment_request_id := v_request.id;
  provider := v_request.provider;
  amount := v_request.amount;
  currency_code := v_request.currency_code;
  request_status := v_request.status;
  checkout_url := null;
  expires_at := null;
  return next;
end;
$$;

revoke all on function public.prepare_v28_patient_payment_request(uuid) from public;
grant execute on function public.prepare_v28_patient_payment_request(uuid) to authenticated;

-- Trusted provider adapter only. It may attach the provider-issued request ID
-- and hosted checkout URL after creating the request with PhonePe/card provider.
drop function if exists public.attach_v28_provider_checkout(uuid, text, text, timestamptz);
create function public.attach_v28_provider_checkout(
  p_payment_request_id uuid,
  p_provider_request_id text,
  p_checkout_url text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(coalesce(p_provider_request_id, '')), '') is null then
    raise exception 'Provider request ID is required';
  end if;

  if nullif(trim(coalesce(p_checkout_url, '')), '') is null
     or lower(trim(p_checkout_url)) !~ '^https://'
  then
    raise exception 'A secure HTTPS checkout URL is required';
  end if;

  update public.patient_payment_requests
  set provider_request_id = trim(p_provider_request_id),
      checkout_url = trim(p_checkout_url),
      expires_at = p_expires_at,
      status = 'pending',
      provider_status = 'checkout_created',
      failure_code = null,
      failure_message = null
  where id = p_payment_request_id
    and status in ('prepared', 'provider_pending');

  if not found then
    raise exception 'Payment request is not available for provider checkout attachment';
  end if;
end;
$$;

revoke all on function public.attach_v28_provider_checkout(uuid, text, text, timestamptz) from public;
grant execute on function public.attach_v28_provider_checkout(uuid, text, text, timestamptz) to service_role;

-- Trusted webhook/event verifier only. This records a cryptographic digest of
-- the raw provider payload, not the raw payload itself. A successful verified
-- event moves the request only to provider_verified. It intentionally does not
-- write to the legacy CapDent payments ledger yet.
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

  get diagnostics v_inserted = row_count;

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
