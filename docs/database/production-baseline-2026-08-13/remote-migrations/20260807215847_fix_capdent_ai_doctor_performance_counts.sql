create or replace function public.get_capdent_ai_clinic_intelligence()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_clinic uuid;
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', now());
  v_today_end timestamptz := date_trunc('day', now()) + interval '1 day';
  v_month_start timestamptz := date_trunc('month', now());
  v_prev_month_start timestamptz := date_trunc('month', now()) - interval '1 month';
  v_next_month_start timestamptz := date_trunc('month', now()) + interval '1 month';
  v_result jsonb;
begin
  select clinic_id into v_clinic
  from public.profiles
  where id = auth.uid() and active = true;

  if v_clinic is null then
    raise exception 'No active clinic';
  end if;

  select jsonb_build_object(
    'generated_at', v_now,
    'today', jsonb_build_object(
      'appointments', (select count(*) from appointments where clinic_id=v_clinic and appointment_time>=v_today_start and appointment_time<v_today_end),
      'scheduled', (select count(*) from appointments where clinic_id=v_clinic and appointment_time>=v_today_start and appointment_time<v_today_end and status='scheduled'),
      'completed_appointments', (select count(*) from appointments where clinic_id=v_clinic and appointment_time>=v_today_start and appointment_time<v_today_end and status='completed'),
      'visits', (select count(*) from patient_visits where clinic_id=v_clinic and visit_date>=v_today_start and visit_date<v_today_end),
      'collections', coalesce((select sum(amount) from payments where clinic_id=v_clinic and created_at>=v_today_start and created_at<v_today_end and status='active'),0),
      'new_patients', (select count(*) from patients where clinic_id=v_clinic and archived_at is null and created_at>=v_today_start and created_at<v_today_end)
    ),
    'month', jsonb_build_object(
      'appointments', (select count(*) from appointments where clinic_id=v_clinic and appointment_time>=v_month_start and appointment_time<v_next_month_start),
      'visits', (select count(*) from patient_visits where clinic_id=v_clinic and visit_date>=v_month_start and visit_date<v_next_month_start),
      'collections', coalesce((select sum(amount) from payments where clinic_id=v_clinic and created_at>=v_month_start and created_at<v_next_month_start and status='active'),0),
      'previous_month_collections', coalesce((select sum(amount) from payments where clinic_id=v_clinic and created_at>=v_prev_month_start and created_at<v_month_start and status='active'),0),
      'new_patients', (select count(*) from patients where clinic_id=v_clinic and archived_at is null and created_at>=v_month_start and created_at<v_next_month_start),
      'returning_patients', (
        select count(*) from (
          select distinct pv.patient_id
          from patient_visits pv
          where pv.clinic_id=v_clinic and pv.visit_date>=v_month_start and pv.visit_date<v_next_month_start
            and exists (select 1 from patient_visits old where old.clinic_id=v_clinic and old.patient_id=pv.patient_id and old.visit_date<v_month_start)
        ) q
      )
    ),
    'dues', jsonb_build_object(
      'total_amount', coalesce((select sum(due_amount) from invoices where clinic_id=v_clinic and due_amount>0),0),
      'invoice_count', (select count(*) from invoices where clinic_id=v_clinic and due_amount>0),
      'top', coalesce((select jsonb_agg(x) from (
        select i.patient_id,p.name,p.phone,sum(i.due_amount) due_amount,count(*) invoice_count
        from invoices i join patients p on p.id=i.patient_id and p.clinic_id=v_clinic
        where i.clinic_id=v_clinic and i.due_amount>0
        group by i.patient_id,p.name,p.phone order by due_amount desc limit 10
      ) x),'[]'::jsonb)
    ),
    'overdue_followups', coalesce((select jsonb_agg(x) from (
      select pv.patient_id,p.name,p.phone,max(pv.next_appointment_date) next_appointment_date,max(pv.visit_date) last_visit
      from patient_visits pv join patients p on p.id=pv.patient_id and p.clinic_id=v_clinic
      where pv.clinic_id=v_clinic and pv.next_appointment_date is not null and pv.next_appointment_date < v_now
        and not exists (
          select 1 from appointments a where a.clinic_id=v_clinic and a.patient_id=pv.patient_id and a.appointment_time>=pv.next_appointment_date and a.status in ('scheduled','completed')
        )
      group by pv.patient_id,p.name,p.phone order by max(pv.next_appointment_date) asc limit 20
    ) x),'[]'::jsonb),
    'doctor_performance', coalesce((select jsonb_agg(x order by x.visits_this_month desc, x.name) from (
      select pr.id doctor_id, pr.name,
        coalesce(v.visits_this_month,0) visits_this_month,
        coalesce(v.unique_patients_this_month,0) unique_patients_this_month,
        coalesce(a.appointments_this_month,0) appointments_this_month
      from profiles pr
      left join (
        select doctor_id,
          count(*) visits_this_month,
          count(distinct patient_id) unique_patients_this_month
        from patient_visits
        where clinic_id=v_clinic and visit_date>=v_month_start and visit_date<v_next_month_start
        group by doctor_id
      ) v on v.doctor_id=pr.id
      left join (
        select doctor_id,
          count(*) appointments_this_month
        from appointments
        where clinic_id=v_clinic and appointment_time>=v_month_start and appointment_time<v_next_month_start
        group by doctor_id
      ) a on a.doctor_id=pr.id
      where pr.clinic_id=v_clinic and pr.active=true and pr.role in ('owner','head_doctor','doctor')
    ) x),'[]'::jsonb),
    'treatment_mix', coalesce((select jsonb_agg(x) from (
      select coalesce(nullif(treatment_name,''),'Unspecified') treatment_name,count(*) count,coalesce(sum(cost),0) recorded_value
      from treatments where clinic_id=v_clinic and created_at>=v_month_start and created_at<v_next_month_start
      group by treatment_name order by count(*) desc limit 12
    ) x),'[]'::jsonb),
    'treatment_status', jsonb_build_object(
      'planned',(select count(*) from treatments where clinic_id=v_clinic and status='planned'),
      'ongoing',(select count(*) from treatments where clinic_id=v_clinic and status='ongoing'),
      'completed',(select count(*) from treatments where clinic_id=v_clinic and status='completed')
    ),
    'upcoming_appointments', coalesce((select jsonb_agg(x) from (
      select a.id,a.appointment_time,a.status,a.patient_id,p.name patient_name,p.phone,pr.name doctor_name
      from appointments a
      join patients p on p.id=a.patient_id and p.clinic_id=v_clinic
      left join profiles pr on pr.id=a.doctor_id and pr.clinic_id=v_clinic
      where a.clinic_id=v_clinic and a.status='scheduled' and a.appointment_time>=v_now
      order by a.appointment_time asc limit 15
    ) x),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
