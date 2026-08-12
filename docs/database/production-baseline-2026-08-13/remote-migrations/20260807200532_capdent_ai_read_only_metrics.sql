create or replace function public.get_capdent_ai_metrics(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_role text;
  v_from date := least(coalesce(p_from, timezone('Asia/Kolkata', now())::date), coalesce(p_to, timezone('Asia/Kolkata', now())::date));
  v_to date := greatest(coalesce(p_from, timezone('Asia/Kolkata', now())::date), coalesce(p_to, timezone('Asia/Kolkata', now())::date));
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select clinic_id, role into v_clinic_id, v_role
  from public.profiles
  where id = v_user_id and active = true
  limit 1;

  if v_clinic_id is null then raise exception 'Clinic not found for current user'; end if;
  if (v_to - v_from) > 366 then raise exception 'Date range cannot exceed 366 days'; end if;

  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'role', v_role,
    'new_patients', (select count(*) from public.patients p where p.clinic_id=v_clinic_id and p.archived_at is null and timezone('Asia/Kolkata',p.created_at)::date between v_from and v_to),
    'appointments', (select count(*) from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_from and v_to),
    'appointments_completed', (select count(*) from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_from and v_to and lower(coalesce(a.status,'')) in ('completed','done')),
    'appointments_cancelled', (select count(*) from public.appointments a where a.clinic_id=v_clinic_id and timezone('Asia/Kolkata',a.appointment_time)::date between v_from and v_to and lower(coalesce(a.status,''))='cancelled'),
    'visits', (select count(*) from public.patient_visits v where v.clinic_id=v_clinic_id and timezone('Asia/Kolkata',v.visit_date)::date between v_from and v_to),
    'treatments', (select count(*) from public.treatments t where t.clinic_id=v_clinic_id and timezone('Asia/Kolkata',t.created_at)::date between v_from and v_to),
    'treatments_completed', (select count(*) from public.treatments t where t.clinic_id=v_clinic_id and timezone('Asia/Kolkata',t.created_at)::date between v_from and v_to and lower(coalesce(t.status,''))='completed'),
    'files_uploaded', (select count(*) from public.files f where f.clinic_id=v_clinic_id and f.archived_at is null and timezone('Asia/Kolkata',f.created_at)::date between v_from and v_to),
    'xrays_uploaded', (select count(*) from public.files f where f.clinic_id=v_clinic_id and f.archived_at is null and lower(coalesce(f.file_type,''))='xray' and timezone('Asia/Kolkata',f.created_at)::date between v_from and v_to),
    'net_collections', coalesce((select sum(case when lower(coalesce(py.status,'active'))='active' then py.amount when lower(coalesce(py.status,''))='refund' then py.amount else 0 end) from public.payments py where py.clinic_id=v_clinic_id and timezone('Asia/Kolkata',py.created_at)::date between v_from and v_to),0),
    'active_payment_count', (select count(*) from public.payments py where py.clinic_id=v_clinic_id and lower(coalesce(py.status,'active'))='active' and timezone('Asia/Kolkata',py.created_at)::date between v_from and v_to),
    'refund_total', coalesce((select sum(abs(py.amount)) from public.payments py where py.clinic_id=v_clinic_id and lower(coalesce(py.status,''))='refund' and timezone('Asia/Kolkata',py.created_at)::date between v_from and v_to),0),
    'billed_amount', coalesce((select sum(inv.total_amount) from public.invoices inv where inv.clinic_id=v_clinic_id and timezone('Asia/Kolkata',inv.created_at)::date between v_from and v_to),0),
    'outstanding_due_now', coalesce((select sum(inv.due_amount) from public.invoices inv where inv.clinic_id=v_clinic_id and inv.due_amount>0 and lower(coalesce(inv.status,'')) in ('unpaid','partial')),0),
    'financial_adjustments', (select count(*) from public.financial_adjustments fa where fa.clinic_id=v_clinic_id and timezone('Asia/Kolkata',fa.created_at)::date between v_from and v_to)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_capdent_ai_metrics(date,date) from public, anon;
grant execute on function public.get_capdent_ai_metrics(date,date) to authenticated;
