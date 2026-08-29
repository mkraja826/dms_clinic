-- CapDent V28: audited manual clinic QR collection confirmation.
-- Reception shows a clinic-managed QR, then explicitly confirms payment receipt.
-- The existing collect_reception_fee ledger path remains the source of truth for invoices/payments.

create table if not exists public.manual_qr_collection_audit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  qr_account_id uuid not null references public.clinic_payment_qr_accounts(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric not null check (amount > 0),
  payment_category text not null,
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  note text
);

create index if not exists manual_qr_collection_audit_clinic_confirmed_idx
  on public.manual_qr_collection_audit (clinic_id, confirmed_at desc);
create index if not exists manual_qr_collection_audit_patient_idx
  on public.manual_qr_collection_audit (patient_id, confirmed_at desc);

alter table public.manual_qr_collection_audit enable row level security;

revoke all on table public.manual_qr_collection_audit from anon;
grant select on table public.manual_qr_collection_audit to authenticated;

create policy "manual qr audit clinic read"
on public.manual_qr_collection_audit
for select
to authenticated
using (
  clinic_id = (
    select p.clinic_id
    from public.profiles p
    where p.id = auth.uid() and p.active = true
    limit 1
  )
);

create or replace function public.confirm_manual_qr_collection(
  p_patient_id uuid,
  p_qr_account_id uuid,
  p_fee_type text,
  p_amount numeric,
  p_note text default null
)
returns table(invoice_id uuid, payment_id uuid, amount numeric, fee_type text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_patient_clinic_id uuid;
  v_qr_clinic_id uuid;
  v_qr_active boolean;
  v_qr_label text;
  v_fee_type text;
  v_ledger_row record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.clinic_id, lower(coalesce(p.role, ''))
  into v_clinic_id, v_role
  from public.profiles p
  where p.id = v_user_id and p.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Active clinic profile not found';
  end if;

  if v_role not in ('owner', 'head_doctor', 'receptionist') then
    raise exception 'Only owner, head doctor, or receptionist can confirm QR collections';
  end if;

  select p.clinic_id
  into v_patient_clinic_id
  from public.patients p
  where p.id = p_patient_id
  limit 1;

  if v_patient_clinic_id is null or v_patient_clinic_id <> v_clinic_id then
    raise exception 'Patient does not belong to your clinic';
  end if;

  select q.clinic_id, q.is_active, q.label
  into v_qr_clinic_id, v_qr_active, v_qr_label
  from public.clinic_payment_qr_accounts q
  where q.id = p_qr_account_id
  limit 1;

  if v_qr_clinic_id is null or v_qr_clinic_id <> v_clinic_id then
    raise exception 'Payment QR does not belong to your clinic';
  end if;

  if coalesce(v_qr_active, false) is not true then
    raise exception 'Selected payment QR is inactive';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  v_fee_type := lower(trim(coalesce(p_fee_type, 'op_fee')));
  if v_fee_type not in ('op_fee', 'medication_fee', 'xray_fee', 'treatment_fee', 'other') then
    raise exception 'Unsupported payment category';
  end if;

  for v_ledger_row in
    select *
    from public.collect_reception_fee(
      p_patient_id,
      v_fee_type,
      p_amount,
      'UPI',
      concat(
        'Manual clinic QR: ',
        coalesce(v_qr_label, 'QR'),
        case when nullif(trim(coalesce(p_note, '')), '') is null then '' else ' • ' || trim(p_note) end
      )
    )
  loop
    insert into public.manual_qr_collection_audit (
      clinic_id,
      patient_id,
      qr_account_id,
      payment_id,
      invoice_id,
      amount,
      payment_category,
      confirmed_by,
      note
    ) values (
      v_clinic_id,
      p_patient_id,
      p_qr_account_id,
      v_ledger_row.payment_id,
      v_ledger_row.invoice_id,
      v_ledger_row.amount,
      v_ledger_row.fee_type,
      v_user_id,
      nullif(trim(coalesce(p_note, '')), '')
    );

    invoice_id := v_ledger_row.invoice_id;
    payment_id := v_ledger_row.payment_id;
    amount := v_ledger_row.amount;
    fee_type := v_ledger_row.fee_type;
    return next;
  end loop;
end;
$$;

revoke all on function public.confirm_manual_qr_collection(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.confirm_manual_qr_collection(uuid, uuid, text, numeric, text) to authenticated;
