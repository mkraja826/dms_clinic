create or replace function public.get_owner_monthly_revenue(p_month_start date default date_trunc('month', now())::date)
returns table(
  month_start date,
  month_end date,
  total_amount numeric,
  payment_count bigint,
  average_per_day numeric,
  best_day_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if not public.current_user_is_owner() then
    raise exception 'Only the clinic owner or head doctor can view monthly revenue.' using errcode = '42501';
  end if;

  v_clinic_id := public.current_user_clinic_id();
  if v_clinic_id is null then
    raise exception 'Clinic profile not found.' using errcode = 'P0002';
  end if;

  return query
  with bounds as (
    select
      p_month_start::date as start_day,
      (p_month_start + interval '1 month')::date as end_day,
      case
        when p_month_start = date_trunc('month', now())::date then greatest(1, extract(day from now())::integer)
        else extract(day from ((p_month_start + interval '1 month')::date - interval '1 day'))::integer
      end as days_count
  ),
  month_payments as (
    select p.amount, p.created_at::date as paid_day, p.status
    from public.payments p, bounds b
    where p.clinic_id = v_clinic_id
      and p.created_at >= b.start_day::timestamptz
      and p.created_at < b.end_day::timestamptz
      and p.status <> 'voided'
  ),
  day_totals as (
    select paid_day, coalesce(sum(amount), 0) as day_amount
    from month_payments
    group by paid_day
  )
  select
    b.start_day,
    b.end_day,
    coalesce((select sum(amount) from month_payments), 0),
    coalesce((select count(*) from month_payments where amount > 0 and status in ('active', 'corrected')), 0)::bigint,
    coalesce((select sum(amount) from month_payments), 0) / b.days_count,
    coalesce((select max(day_amount) from day_totals), 0)
  from bounds b;
end;
$$;

revoke all on function public.get_owner_monthly_revenue(date) from public;
grant execute on function public.get_owner_monthly_revenue(date) to authenticated;
