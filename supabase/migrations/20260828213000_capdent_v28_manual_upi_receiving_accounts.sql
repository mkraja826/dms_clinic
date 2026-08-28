-- CapDent V28 manual UPI receiving-account mode.
-- Clinics can use an existing PhonePe/UPI VPA for counter QR collection before
-- CapDent receives PhonePe partner approval. This does NOT mark the account as
-- provider-verified and does NOT weaken the future PhonePe API verification path.

begin;

alter table public.clinic_payment_accounts
  add column if not exists collection_mode text not null default 'phonepe_api',
  add column if not exists manual_confirmation_required boolean not null default false;

alter table public.clinic_payment_accounts
  drop constraint if exists clinic_payment_accounts_collection_mode_check;
alter table public.clinic_payment_accounts
  add constraint clinic_payment_accounts_collection_mode_check
  check (collection_mode in ('manual_upi', 'phonepe_api'));

create unique index if not exists clinic_payment_accounts_unique_upi_idx
  on public.clinic_payment_accounts (clinic_id, provider, lower(provider_account_id))
  where provider_account_id is not null and collection_mode = 'manual_upi';

comment on column public.clinic_payment_accounts.collection_mode is
  'manual_upi uses the clinic UPI/VPA with staff confirmation; phonepe_api is reserved for trusted PhonePe partner/provider verification.';
comment on column public.clinic_payment_accounts.manual_confirmation_required is
  'True when CapDent must require an authorized clinic user to confirm receipt after checking PhonePe Business/bank receipt. Never infer payment success from app return or screenshots.';
comment on column public.clinic_payment_accounts.provider_account_id is
  'For manual_upi this stores the clinic UPI/VPA (non-secret). For phonepe_api it may store a provider-issued account identifier. Never store credentials or secrets.';

commit;
