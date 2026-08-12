create table if not exists public.admin_client_error_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  release text not null,
  route text not null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_client_error_logs_clinic_created_idx
  on public.admin_client_error_logs (clinic_id, created_at desc);
create index if not exists admin_client_error_logs_user_created_idx
  on public.admin_client_error_logs (user_id, created_at desc);

alter table public.admin_client_error_logs enable row level security;

drop policy if exists admin_client_error_logs_select_owner on public.admin_client_error_logs;
create policy admin_client_error_logs_select_owner
  on public.admin_client_error_logs
  for select
  to authenticated
  using (
    clinic_id = public.current_user_clinic_id()
    and public.current_user_is_owner()
  );

create or replace function public.record_admin_client_error(
  p_release text,
  p_route text,
  p_message text,
  p_stack text default null,
  p_context jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_error_id uuid;
  v_context jsonb;
begin
  if not public.current_user_is_owner() then
    raise exception 'Clinic Admin error reporting is available only to owners and head doctors.' using errcode = '42501';
  end if;

  v_clinic_id := public.current_user_clinic_id();
  if v_clinic_id is null then
    raise exception 'No active clinic is linked to this account.' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.admin_client_error_logs
    where user_id = auth.uid()
      and created_at >= now() - interval '10 minutes'
  ) >= 30 then
    return null;
  end if;

  v_context := case
    when p_context is null then '{}'::jsonb
    when length(p_context::text) > 4000 then jsonb_build_object('truncated', true)
    else p_context
  end;

  insert into public.admin_client_error_logs (
    clinic_id,
    user_id,
    release,
    route,
    message,
    stack,
    context,
    user_agent
  ) values (
    v_clinic_id,
    auth.uid(),
    left(coalesce(nullif(trim(p_release), ''), 'unknown'), 80),
    left(coalesce(nullif(trim(p_route), ''), '/portal/'), 300),
    left(coalesce(nullif(trim(p_message), ''), 'Unknown Clinic Admin client error'), 1000),
    nullif(left(coalesce(p_stack, ''), 4000), ''),
    v_context,
    nullif(left(coalesce(p_user_agent, ''), 500), '')
  )
  returning id into v_error_id;

  return v_error_id;
end;
$$;

create or replace function public.admin_get_release_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_result jsonb;
begin
  if not public.current_user_is_owner() then
    raise exception 'Release health is available only to owners and head doctors.' using errcode = '42501';
  end if;

  v_clinic_id := public.current_user_clinic_id();

  with payment_totals as (
    select
      i.id as invoice_id,
      i.total_amount,
      i.paid_amount,
      i.due_amount,
      coalesce(sum(case when coalesce(p.status, 'active') <> 'voided' then p.amount else 0 end), 0) as effective_paid
    from public.invoices i
    left join public.payments p on p.invoice_id = i.id and p.clinic_id = i.clinic_id
    where i.clinic_id = v_clinic_id
    group by i.id, i.total_amount, i.paid_amount, i.due_amount
  )
  select jsonb_build_object(
    'checked_at', now(),
    'clinic_id', v_clinic_id,
    'client_errors_24h', (
      select count(*) from public.admin_client_error_logs
      where clinic_id = v_clinic_id and created_at >= now() - interval '24 hours'
    ),
    'client_errors_7d', (
      select count(*) from public.admin_client_error_logs
      where clinic_id = v_clinic_id and created_at >= now() - interval '7 days'
    ),
    'last_client_error_at', (
      select max(created_at) from public.admin_client_error_logs where clinic_id = v_clinic_id
    ),
    'active_staff', (
      select count(*) from public.profiles where clinic_id = v_clinic_id and active = true
    ),
    'invoice_count', (
      select count(*) from public.invoices where clinic_id = v_clinic_id
    ),
    'payment_count', (
      select count(*) from public.payments where clinic_id = v_clinic_id
    ),
    'paid_total_mismatches', (
      select count(*) from payment_totals where round(paid_amount::numeric, 2) <> round(effective_paid::numeric, 2)
    ),
    'due_total_mismatches', (
      select count(*) from payment_totals where round(due_amount::numeric, 2) <> round(greatest(total_amount - effective_paid, 0)::numeric, 2)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.record_admin_client_error(text, text, text, text, jsonb, text) from public;
grant execute on function public.record_admin_client_error(text, text, text, text, jsonb, text) to authenticated;

revoke all on function public.admin_get_release_health() from public;
grant execute on function public.admin_get_release_health() to authenticated;
