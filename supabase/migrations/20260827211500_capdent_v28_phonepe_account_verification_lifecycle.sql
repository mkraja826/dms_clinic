-- CapDent V28 PhonePe merchant-account verification lifecycle.
-- Owner/head doctor may submit merchant IDs, but only trusted service-role code
-- can mark a clinic receiving account verified and payment-enabled.

begin;

alter table public.clinic_payment_accounts
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_method text,
  add column if not exists verification_reference text,
  add column if not exists verification_checked_at timestamptz,
  add column if not exists verification_failure_reason text;

alter table public.clinic_payment_accounts
  drop constraint if exists clinic_payment_accounts_verification_status_check;
alter table public.clinic_payment_accounts
  add constraint clinic_payment_accounts_verification_status_check
  check (verification_status in ('unverified', 'pending', 'verified', 'failed', 'revoked'));

comment on column public.clinic_payment_accounts.verification_status is
  'Server-authoritative merchant verification state. Android cannot set this field.';
comment on column public.clinic_payment_accounts.verification_reference is
  'Non-secret provider/reference identifier for the verification event when available.';

create or replace function public.set_v28_phonepe_account_verification(
  p_account_id uuid,
  p_verified boolean,
  p_verification_method text,
  p_verification_reference text default null,
  p_failure_reason text default null
)
returns table(
  account_id uuid,
  account_status text,
  verification_status text,
  payments_enabled boolean,
  settlements_enabled boolean,
  is_default boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.clinic_payment_accounts%rowtype;
  v_make_default boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into v_account
  from public.clinic_payment_accounts
  where id = p_account_id
    and provider = 'phonepe'
  for update;

  if v_account.id is null then
    raise exception 'PhonePe account not found';
  end if;

  if v_account.status = 'disabled' then
    raise exception 'Disabled PhonePe account cannot be verified';
  end if;

  if p_verified then
    select not exists (
      select 1
      from public.clinic_payment_accounts a
      where a.clinic_id = v_account.clinic_id
        and a.provider = 'phonepe'
        and a.is_default = true
        and a.id <> v_account.id
    ) into v_make_default;

    update public.clinic_payment_accounts
    set status = 'connected',
        verification_status = 'verified',
        verification_method = nullif(trim(coalesce(p_verification_method, '')), ''),
        verification_reference = nullif(trim(coalesce(p_verification_reference, '')), ''),
        verification_checked_at = now(),
        verification_failure_reason = null,
        payments_enabled = true,
        settlements_enabled = true,
        connected_at = coalesce(connected_at, now()),
        last_verified_at = now(),
        disabled_at = null,
        is_default = case when v_make_default then true else is_default end
    where id = v_account.id;
  else
    update public.clinic_payment_accounts
    set status = 'restricted',
        verification_status = 'failed',
        verification_method = nullif(trim(coalesce(p_verification_method, '')), ''),
        verification_reference = nullif(trim(coalesce(p_verification_reference, '')), ''),
        verification_checked_at = now(),
        verification_failure_reason = nullif(trim(coalesce(p_failure_reason, '')), ''),
        payments_enabled = false,
        settlements_enabled = false,
        is_default = false,
        last_verified_at = now()
    where id = v_account.id;
  end if;

  return query
  select
    a.id,
    a.status,
    a.verification_status,
    a.payments_enabled,
    a.settlements_enabled,
    a.is_default
  from public.clinic_payment_accounts a
  where a.id = v_account.id;
end;
$$;

revoke all on function public.set_v28_phonepe_account_verification(uuid, boolean, text, text, text) from public;
grant execute on function public.set_v28_phonepe_account_verification(uuid, boolean, text, text, text) to service_role;

commit;
