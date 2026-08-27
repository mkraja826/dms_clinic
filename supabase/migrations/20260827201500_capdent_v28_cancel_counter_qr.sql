-- CapDent V28: explicitly retire a reception counter QR before preparing another one.

begin;

create or replace function public.cancel_v28_counter_payment_request(p_payment_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_request public.patient_payment_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.clinic_id, p.role
    into v_clinic_id, v_role
  from public.profiles p
  where p.id = v_user_id
    and p.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  if v_role not in ('owner','head_doctor','receptionist') then
    raise exception 'Your role cannot cancel a counter payment QR';
  end if;

  select * into v_request
  from public.patient_payment_requests
  where id = p_payment_request_id
    and clinic_id = v_clinic_id
    and request_mode = 'counter_qr'
  for update;

  if v_request.id is null then
    raise exception 'Counter payment request not found';
  end if;

  if v_request.status in ('reconciled','provider_verified','reconciliation_required','partially_reconciled_excess') then
    raise exception 'This payment is already verified or recorded and cannot be cancelled';
  end if;

  if v_request.status in ('cancelled','superseded','expired','failed') then
    return v_request.status;
  end if;

  if v_request.status not in ('prepared','provider_pending','pending') then
    raise exception 'Counter payment request is not cancellable in its current state';
  end if;

  update public.patient_payment_requests
  set status = 'cancelled',
      last_checked_at = now(),
      failure_code = 'counter_qr_cancelled_by_reception',
      failure_message = 'Reception retired this QR before generating another payment request.',
      updated_at = now()
  where id = v_request.id;

  return 'cancelled';
end;
$$;

revoke all on function public.cancel_v28_counter_payment_request(uuid) from public;
grant execute on function public.cancel_v28_counter_payment_request(uuid) to authenticated;

commit;
