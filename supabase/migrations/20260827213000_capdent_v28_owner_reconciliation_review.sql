-- CapDent V28 owner-only review surface for verified provider payments that
-- could not be safely auto-reconciled because the current invoice balance changed.

begin;

create or replace function public.get_v28_reconciliation_required_cases()
returns table(
  payment_request_id uuid,
  patient_name text,
  patient_code text,
  provider text,
  account_label text,
  merchant_id_masked text,
  verified_amount numeric,
  current_due numeric,
  currency_code text,
  failure_code text,
  failure_message text,
  provider_verified_at timestamptz,
  last_checked_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id, pr.role
    into v_clinic_id, v_role
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  if v_role not in ('owner', 'head_doctor') then
    raise exception 'Only the clinic owner or head doctor can review reconciliation exceptions';
  end if;

  return query
  select
    r.id,
    coalesce(pt.name, 'Patient')::text,
    coalesce(pt.patient_code, '')::text,
    r.provider,
    coalesce(a.account_label, 'Receiving account')::text,
    case
      when coalesce(a.provider_merchant_id, '') = '' then ''
      when length(a.provider_merchant_id) <= 4 then '****'
      else repeat('*', least(8, length(a.provider_merchant_id) - 4)) || right(a.provider_merchant_id, 4)
    end::text,
    r.amount::numeric,
    coalesce(sum(greatest(coalesce(i.due_amount, 0), 0)), 0)::numeric,
    r.currency_code,
    coalesce(r.failure_code, '')::text,
    coalesce(r.failure_message, '')::text,
    r.provider_verified_at,
    r.last_checked_at
  from public.patient_payment_requests r
  join public.patients pt
    on pt.id = r.patient_id
   and pt.clinic_id = r.clinic_id
  join public.clinic_payment_accounts a
    on a.id = r.payment_account_id
   and a.clinic_id = r.clinic_id
  join public.consolidated_bill_items bi
    on bi.bill_id = r.consolidated_bill_id
   and bi.clinic_id = r.clinic_id
  join public.invoices i
    on i.id = bi.source_invoice_id
   and i.clinic_id = r.clinic_id
   and i.patient_id = r.patient_id
  where r.clinic_id = v_clinic_id
    and r.status = 'reconciliation_required'
  group by
    r.id, pt.name, pt.patient_code, r.provider, a.account_label,
    a.provider_merchant_id, r.amount, r.currency_code, r.failure_code,
    r.failure_message, r.provider_verified_at, r.last_checked_at
  order by r.provider_verified_at desc nulls last, r.last_checked_at desc nulls last;
end;
$$;

revoke all on function public.get_v28_reconciliation_required_cases() from public;
grant execute on function public.get_v28_reconciliation_required_cases() to authenticated;

comment on function public.get_v28_reconciliation_required_cases() is
  'Owner/head-doctor read-only review of verified provider payments held for manual reconciliation. Returns masked receiving-account identity and current invoice due; performs no money movement.';

commit;
