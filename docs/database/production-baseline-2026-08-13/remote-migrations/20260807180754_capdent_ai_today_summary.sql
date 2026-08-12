create or replace function public.get_capdent_ai_today_summary()
returns table(
  clinic_name text,
  currency_code text,
  local_date date,
  patients_today integer,
  new_patients_today integer,
  appointments_today integer,
  waiting_count integer,
  completed_count integer,
  visits_today integer,
  gallery_uploads_today integer,
  net_collections_today numeric,
  outstanding_dues numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_today date := timezone('Asia/Kolkata', now())::date;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select p.clinic_id
    into v_clinic_id
  from public.profiles p
  where p.id = v_user_id
    and p.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Active clinic not found for current user';
  end if;

  return query
  select
    c.name::text,
    coalesce(c.currency_code, 'INR')::text,
    v_today,
    coalesce((
      select count(distinct q.patient_id)::integer
      from (
        select a.patient_id
        from public.appointments a
        where a.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', a.appointment_time)::date = v_today
          and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'no_show')
        union
        select pv.patient_id
        from public.patient_visits pv
        where pv.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', pv.visit_date)::date = v_today
        union
        select p.id
        from public.patients p
        where p.clinic_id = v_clinic_id
          and p.archived_at is null
          and timezone('Asia/Kolkata', p.created_at)::date = v_today
      ) q
    ), 0),
    coalesce((
      select count(*)::integer
      from public.patients p
      where p.clinic_id = v_clinic_id
        and p.archived_at is null
        and timezone('Asia/Kolkata', p.created_at)::date = v_today
    ), 0),
    coalesce((
      select count(*)::integer
      from public.appointments a
      where a.clinic_id = v_clinic_id
        and timezone('Asia/Kolkata', a.appointment_time)::date = v_today
        and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'no_show')
    ), 0),
    coalesce((
      select count(*)::integer
      from public.appointments a
      where a.clinic_id = v_clinic_id
        and timezone('Asia/Kolkata', a.appointment_time)::date = v_today
        and lower(coalesce(a.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked')
    ), 0),
    coalesce((
      select count(distinct q.patient_id)::integer
      from (
        select a.patient_id
        from public.appointments a
        where a.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', a.appointment_time)::date = v_today
          and lower(coalesce(a.status, '')) in ('completed', 'done')
        union
        select pv.patient_id
        from public.patient_visits pv
        where pv.clinic_id = v_clinic_id
          and timezone('Asia/Kolkata', pv.visit_date)::date = v_today
      ) q
    ), 0),
    coalesce((
      select count(*)::integer
      from public.patient_visits pv
      where pv.clinic_id = v_clinic_id
        and timezone('Asia/Kolkata', pv.visit_date)::date = v_today
    ), 0),
    coalesce((
      select count(*)::integer
      from public.files f
      where f.clinic_id = v_clinic_id
        and f.archived_at is null
        and timezone('Asia/Kolkata', f.created_at)::date = v_today
    ), 0),
    coalesce((
      select sum(py.amount)::numeric
      from public.payments py
      where py.clinic_id = v_clinic_id
        and coalesce(lower(py.status), 'active') in ('active', 'corrected', 'refund')
        and timezone('Asia/Kolkata', py.created_at)::date = v_today
    ), 0),
    coalesce((
      select sum(inv.due_amount)::numeric
      from public.invoices inv
      where inv.clinic_id = v_clinic_id
        and inv.due_amount > 0
        and lower(coalesce(inv.status, '')) in ('unpaid', 'partial')
    ), 0)
  from public.clinics c
  where c.id = v_clinic_id
  limit 1;
end;
$$;

revoke all on function public.get_capdent_ai_today_summary() from public;
grant execute on function public.get_capdent_ai_today_summary() to authenticated;
