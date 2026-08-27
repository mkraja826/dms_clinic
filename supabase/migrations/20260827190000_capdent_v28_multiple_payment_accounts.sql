-- CapDent V28 multiple receiving-account model.
-- Allows multiple PhonePe/card receiving accounts per clinic while requiring
-- deterministic use of a single default account per provider.

begin;

alter table public.clinic_payment_accounts
  drop constraint if exists clinic_payment_accounts_clinic_id_provider_key;

alter table public.clinic_payment_accounts
  add column if not exists account_label text not null default 'Primary',
  add column if not exists is_default boolean not null default false;

alter table public.clinic_payment_accounts
  drop constraint if exists clinic_payment_accounts_account_label_check;
alter table public.clinic_payment_accounts
  add constraint clinic_payment_accounts_account_label_check
  check (char_length(trim(account_label)) between 1 and 80);

create unique index if not exists clinic_payment_accounts_one_default_provider_idx
  on public.clinic_payment_accounts (clinic_id, provider)
  where is_default = true;

create unique index if not exists clinic_payment_accounts_unique_merchant_idx
  on public.clinic_payment_accounts (clinic_id, provider, provider_merchant_id)
  where provider_merchant_id is not null;

create index if not exists clinic_payment_accounts_provider_status_idx
  on public.clinic_payment_accounts (clinic_id, provider, is_default desc, status, created_at);

comment on column public.clinic_payment_accounts.account_label is
  'Clinic-visible label such as Primary, Front Desk, Branch 2, or Owner Account.';
comment on column public.clinic_payment_accounts.is_default is
  'Exactly one connected account should be selected as the clinic default for each provider when that provider is enabled.';

-- Preserve the existing status RPC contract for current Android clients, but
-- resolve payment status using only the default account.
create or replace function public.get_clinic_patient_payment_status()
returns table(
  provider text,
  provider_label text,
  account_status text,
  payments_enabled boolean,
  settlements_enabled boolean,
  country_code text,
  currency_code text,
  connected_at timestamptz,
  backend_ready boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_active boolean;
  v_country_code text;
  v_currency_code text;
  v_provider text;
  v_account public.clinic_payment_accounts%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.clinic_id, p.active
    into v_clinic_id, v_active
  from public.profiles p
  where p.id = v_user_id
  limit 1;

  if v_clinic_id is null or coalesce(v_active, false) = false then
    raise exception 'Active clinic profile not found';
  end if;

  select upper(trim(coalesce(c.country_code, ''))),
         upper(trim(coalesce(c.currency_code, '')))
    into v_country_code, v_currency_code
  from public.clinics c
  where c.id = v_clinic_id
  limit 1;

  if v_country_code !~ '^[A-Z]{2}$' then
    provider := 'unconfigured';
    provider_label := 'Country required';
    account_status := 'country_required';
    payments_enabled := false;
    settlements_enabled := false;
    country_code := nullif(v_country_code, '');
    currency_code := nullif(v_currency_code, '');
    connected_at := null;
    backend_ready := true;
    return next;
    return;
  end if;

  v_provider := case when v_country_code = 'IN' then 'phonepe' else 'card' end;

  select a.*
    into v_account
  from public.clinic_payment_accounts a
  where a.clinic_id = v_clinic_id
    and a.provider = v_provider
    and upper(a.country_code) = v_country_code
    and a.is_default = true
  order by a.created_at asc
  limit 1;

  provider := v_provider;
  provider_label := case when v_provider = 'phonepe' then 'PhonePe' else 'Card' end;
  account_status := coalesce(v_account.status, 'not_connected');
  payments_enabled := coalesce(v_account.payments_enabled, false);
  settlements_enabled := coalesce(v_account.settlements_enabled, false);
  country_code := v_country_code;
  currency_code := nullif(v_currency_code, '');
  connected_at := v_account.connected_at;
  backend_ready := true;
  return next;
end;
$$;

revoke all on function public.get_clinic_patient_payment_status() from public;
grant execute on function public.get_clinic_patient_payment_status() to authenticated;

-- Keep the existing request RPC contract, but always bind a new patient
-- payment request to the clinic's default connected account.
create or replace function public.prepare_v28_patient_payment_request(p_bill_id uuid)
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
    and a.is_default = true
    and a.status = 'connected'
    and a.payments_enabled = true
    and a.settlements_enabled = true
  limit 1;

  if v_account.id is null then
    raise exception 'The clinic default receiving account is not connected and payment-enabled for this country';
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
     and v_existing.payment_account_id = v_account.id
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
        failure_code = 'payment_account_or_balance_changed',
        failure_message = 'Superseded because the default receiving account or current invoice balance changed.'
    where id = v_existing.id;
  end if;

  v_idempotency := encode(
    digest(
      v_profile.clinic_id::text || ':' || v_bill.id::text || ':' ||
      v_account.id::text || ':' || v_current_due::text || ':' || v_currency || ':' || gen_random_uuid()::text,
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

commit;
