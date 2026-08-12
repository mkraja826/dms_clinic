create or replace function public.get_capdent_ai_finance_insights(
  p_period text default 'this_month',
  p_doctor_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clinic uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  select clinic_id into v_clinic
  from public.profiles
  where id = auth.uid() and active = true;

  if v_clinic is null then
    raise exception 'No active clinic';
  end if;

  case lower(coalesce(p_period,'this_month'))
    when 'today' then
      v_start := date_trunc('day', now());
      v_end := v_start + interval '1 day';
    when 'yesterday' then
      v_end := date_trunc('day', now());
      v_start := v_end - interval '1 day';
    when 'this_week' then
      v_start := date_trunc('week', now());
      v_end := v_start + interval '1 week';
    when 'last_week' then
      v_end := date_trunc('week', now());
      v_start := v_end - interval '1 week';
    when 'last_month' then
      v_end := date_trunc('month', now());
      v_start := v_end - interval '1 month';
    else
      v_start := date_trunc('month', now());
      v_end := v_start + interval '1 month';
  end case;

  select jsonb_build_object(
    'period', lower(coalesce(p_period,'this_month')),
    'from', v_start,
    'to', v_end,
    'doctor_id', p_doctor_id,
    'total_collections', coalesce((
      select sum(p.amount)
      from payments p
      where p.clinic_id = v_clinic
        and p.status = 'active'
        and p.created_at >= v_start and p.created_at < v_end
        and (
          p_doctor_id is null or exists (
            select 1
            from invoices i
            join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
            where i.id = p.invoice_id
              and i.clinic_id = v_clinic
              and pv.doctor_id = p_doctor_id
          )
        )
    ),0),
    'collections_by_day', coalesce((
      select jsonb_agg(x order by x.collection_date)
      from (
        select (p.created_at at time zone 'Asia/Kolkata')::date collection_date,
               sum(p.amount) amount,
               count(*) payment_count
        from payments p
        where p.clinic_id = v_clinic
          and p.status = 'active'
          and p.created_at >= v_start and p.created_at < v_end
          and (
            p_doctor_id is null or exists (
              select 1
              from invoices i
              join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
              where i.id = p.invoice_id
                and i.clinic_id = v_clinic
                and pv.doctor_id = p_doctor_id
            )
          )
        group by 1
      ) x
    ), '[]'::jsonb),
    'top_collection_day', (
      select to_jsonb(x)
      from (
        select (p.created_at at time zone 'Asia/Kolkata')::date collection_date,
               sum(p.amount) amount,
               count(*) payment_count
        from payments p
        where p.clinic_id = v_clinic
          and p.status = 'active'
          and p.created_at >= v_start and p.created_at < v_end
          and (
            p_doctor_id is null or exists (
              select 1
              from invoices i
              join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
              where i.id = p.invoice_id
                and i.clinic_id = v_clinic
                and pv.doctor_id = p_doctor_id
            )
          )
        group by 1
        order by sum(p.amount) desc, 1 asc
        limit 1
      ) x
    ),
    'top_visit_collection', (
      select to_jsonb(x)
      from (
        select pv.id visit_id,
               pv.visit_date,
               pv.patient_id,
               pt.name patient_name,
               pr.name doctor_name,
               sum(p.amount) amount,
               count(*) payment_count
        from payments p
        join invoices i on i.id = p.invoice_id and i.clinic_id = v_clinic
        join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
        join patients pt on pt.id = pv.patient_id and pt.clinic_id = v_clinic
        left join profiles pr on pr.id = pv.doctor_id and pr.clinic_id = v_clinic
        where p.clinic_id = v_clinic
          and p.status = 'active'
          and p.created_at >= v_start and p.created_at < v_end
          and (p_doctor_id is null or pv.doctor_id = p_doctor_id)
        group by pv.id,pv.visit_date,pv.patient_id,pt.name,pr.name
        order by sum(p.amount) desc, pv.visit_date desc
        limit 1
      ) x
    ),
    'doctor_linked_summary', case when p_doctor_id is null then null else jsonb_build_object(
      'billed_amount', coalesce((
        select sum(i.total_amount)
        from invoices i
        join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
        where i.clinic_id = v_clinic
          and pv.doctor_id = p_doctor_id
          and i.created_at >= v_start and i.created_at < v_end
      ),0),
      'collected_amount', coalesce((
        select sum(p.amount)
        from payments p
        join invoices i on i.id = p.invoice_id and i.clinic_id = v_clinic
        join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
        where p.clinic_id = v_clinic
          and p.status = 'active'
          and pv.doctor_id = p_doctor_id
          and p.created_at >= v_start and p.created_at < v_end
      ),0),
      'linked_invoice_count', (
        select count(*)
        from invoices i
        join patient_visits pv on pv.id = i.visit_id and pv.clinic_id = v_clinic
        where i.clinic_id = v_clinic
          and pv.doctor_id = p_doctor_id
          and i.created_at >= v_start and i.created_at < v_end
      )
    ) end,
    'unlinked_invoice_count', (
      select count(*)
      from invoices i
      where i.clinic_id = v_clinic
        and i.visit_id is null
        and i.created_at >= v_start and i.created_at < v_end
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_capdent_ai_finance_insights(text, uuid) to authenticated;
