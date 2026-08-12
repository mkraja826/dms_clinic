create or replace function public.get_capdent_ai_patient_dental_chart(p_patient_id uuid)
returns table(
  patient_id uuid,
  user_role text,
  tooth_chart_enabled boolean,
  total_entries integer,
  included_entries integer,
  chart_entries jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_chart_enabled boolean := false;
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

  if v_role not in ('owner', 'head_doctor', 'working_doctor', 'doctor') then
    raise exception 'Clinical AI access is not available for this role';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = v_clinic_id
      and p.archived_at is null
  ) then
    raise exception 'Patient not available in current clinic';
  end if;

  select coalesce(c.tooth_chart_enabled, false)
    into v_chart_enabled
  from public.clinics c
  where c.id = v_clinic_id;

  return query
  with ranked_entries as (
    select
      d.tooth_code,
      d.dentition,
      d.condition,
      coalesce(to_jsonb(d.surfaces), '[]'::jsonb) as surfaces,
      nullif(trim(coalesce(d.treatment_name, '')), '') as treatment_name,
      d.treatment_status,
      d.created_at,
      row_number() over (order by d.created_at desc, d.tooth_code) as rn
    from public.dental_chart_entries d
    where d.clinic_id = v_clinic_id
      and d.patient_id = p_patient_id
  ),
  limited as (
    select * from ranked_entries where rn <= 64
  )
  select
    p_patient_id,
    v_role::text,
    v_chart_enabled,
    (select count(*)::integer from public.dental_chart_entries d where d.clinic_id = v_clinic_id and d.patient_id = p_patient_id),
    (select count(*)::integer from limited),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'tooth_code', l.tooth_code,
          'dentition', l.dentition,
          'condition', l.condition,
          'surfaces', l.surfaces,
          'treatment_name', l.treatment_name,
          'treatment_status', l.treatment_status,
          'recorded_at', l.created_at
        )
        order by l.created_at desc, l.tooth_code
      )
      from limited l
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_capdent_ai_patient_dental_chart(uuid) from public;
grant execute on function public.get_capdent_ai_patient_dental_chart(uuid) to authenticated;
