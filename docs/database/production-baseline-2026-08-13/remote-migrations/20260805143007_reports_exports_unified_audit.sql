create table if not exists public.report_export_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  exported_by uuid references public.profiles(id) on delete set null,
  report_type text not null,
  export_format text not null,
  period_start date,
  period_end date,
  row_count integer not null default 0 check (row_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists report_export_logs_clinic_created_idx
  on public.report_export_logs (clinic_id, created_at desc);

alter table public.report_export_logs enable row level security;

drop policy if exists report_export_logs_select_same_clinic on public.report_export_logs;
create policy report_export_logs_select_same_clinic
  on public.report_export_logs
  for select
  to authenticated
  using (
    public.current_user_is_owner()
    and clinic_id = public.current_user_clinic_id()
  );

create or replace function public.admin_record_report_export(
  p_report_type text,
  p_export_format text,
  p_period_start date,
  p_period_end date,
  p_row_count integer
)
returns public.report_export_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_saved public.report_export_logs;
  v_type text := lower(trim(coalesce(p_report_type, '')));
  v_format text := lower(trim(coalesce(p_export_format, '')));
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can export administrative reports.' using errcode = '42501';
  end if;

  if v_type not in ('monthly_summary', 'patients', 'appointments', 'clinical', 'payments', 'invoices', 'staff_activity', 'audit', 'archived_records') then
    raise exception 'Unsupported report type.' using errcode = '22023';
  end if;

  if v_format not in ('csv', 'excel', 'pdf', 'print') then
    raise exception 'Unsupported export format.' using errcode = '22023';
  end if;

  if coalesce(p_row_count, 0) < 0 then
    raise exception 'Row count cannot be negative.' using errcode = '22023';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  insert into public.report_export_logs (
    clinic_id, exported_by, report_type, export_format,
    period_start, period_end, row_count
  ) values (
    v_clinic_id, auth.uid(), v_type, v_format,
    p_period_start, p_period_end, coalesce(p_row_count, 0)
  )
  returning * into v_saved;

  return v_saved;
end;
$$;

create or replace function public.admin_get_unified_audit(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_source text default null,
  p_search text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  source text,
  target_type text,
  target_id uuid,
  patient_id uuid,
  actor_id uuid,
  actor_name text,
  action text,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  amount numeric,
  subject_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_source text := nullif(lower(trim(coalesce(p_source, ''))), '');
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can review the unified audit history.' using errcode = '42501';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  return query
  with combined as (
    select
      pal.id,
      'patient'::text as source,
      'patient'::text as target_type,
      pal.patient_id as target_id,
      pal.patient_id,
      pal.changed_by as actor_id,
      coalesce(actor.name, 'Former staff member')::text as actor_name,
      case when pal.field_name = 'archive_status' then 'archive_status_changed' else 'updated' end::text as action,
      pal.field_name,
      pal.old_value,
      pal.new_value,
      pal.reason,
      null::numeric as amount,
      coalesce(patient.name, 'Deleted patient')::text as subject_name,
      pal.created_at
    from public.patient_audit_logs pal
    left join public.profiles actor on actor.id = pal.changed_by
    left join public.patients patient on patient.id = pal.patient_id
    where pal.clinic_id = v_clinic_id

    union all

    select
      aal.id,
      'appointment'::text,
      'appointment'::text,
      aal.appointment_id,
      appointment.patient_id,
      aal.changed_by,
      coalesce(actor.name, 'Former staff member')::text,
      aal.action,
      aal.field_name,
      aal.old_value,
      aal.new_value,
      aal.reason,
      null::numeric,
      coalesce(patient.name, 'Deleted patient')::text,
      aal.created_at
    from public.appointment_audit_logs aal
    left join public.profiles actor on actor.id = aal.changed_by
    left join public.appointments appointment on appointment.id = aal.appointment_id
    left join public.patients patient on patient.id = appointment.patient_id
    where aal.clinic_id = v_clinic_id

    union all

    select
      cal.id,
      'clinical'::text,
      cal.target_type,
      cal.target_id,
      cal.patient_id,
      cal.changed_by,
      coalesce(actor.name, 'Former staff member')::text,
      cal.action,
      cal.field_name,
      cal.old_value,
      cal.new_value,
      cal.reason,
      null::numeric,
      coalesce(patient.name, 'Deleted patient')::text,
      cal.created_at
    from public.clinical_audit_logs cal
    left join public.profiles actor on actor.id = cal.changed_by
    left join public.patients patient on patient.id = cal.patient_id
    where cal.clinic_id = v_clinic_id

    union all

    select
      fa.id,
      'financial'::text,
      case when fa.payment_id is not null then 'payment' else 'invoice' end::text,
      coalesce(fa.payment_id, fa.invoice_id),
      fa.patient_id,
      fa.created_by,
      coalesce(actor.name, 'Former staff member')::text,
      fa.adjustment_type,
      fa.adjustment_type,
      fa.old_values::text,
      fa.new_values::text,
      fa.reason,
      fa.amount,
      coalesce(patient.name, 'Deleted patient')::text,
      fa.created_at
    from public.financial_adjustments fa
    left join public.profiles actor on actor.id = fa.created_by
    left join public.patients patient on patient.id = fa.patient_id
    where fa.clinic_id = v_clinic_id

    union all

    select
      mal.id,
      'management'::text,
      mal.target_type,
      mal.target_id,
      null::uuid,
      mal.changed_by,
      coalesce(actor.name, 'Former staff member')::text,
      mal.action,
      mal.field_name,
      mal.old_value,
      mal.new_value,
      mal.reason,
      null::numeric,
      case
        when mal.target_type = 'staff' then coalesce(target_staff.name, 'Former staff member')
        when mal.target_type = 'staff_invite' then coalesce(target_invite.name, 'Cancelled invitation')
        when mal.target_type = 'clinic' then coalesce(target_clinic.name, 'Clinic')
        else initcap(replace(mal.target_type, '_', ' '))
      end::text,
      mal.created_at
    from public.management_audit_logs mal
    left join public.profiles actor on actor.id = mal.changed_by
    left join public.profiles target_staff on mal.target_type = 'staff' and target_staff.id = mal.target_id
    left join public.staff_invites target_invite on mal.target_type = 'staff_invite' and target_invite.id = mal.target_id
    left join public.clinics target_clinic on mal.target_type = 'clinic' and target_clinic.id = mal.target_id
    where mal.clinic_id = v_clinic_id

    union all

    select
      rel.id,
      'report'::text,
      'report_export'::text,
      rel.id,
      null::uuid,
      rel.exported_by,
      coalesce(actor.name, 'Former staff member')::text,
      'exported'::text,
      rel.report_type,
      null::text,
      concat(rel.export_format, '; rows=', rel.row_count, '; period=', coalesce(rel.period_start::text, 'all'), ' to ', coalesce(rel.period_end::text, 'all'))::text,
      'Administrative report export'::text,
      null::numeric,
      initcap(replace(rel.report_type, '_', ' '))::text,
      rel.created_at
    from public.report_export_logs rel
    left join public.profiles actor on actor.id = rel.exported_by
    where rel.clinic_id = v_clinic_id
  )
  select
    c.id, c.source, c.target_type, c.target_id, c.patient_id,
    c.actor_id, c.actor_name, c.action, c.field_name,
    c.old_value, c.new_value, c.reason, c.amount,
    c.subject_name, c.created_at
  from combined c
  where (p_start is null or c.created_at >= p_start)
    and (p_end is null or c.created_at < p_end)
    and (v_source is null or c.source = v_source)
    and (
      v_search is null
      or lower(coalesce(c.actor_name, '')) like '%' || v_search || '%'
      or lower(coalesce(c.subject_name, '')) like '%' || v_search || '%'
      or lower(coalesce(c.action, '')) like '%' || v_search || '%'
      or lower(coalesce(c.field_name, '')) like '%' || v_search || '%'
      or lower(coalesce(c.reason, '')) like '%' || v_search || '%'
      or lower(coalesce(c.old_value, '')) like '%' || v_search || '%'
      or lower(coalesce(c.new_value, '')) like '%' || v_search || '%'
    )
  order by c.created_at desc
  limit v_limit offset v_offset;
end;
$$;

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

  order by occurred_at desc nulls last;
end;
$$;

revoke all on function public.admin_record_report_export(text, text, date, date, integer) from public;
grant execute on function public.admin_record_report_export(text, text, date, date, integer) to authenticated;

revoke all on function public.admin_get_unified_audit(timestamptz, timestamptz, text, text, integer, integer) from public;
grant execute on function public.admin_get_unified_audit(timestamptz, timestamptz, text, text, integer, integer) to authenticated;

revoke all on function public.admin_get_archived_records() from public;
grant execute on function public.admin_get_archived_records() to authenticated;
