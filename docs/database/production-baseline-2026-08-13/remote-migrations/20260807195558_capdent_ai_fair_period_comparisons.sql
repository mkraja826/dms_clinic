create or replace function public.get_capdent_ai_period_analytics(p_period text default 'weekly')
returns table(
  clinic_name text,
  currency_code text,
  user_role text,
  can_view_finance boolean,
  period_key text,
  period_start date,
  period_end date,
  previous_start date,
  previous_end date,
  patients_count integer,
  previous_patients_count integer,
  new_patients_count integer,
  previous_new_patients_count integer,
  appointments_count integer,
  previous_appointments_count integer,
  completed_count integer,
  previous_completed_count integer,
  visits_count integer,
  previous_visits_count integer,
  treatments_count integer,
  previous_treatments_count integer,
  gallery_uploads_count integer,
  previous_gallery_uploads_count integer,
  net_collections numeric,
  previous_net_collections numeric,
  outstanding_dues_now numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_can_view_finance boolean := false;
  v_period text := lower(coalesce(nullif(trim(p_period), ''), 'weekly'));
  v_today date := timezone('Asia/Kolkata', now())::date;
  v_start date;
  v_end date;
  v_prev_start date;
  v_prev_end date;
  v_elapsed_days integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.clinic_id, lower(coalesce(p.role, ''))
  into v_clinic_id, v_role
  from public.profiles p
  where p.id = v_user_id
    and p.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Active clinic not found for current user';
  end if;

  v_can_view_finance := v_role in ('owner', 'head_doctor', 'receptionist');

  case v_period
    when 'daily' then
      v_start := v_today;
      v_end := v_today;
      v_prev_start := v_today - 1;
      v_prev_end := v_today - 1;
    when 'tomorrow' then
      v_start := v_today + 1;
      v_end := v_today + 1;
      v_prev_start := v_today;
      v_prev_end := v_today;
    when 'weekly' then
      v_start := date_trunc('week', v_today::timestamp)::date;
      v_end := v_today;
      v_elapsed_days := (v_end - v_start);
      v_prev_start := v_start - 7;
      v_prev_end := v_prev_start + v_elapsed_days;
    when 'monthly' then
      v_start := date_trunc('month', v_today::timestamp)::date;
      v_end := v_today;
      v_elapsed_days := (v_end - v_start);
      v_prev_start := (v_start - interval '1 month')::date;
      v_prev_end := least(v_prev_start + v_elapsed_days, v_start - 1);
    else
      raise exception 'Unsupported period. Use daily, tomorrow, weekly, or monthly.';
  end case;

  return query
  select
    c.name::text,
    coalesce(c.currency_code, 'INR')::text,
    v_role::text,
    v_can_view_finance,
    v_period::text,
    v_start,
    v_end,
    v_prev_start,
    v_prev_end,
    coalesce((select count(distinct q.patient_id)::integer from (
      select a.patient_id from public.appointments a where a.clinic_id = v_clinic_id and timezone('Asia/Kolkata', a.appointment_time)::date between v_start and v_end and lower(coalesce(a.status, '')) not in ('cancelled','canceled','no_show')
      union
      select pv.patient_id from public.patient_visits pv where pv.clinic_id = v_clinic_id and timezone('Asia/Kolkata', pv.visit_date)::date between v_start and v_end
      union
      select p.id from public.patients p where p.clinic_id = v_clinic_id and p.archived_at is null and timezone('Asia/Kolkata', p.created_at)::date between v_start and v_end
    ) q),0),
    coalesce((select count(distinct q.patient_id)::integer from (
      select a.patient_id from public.appointments a where a.clinic_id = v_clinic_id and timezone('Asia/Kolkata', a.appointment_time)::date between v_prev_start and v_prev_end and lower(coalesce(a.status, '')) not in ('cancelled','canceled','no_show')
      union
      select pv.patient_id from public.patient_visits pv where pv.clinic_id = v_clinic_id and timezone('Asia/Kolkata', pv.visit_date)::date between v_prev_start and v_prev_end
      union
      select p.id from public.patients p where p.clinic_id = v_clinic_id and p.archived_at is null and timezone('Asia/Kolkata', p.created_at)::date between v_prev_start and v_prev_end
    ) q),0),
    coalesce((select count(*)::integer from public.patients p where p.clinic_id=v_clinic_id and p.archived_at is null and timezone('Asia/Kolkata',p.created_at)::date between v_start and v_end),0),
    coalesce((select count(*)::integer from public.patients p where p.clinic_id=v_clinic_id and p.archived_at is null and timezone('Asia/Kolkata',p.created_at)::date between v_prev_start and v_prev_end),0),
    coalesce((select count(*)::integer from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_start and v_end and lower(coalesce(a.status,'')) not in ('cancelled','canceled','no_show')),0),
    coalesce((select count(*)::integer from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_prev_start and v_prev_end and lower(coalesce(a.status,'')) not in ('cancelled','canceled','no_show')),0),
    coalesce((select count(*)::integer from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_start and v_end and lower(coalesce(a.status,'')) in ('completed','done')),0),
    coalesce((select count(*)::integer from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_prev_start and v_prev_end and lower(coalesce(a.status,'')) in ('completed','done')),0),
    coalesce((select count(*)::integer from public.patient_visits pv where pv.clinic_id=v_clinic_id and timezone('Asia/Kolkata',pv.visit_date)::date between v_start and v_end),0),
    coalesce((select count(*)::integer from public.patient_visits pv where pv.clinic_id=v_clinic_id and timezone('Asia/Kolkata',pv.visit_date)::date between v_prev_start and v_prev_end),0),
    coalesce((select count(*)::integer from public.treatments t where t.clinic_id=v_clinic_id and timezone('Asia/Kolkata',t.created_at)::date between v_start and v_end),0),
    coalesce((select count(*)::integer from public.treatments t where t.clinic_id=v_clinic_id and timezone('Asia/Kolkata',t.created_at)::date between v_prev_start and v_prev_end),0),
    coalesce((select count(*)::integer from public.files f where f.clinic_id=v_clinic_id and f.archived_at is null and timezone('Asia/Kolkata',f.created_at)::date between v_start and v_end),0),
    coalesce((select count(*)::integer from public.files f where f.clinic_id=v_clinic_id and f.archived_at is null and timezone('Asia/Kolkata',f.created_at)::date between v_prev_start and v_prev_end),0),
    case when v_can_view_finance then coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id=v_clinic_id and coalesce(lower(py.status),'active') in ('active','corrected','refund') and timezone('Asia/Kolkata',py.created_at)::date between v_start and v_end),0) else null end,
    case when v_can_view_finance then coalesce((select sum(py.amount)::numeric from public.payments py where py.clinic_id=v_clinic_id and coalesce(lower(py.status),'active') in ('active','corrected','refund') and timezone('Asia/Kolkata',py.created_at)::date between v_prev_start and v_prev_end),0) else null end,
    case when v_can_view_finance then coalesce((select sum(inv.due_amount)::numeric from public.invoices inv where inv.clinic_id=v_clinic_id and inv.due_amount>0 and lower(coalesce(inv.status,'')) in ('unpaid','partial')),0) else null end
  from public.clinics c
  where c.id = v_clinic_id
  limit 1;
end;
$$;

revoke all on function public.get_capdent_ai_period_analytics(text) from public;
grant execute on function public.get_capdent_ai_period_analytics(text) to authenticated;
