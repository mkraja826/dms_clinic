-- CapDent V28: receptionist counter QR payments.
-- Reception chooses patient + category + amount. The request locks the exact clinic
-- receiving account and category; provider verification later records only that amount.

begin;

alter table public.patient_payment_requests
  alter column consolidated_bill_id drop not null,
  add column if not exists request_mode text not null default 'finalized_invoice',
  add column if not exists payment_category text;

alter table public.patient_payment_requests
  drop constraint if exists patient_payment_requests_request_mode_check;
alter table public.patient_payment_requests
  add constraint patient_payment_requests_request_mode_check
  check (request_mode in ('finalized_invoice', 'counter_qr'));

alter table public.patient_payment_requests
  drop constraint if exists patient_payment_requests_payment_category_check;
alter table public.patient_payment_requests
  add constraint patient_payment_requests_payment_category_check
  check (
    payment_category is null or
    payment_category in ('op_fee','xray_fee','medication_fee','treatment_fee','pending_collection','other')
  );

alter table public.patient_payment_reconciliation_entries
  alter column consolidated_bill_id drop not null;

create index if not exists patient_payment_requests_counter_lookup_idx
  on public.patient_payment_requests(clinic_id, patient_id, payment_category, requested_at desc)
  where request_mode = 'counter_qr';

