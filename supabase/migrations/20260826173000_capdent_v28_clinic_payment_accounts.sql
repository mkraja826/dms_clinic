-- CapDent V28 patient payment receiving-account foundation.
-- Additive only: this migration does not alter existing invoices, payments,
-- collect_reception_fee(), record_patient_payment(), or payment reports.
--
-- Security model:
-- - clinic country/currency remain authoritative on public.clinics.
-- - India routes to PhonePe; other explicitly configured countries route to card.
-- - missing/invalid country disables online payment routing.
-- - Android never writes provider account identifiers or connection status.
-- - provider API credentials/secrets must never be stored in this table.
-- - future Edge Functions/service-role code owns provider onboarding updates.

begin;

create table if not exists public.clinic_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  provider text not null check (provider in ('phonepe', 'card')),
  country_code text not null check (char_length(country_code) = 2),
  currency_code text not null check (char_length(currency_code) = 3),
  provider_account_id text,
  provider_merchant_id text,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'pending', 'connected', 'restricted', 'disabled')),
  payments_enabled boolean not null default false,
  settlements_enabled boolean not null default false,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  last_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, provider)
);

comment on table public.clinic_payment_accounts is
  'Non-secret provider account metadata for patient payment receiving accounts. Provider credentials must remain in server-side secret storage only.';

comment on column public.clinic_payment_accounts.provider_account_id is
  'Provider-issued connected account identifier only. Never store an API key, password, token, salt, or secret here.';

comment on column public.clinic_payment_accounts.provider_merchant_id is
  'Provider-issued merchant identifier when applicable. Never store an API key, password, token, salt, or secret here.';

create index if not exists clinic_payment_accounts_clinic_idx
  on public.clinic_payment_accounts(clinic_id);

create or replace function public.touch_clinic_payment_accounts_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clinic_payment_accounts_touch_updated_at
  on public.clinic_payment_accounts;
create trigger clinic_payment_accounts_touch_updated_at
before update on public.clinic_payment_accounts
for each row execute function public.touch_clinic_payment_accounts_updated_at();

alter table public.clinic_payment_accounts enable row level security;

-- No direct authenticated mutation. Future provider onboarding/reconciliation
-- uses trusted server-side code after verifying the signed-in owner and clinic.
revoke all on table public.clinic_payment_accounts from anon, authenticated;

-- Safe status RPC for signed-in clinic users. It exposes no provider secret and
-- chooses the expected provider from the clinic row on the server.
drop function if exists public.get_clinic_patient_payment_status();
create function public.get_clinic_patient_payment_status()
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

  -- Never infer India from phone, IP, SIM, device locale, or a missing country.
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
    and a.country_code = v_country_code
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

commit;
