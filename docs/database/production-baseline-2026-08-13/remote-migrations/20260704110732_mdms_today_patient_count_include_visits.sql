-- =========================================================
-- MDMS: Today patient count should include old patients when a visit is added today.
-- Counts distinct patients from:
-- 1) today's appointments/check-ins
-- 2) today's patient_visits
-- 3) patients created in DMS today
-- =========================================================

create or replace function public.get_workflow_dashboard_summary()
returns table (
  today_revenue numeric,
  pending_payments numeric,
  op_fee_revenue_today numeric,
  xray_revenue_today numeric,
  medication_revenue_today numeric,
  treatment_revenue_today numeric,
  pending_collected_today numeric,
  other_revenue_today numeric,
  today_patient_count integer,
  waiting_count integer,
  completed_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinic_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select pr.clinic_id
  into v_clinic_id
  from public.profiles pr
  where pr.id = v_user_id
    and pr.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Clinic not found for current user';
  end if;

  return query
  select
    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as today_revenue,

    coalesce((
      select sum(inv.due_amount)::numeric
      from public.invoices inv
      where inv.clinic_id = v_clinic_id
        and inv.due_amount > 0
        and lower(coalesce(inv.status, '')) in ('unpaid', 'partial')
    ), 0) as pending_payments,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and py.payment_category = 'op_fee'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as op_fee_revenue_today,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and py.payment_category = 'xray_fee'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as xray_revenue_today,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and py.payment_category = 'medication_fee'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as medication_revenue_today,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and py.payment_category = 'treatment_fee'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as treatment_revenue_today,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and py.payment_category = 'pending_collection'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as pending_collected_today,

    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and coalesce(py.payment_category, 'other') = 'other'
        and timezone('Asia/Kolkata', py.created_at)::date = timezone('Asia/Kolkata', now())::date
    ), 0) as other_revenue_today,

    coalesce((
      select count(distinct x.patient_id)::integer
      from (
        select ap.patient_id
        from public.appointments ap
        where ap.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date

        union

        select pv.patient_id
        from public.patient_visits pv
        where pv.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', pv.visit_date)::date = timezone('Asia/Kolkata', now())::date

        union

        select pt.id as patient_id
        from public.patients pt
        where pt.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', pt.created_at)::date = timezone('Asia/Kolkata', now())::date
      ) x
    ), 0) as today_patient_count,

    coalesce((
      select count(*)::integer
      from public.appointments ap
      where ap.clinic_id = v_clinic_id
        and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date
        and lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked')
    ), 0) as waiting_count,

    coalesce((
      select count(distinct x.patient_id)::integer
      from (
        select ap.patient_id
        from public.appointments ap
        where ap.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', now())::date
          and lower(coalesce(ap.status, '')) in ('completed', 'done')

        union

        select pv.patient_id
        from public.patient_visits pv
        where pv.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', pv.visit_date)::date = timezone('Asia/Kolkata', now())::date
      ) x
    ), 0) as completed_count;
end;
$$;

grant execute on function public.get_workflow_dashboard_summary() to authenticated;
notify pgrst, 'reload schema';
