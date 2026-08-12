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
  if v_type not in ('monthly_summary', 'patients', 'appointments', 'clinical', 'gallery', 'payments', 'invoices', 'staff_activity', 'audit', 'archived_records') then
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
    clinic_id, exported_by, report_type, export_format, period_start, period_end, row_count
  ) values (
    v_clinic_id, auth.uid(), v_type, v_format, p_period_start, p_period_end, coalesce(p_row_count, 0)
  ) returning * into v_saved;
  return v_saved;
end;
$$;
