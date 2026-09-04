-- Additive dashboard RPC for future staged rollout.
-- Existing dashboard functions and screens remain unchanged.

create or replace function public.get_clinic_dashboard_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_total_patients bigint := 0;
  v_recent_patients jsonb := '[]'::jsonb;
  v_today_appointments jsonb := '[]'::jsonb;
  v_waiting_count integer := 0;
  v_completed_count integer := 0;
  v_today_patient_count integer := 0;
  v_today_revenue numeric := 0;
  v_pending_payments numeric := 0;
  v_op_fee numeric := 0;
  v_xray_fee numeric := 0;
  v_medication_fee numeric := 0;
  v_treatment_fee numeric := 0;
  v_pending_collected numeric := 0;
  v_other_revenue numeric := 0;
begin
  v_clinic_id := public.current_user_clinic_id();

  if v_clinic_id is null then
    raise exception 'Clinic profile not found';
  end if;

  -- Preserve current India clinic-day behaviour while using index-friendly ranges.
  v_day_start := date_trunc('day', timezone('Asia/Kolkata', now())) at time zone 'Asia/Kolkata';
  v_day_end := v_day_start + interval '1 day';

  select count(*)
    into v_total_patients
  from public.patients p
  where p.clinic_id = v_clinic_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'clinic_id', recent.clinic_id,
        'patient_code', recent.patient_code,
        'name', recent.name,
        'gender', recent.gender,
        'age', recent.age,
        'dob', recent.dob,
        'phone', recent.phone,
        'email', recent.email,
        'address', recent.address,
        'emergency_contact', recent.emergency_contact,
        'created_at', recent.created_at
      ) order by recent.created_at desc
    ),
    '[]'::jsonb
  )
  into v_recent_patients
  from (
    select p.*
    from public.patients p
    where p.clinic_id = v_clinic_id
    order by p.created_at desc
    limit 5
  ) recent;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'clinic_id', a.clinic_id,
        'patient_id', a.patient_id,
        'doctor_id', a.doctor_id,
        'appointment_time', a.appointment_time,
        'status', a.status,
        'notes', a.notes,
        'created_at', a.created_at,
        'patients', jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'phone', p.phone,
          'photo_url', p.photo_url
        )
      ) order by a.appointment_time asc
    ),
    '[]'::jsonb
  )
  into v_today_appointments
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  where a.clinic_id = v_clinic_id
    and a.appointment_time >= v_day_start
    and a.appointment_time < v_day_end
    and lower(coalesce(a.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked');

  select count(*)::integer
    into v_waiting_count
  from public.appointments a
  where a.clinic_id = v_clinic_id
    and a.appointment_time >= v_day_start
    and a.appointment_time < v_day_end
    and lower(coalesce(a.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked');

  select count(distinct completed.patient_id)::integer
    into v_completed_count
  from (
    select a.patient_id
    from public.appointments a
    where a.clinic_id = v_clinic_id
      and a.appointment_time >= v_day_start
      and a.appointment_time < v_day_end
      and lower(coalesce(a.status, '')) in ('completed', 'done')

    union

    select pv.patient_id
    from public.patient_visits pv
    where pv.clinic_id = v_clinic_id
      and pv.visit_date >= v_day_start
      and pv.visit_date < v_day_end
  ) completed;

  select count(distinct today_rows.patient_id)::integer
    into v_today_patient_count
  from (
    select a.patient_id
    from public.appointments a
    where a.clinic_id = v_clinic_id
      and a.appointment_time >= v_day_start
      and a.appointment_time < v_day_end

    union

    select pv.patient_id
    from public.patient_visits pv
    where pv.clinic_id = v_clinic_id
      and pv.visit_date >= v_day_start
      and pv.visit_date < v_day_end

    union

    select p.id
    from public.patients p
    where p.clinic_id = v_clinic_id
      and p.created_at >= v_day_start
      and p.created_at < v_day_end
  ) today_rows;

  select
    coalesce(sum(py.amount), 0),
    coalesce(sum(py.amount) filter (where py.payment_category = 'op_fee'), 0),
    coalesce(sum(py.amount) filter (where py.payment_category = 'xray_fee'), 0),
    coalesce(sum(py.amount) filter (where py.payment_category = 'medication_fee'), 0),
    coalesce(sum(py.amount) filter (where py.payment_category = 'treatment_fee'), 0),
    coalesce(sum(py.amount) filter (where py.payment_category = 'pending_collection'), 0),
    coalesce(sum(py.amount) filter (where coalesce(py.payment_category, 'other') = 'other'), 0)
  into
    v_today_revenue,
    v_op_fee,
    v_xray_fee,
    v_medication_fee,
    v_treatment_fee,
    v_pending_collected,
    v_other_revenue
  from public.payments py
  where py.clinic_id = v_clinic_id
    and py.created_at >= v_day_start
    and py.created_at < v_day_end;

  select coalesce(sum(i.due_amount), 0)
    into v_pending_payments
  from public.invoices i
  where i.clinic_id = v_clinic_id
    and i.due_amount > 0
    and lower(coalesce(i.status, '')) in ('unpaid', 'partial');

  return jsonb_build_object(
    'stats', jsonb_build_object(
      'todayAppointments', v_waiting_count,
      'totalPatients', v_total_patients,
      'pendingPayments', v_pending_payments,
      'todayRevenue', v_today_revenue,
      'recentPatients', v_recent_patients,
      'todayAppointmentList', v_today_appointments
    ),
    'summary', jsonb_build_object(
      'today_revenue', v_today_revenue,
      'pending_payments', v_pending_payments,
      'op_fee_revenue_today', v_op_fee,
      'xray_revenue_today', v_xray_fee,
      'medication_revenue_today', v_medication_fee,
      'treatment_revenue_today', v_treatment_fee,
      'pending_collected_today', v_pending_collected,
      'other_revenue_today', v_other_revenue,
      'today_patient_count', v_today_patient_count,
      'waiting_count', v_waiting_count,
      'completed_count', v_completed_count
    )
  );
end;
$$;

grant execute on function public.get_clinic_dashboard_v2() to authenticated;
