-- CapDent V28: keep one trusted reconciliation entrypoint for webhooks while
-- routing finalized-invoice and reception counter-QR requests to separate logic.

begin;

alter function public.reconcile_v28_verified_patient_payment(uuid)
  rename to reconcile_v28_verified_finalized_invoice_payment;

revoke all on function public.reconcile_v28_verified_finalized_invoice_payment(uuid) from public;
revoke execute on function public.reconcile_v28_verified_finalized_invoice_payment(uuid) from anon, authenticated;
grant execute on function public.reconcile_v28_verified_finalized_invoice_payment(uuid) to service_role;

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
  v_mode text;
begin
  select request_mode into v_mode
  from public.patient_payment_requests
  where id = p_payment_request_id;

  if v_mode is null then
    raise exception 'Payment request not found';
  end if;

  if v_mode = 'counter_qr' then
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

revoke all on function public.reconcile_v28_verified_patient_payment(uuid) from public;
revoke execute on function public.reconcile_v28_verified_patient_payment(uuid) from anon, authenticated;
grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to service_role;

comment on function public.reconcile_v28_verified_patient_payment(uuid) is
  'Service-only V28 reconciliation dispatcher. Routes finalized invoice requests to legacy V28 reconciliation and counter_qr requests to category-locked counter reconciliation.';

commit;
