create or replace function public.get_capdent_ai_patient_history(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_patient_exists boolean := false;
  v_visits jsonb := '[]'::jsonb;
  v_treatments jsonb := '[]'::jsonb;
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
    raise exception 'Clinical AI summary requires doctor access';
  end if;

  select exists(
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = v_clinic_id
      and p.archived_at is null
  ) into v_patient_exists;

  if not v_patient_exists then
    raise exception 'Patient not found in current clinic';
  end if;

  select coalesce(jsonb_agg(row_to_json(v)::jsonb order by v.visit_date desc), '[]'::jsonb)
  into v_visits
  from (
    select
      pv.id,
      pv.visit_date,
      left(coalesce(pv.chief_complaint, ''), 240) as chief_complaint,
      left(coalesce(pv.diagnosis, ''), 320) as diagnosis,
      pv.visit_status,
      pv.next_appointment_date
    from public.patient_visits pv
    where pv.patient_id = p_patient_id
      and pv.clinic_id = v_clinic_id
    order by pv.visit_date desc
    limit 12
  ) v;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_treatments
  from (
    select
      tr.visit_id,
      tr.created_at,
      left(coalesce(tr.treatment_name, ''), 180) as treatment_name,
      left(coalesce(tr.category, ''), 120) as category,
      left(coalesce(tr.status, ''), 80) as status
    from public.treatments tr
    where tr.patient_id = p_patient_id
      and tr.clinic_id = v_clinic_id
    order by tr.created_at desc
    limit 30
  ) t;

  return jsonb_build_object(
    'patient_id', p_patient_id,
    'user_role', v_role,
    'visit_count_included', jsonb_array_length(v_visits),
    'treatment_count_included', jsonb_array_length(v_treatments),
    'visits', v_visits,
    'treatments', v_treatments,
    'privacy', jsonb_build_object(
      'identifiers_included', false,
      'doctor_notes_included', false,
      'medical_history_included', false,
      'files_included', false,
      'max_visits', 12,
      'max_treatments', 30
    )
  );
end;
$$;

revoke all on function public.get_capdent_ai_patient_history(uuid) from public;
grant execute on function public.get_capdent_ai_patient_history(uuid) to authenticated;