create or replace function public.prepare_v28_counter_payment_request(
  p_patient_id uuid,
  p_payment_category text,
  p_amount numeric
)
returns table(
  payment_request_id uuid,
  provider text,
  amount numeric,
  currency_code text,
  request_status text,
  payment_category text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_country text;
  v_currency text;
  v_provider text;
  v_account public.clinic_payment_accounts%rowtype;
  v_category text := lower(trim(coalesce(p_payment_category, '')));
  v_amount numeric(12,2) := round(coalesce(p_amount,0),2);
  v_due numeric(12,2);
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select pr.clinic_id, pr.role into v_clinic_id, v_role
  from public.profiles pr
  where pr.id = v_user_id and pr.active = true
  limit 1;

  if v_clinic_id is null then raise exception 'Clinic not found for current user'; end if;
  if v_role not in ('owner','head_doctor','receptionist') then
    raise exception 'Only owner, head doctor or receptionist can create a counter payment QR';
  end if;

  if v_category not in ('op_fee','xray_fee','medication_fee','treatment_fee','pending_collection','other') then
    raise exception 'Select a valid payment category';
  end if;
  if v_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

  perform 1 from public.patients p where p.id=p_patient_id and p.clinic_id=v_clinic_id;
  if not found then raise exception 'Patient not found in your clinic'; end if;

  select upper(coalesce(c.country_code,'IN')), upper(coalesce(c.currency_code,'INR'))
    into v_country, v_currency
  from public.clinics c where c.id=v_clinic_id;

  v_provider := case when v_country='IN' and v_currency='INR' then 'phonepe' else 'card' end;

  select * into v_account
  from public.clinic_payment_accounts a
  where a.clinic_id=v_clinic_id
    and a.provider=v_provider
    and a.is_default=true
    and a.status='connected'
    and a.verification_status='verified'
    and a.payments_enabled=true
    and a.settlements_enabled=true
  order by a.last_verified_at desc nulls last, a.created_at
  limit 1;

  if v_account.id is null then raise exception 'No verified default receiving account is available'; end if;

  select coalesce(sum(greatest(coalesce(i.due_amount,0),0)),0)::numeric(12,2)
    into v_due
  from public.invoices i
  where i.clinic_id=v_clinic_id
    and i.patient_id=p_patient_id
    and greatest(coalesce(i.due_amount,0),0)>0
    and lower(coalesce(nullif(trim(i.payment_category),''), nullif(trim(i.invoice_type),''), 'other'))=v_category;

  if v_due <= 0 then raise exception 'No outstanding amount is available in the selected category'; end if;
  if v_amount > v_due then raise exception 'Entered amount exceeds the outstanding amount for the selected category'; end if;

  update public.patient_payment_requests
  set status='superseded', last_checked_at=now(),
      failure_code='counter_qr_replaced', failure_message='Reception generated a newer counter QR for this patient/category.'
  where clinic_id=v_clinic_id
    and patient_id=p_patient_id
    and request_mode='counter_qr'
    and payment_category=v_category
    and status in ('prepared','provider_pending','pending','expired','failed');

  insert into public.patient_payment_requests(
    clinic_id, patient_id, consolidated_bill_id, payment_account_id, provider,
    country_code, currency_code, amount, status, idempotency_key,
    requested_by, requested_at, request_mode, payment_category
  ) values (
    v_clinic_id, p_patient_id, null, v_account.id, v_provider,
    v_country, v_currency, v_amount, 'prepared',
    'counter:'||v_clinic_id::text||':'||p_patient_id::text||':'||v_category||':'||gen_random_uuid()::text,
    v_user_id, now(), 'counter_qr', v_category
  ) returning id into v_id;

  payment_request_id := v_id;
  provider := v_provider;
  amount := v_amount;
  currency_code := v_currency;
  request_status := 'prepared';
  payment_category := v_category;
  return next;
end;
$$;

revoke all on function public.prepare_v28_counter_payment_request(uuid,text,numeric) from public;
grant execute on function public.prepare_v28_counter_payment_request(uuid,text,numeric) to authenticated;

create or replace function public.reconcile_v28_verified_counter_payment(p_payment_request_id uuid)
returns table(reconciliation_status text, applied_amount numeric, payment_rows integer, current_category_due numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.patient_payment_requests%rowtype;
  v_account public.clinic_payment_accounts%rowtype;
  v_item record;
  v_due numeric(12,2);
  v_remaining numeric(12,2);
  v_apply numeric(12,2);
  v_applied numeric(12,2):=0;
  v_rows integer:=0;
  v_payment_id uuid;
  v_method text;
begin
  select * into v_request from public.patient_payment_requests
  where id=p_payment_request_id for update;
  if v_request.id is null then raise exception 'Payment request not found'; end if;
  if v_request.request_mode <> 'counter_qr' then raise exception 'Payment request is not a counter QR request'; end if;

  if v_request.status='reconciled' then
    select coalesce(sum(e.amount),0)::numeric(12,2), count(*)::integer
      into v_applied,v_rows from public.patient_payment_reconciliation_entries e
      where e.payment_request_id=v_request.id;
    reconciliation_status:='reconciled'; applied_amount:=v_applied; payment_rows:=v_rows; current_category_due:=0;
    return next; return;
  end if;

  if v_request.status<>'provider_verified' or v_request.provider_verified_at is null then
    raise exception 'Only a provider-verified counter payment can be reconciled';
  end if;

  select * into v_account from public.clinic_payment_accounts
  where id=v_request.payment_account_id and clinic_id=v_request.clinic_id and provider=v_request.provider;
  if v_account.id is null then raise exception 'Receiving account linked to payment request was not found'; end if;

  perform 1 from public.invoices i
  where i.clinic_id=v_request.clinic_id and i.patient_id=v_request.patient_id
    and greatest(coalesce(i.due_amount,0),0)>0
    and lower(coalesce(nullif(trim(i.payment_category),''),nullif(trim(i.invoice_type),''),'other'))=v_request.payment_category
  order by i.created_at,i.id for update;

  select coalesce(sum(greatest(coalesce(i.due_amount,0),0)),0)::numeric(12,2)
    into v_due
  from public.invoices i
  where i.clinic_id=v_request.clinic_id and i.patient_id=v_request.patient_id
    and greatest(coalesce(i.due_amount,0),0)>0
    and lower(coalesce(nullif(trim(i.payment_category),''),nullif(trim(i.invoice_type),''),'other'))=v_request.payment_category;

  if v_due < v_request.amount then
    update public.patient_payment_requests
    set status='reconciliation_required', last_checked_at=now(),
        failure_code='counter_category_balance_changed',
        failure_message='Provider payment verified, but the selected category balance changed before reconciliation.'
    where id=v_request.id;
    reconciliation_status:='reconciliation_required'; applied_amount:=0; payment_rows:=0; current_category_due:=v_due;
    return next; return;
  end if;

  v_remaining:=v_request.amount;
  v_method:=case when v_request.provider='phonepe' then 'PhonePe' else 'Card' end;

  for v_item in
    select i.* from public.invoices i
    where i.clinic_id=v_request.clinic_id and i.patient_id=v_request.patient_id
      and greatest(coalesce(i.due_amount,0),0)>0
      and lower(coalesce(nullif(trim(i.payment_category),''),nullif(trim(i.invoice_type),''),'other'))=v_request.payment_category
    order by i.created_at,i.id
  loop
    exit when v_remaining<=0;
    v_apply:=least(v_remaining,greatest(coalesce(v_item.due_amount,0),0));
    if v_apply<=0 then continue; end if;

    insert into public.payments(clinic_id,invoice_id,patient_id,amount,payment_method,notes,payment_category,collected_by)
    values(v_request.clinic_id,v_item.id,v_request.patient_id,v_apply,v_method,
      'Verified reception counter QR payment',v_request.payment_category,v_request.requested_by)
    returning id into v_payment_id;

    perform public.recalculate_invoice_financials(v_item.id);

    insert into public.patient_payment_reconciliation_entries(
      payment_request_id,clinic_id,patient_id,consolidated_bill_id,invoice_id,payment_id,amount,
      payment_account_id,provider,provider_merchant_id_snapshot,account_label_snapshot,payment_category,line_label
    ) values(
      v_request.id,v_request.clinic_id,v_request.patient_id,null,v_item.id,v_payment_id,v_apply,
      v_account.id,v_request.provider,v_account.provider_merchant_id,v_account.account_label,
      v_request.payment_category,
      case v_request.payment_category
        when 'op_fee' then 'OP / Consultation'
        when 'xray_fee' then 'X-ray'
        when 'medication_fee' then 'Medication'
        when 'treatment_fee' then 'Treatment'
        when 'pending_collection' then 'Pending Collection'
        else 'Other'
      end
    );

    v_remaining:=round(v_remaining-v_apply,2);
    v_applied:=round(v_applied+v_apply,2);
    v_rows:=v_rows+1;
  end loop;

  if abs(v_remaining)>0.01 then raise exception 'Verified counter payment could not be fully allocated'; end if;

  update public.patient_payment_requests
  set status='reconciled',reconciled_at=now(),last_checked_at=now(),failure_code=null,failure_message=null
  where id=v_request.id;

  reconciliation_status:='reconciled'; applied_amount:=v_applied; payment_rows:=v_rows; current_category_due:=greatest(v_due-v_applied,0);
  return next;
end;
$$;

revoke all on function public.reconcile_v28_verified_counter_payment(uuid) from public;
grant execute on function public.reconcile_v28_verified_counter_payment(uuid) to service_role;

comment on function public.prepare_v28_counter_payment_request(uuid,text,numeric) is
  'Reception counter QR: locks patient, selected payment category, amount and verified default clinic receiving account.';
comment on function public.reconcile_v28_verified_counter_payment(uuid) is
  'Service-only reconciliation for verified counter QR payments; applies exact request amount only within the locked category.';

commit;
