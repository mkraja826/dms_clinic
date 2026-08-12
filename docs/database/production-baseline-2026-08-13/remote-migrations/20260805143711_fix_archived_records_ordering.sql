create or replace function public.admin_get_archived_records()
returns table (
  record_type text,
  record_id uuid,
  patient_id uuid,
  subject_name text,
  status text,
  occurred_at timestamptz,
  reason text,
  amount numeric,
  actor_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can review archived records.' using errcode = '42501';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  return query
  select
    'patient'::text,
    patient.id,
    patient.id,
    patient.name,
    'archived'::text,
    patient.archived_at,
    patient.archive_reason,
    null::numeric,
    coalesce(actor.name, 'Former staff member')::text
  from public.patients patient
  left join public.profiles actor on actor.id = patient.archived_by
  where patient.clinic_id = v_clinic_id
    and patient.archived_at is not null

  union all

  select
    'appointment'::text,
    appointment.id,
    appointment.patient_id,
    coalesce(patient.name, 'Deleted patient')::text,
    appointment.status,
    coalesce(appointment.updated_at, appointment.appointment_time),
    coalesce(latest.reason, 'Appointment marked ' || appointment.status),
    null::numeric,
    coalesce(latest.actor_name, 'Clinic staff')::text
  from public.appointments appointment
  left join public.patients patient on patient.id = appointment.patient_id
  left join lateral (
    select aal.reason, actor.name as actor_name
    from public.appointment_audit_logs aal
    left join public.profiles actor on actor.id = aal.changed_by
    where aal.appointment_id = appointment.id
      and aal.field_name = 'status'
    order by aal.created_at desc
    limit 1
  ) latest on true
  where appointment.clinic_id = v_clinic_id
    and appointment.status in ('cancelled', 'canceled', 'no_show')

  union all

  select
    'payment'::text,
    payment.id,
    payment.patient_id,
    coalesce(patient.name, 'Deleted patient')::text,
    payment.status,
    coalesce(payment.updated_at, payment.created_at),
    coalesce(latest.reason, 'Payment voided'),
    coalesce(latest.amount, 0),
    coalesce(latest.actor_name, 'Clinic administrator')::text
  from public.payments payment
  left join public.patients patient on patient.id = payment.patient_id
  left join lateral (
    select fa.reason, fa.amount, actor.name as actor_name
    from public.financial_adjustments fa
    left join public.profiles actor on actor.id = fa.created_by
    where fa.payment_id = payment.id
      and fa.adjustment_type in ('payment_void', 'refund_void')
    order by fa.created_at desc
    limit 1
  ) latest on true
  where payment.clinic_id = v_clinic_id
    and payment.status = 'voided'

  union all

  select
    'staff'::text,
    staff.id,
    null::uuid,
    staff.name,
    'inactive'::text,
    coalesce(latest.created_at, staff.created_at),
    coalesce(latest.reason, 'Staff access deactivated'),
    null::numeric,
    coalesce(latest.actor_name, 'Clinic administrator')::text
  from public.profiles staff
  left join lateral (
    select mal.created_at, mal.reason, actor.name as actor_name
    from public.management_audit_logs mal
    left join public.profiles actor on actor.id = mal.changed_by
    where mal.target_type = 'staff'
      and mal.target_id = staff.id
      and mal.field_name = 'active'
    order by mal.created_at desc
    limit 1
  ) latest on true
  where staff.clinic_id = v_clinic_id
    and staff.active = false

  union all

  select
    'staff_invite'::text,
    invite.id,
    null::uuid,
    invite.name,
    'cancelled'::text,
    invite.cancelled_at,
    invite.cancellation_reason,
    null::numeric,
    coalesce(actor.name, 'Clinic administrator')::text
  from public.staff_invites invite
  left join public.profiles actor on actor.id = invite.cancelled_by
  where invite.clinic_id = v_clinic_id
    and invite.cancelled_at is not null

  order by 6 desc nulls last;
end;
$$;
