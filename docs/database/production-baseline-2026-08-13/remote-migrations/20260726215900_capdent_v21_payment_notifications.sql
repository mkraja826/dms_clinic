-- CapDent v21 staged payment notifications.
--
-- Additive only. Existing clinics remain disabled. The payment trigger writes
-- only a local outbox row and deliberately swallows notification-side errors so
-- a payment can never fail because push delivery is unavailable.

begin;

alter table public.clinics
  add column if not exists payment_push_enabled boolean not null default false;

comment on column public.clinics.payment_push_enabled is
  'Clinic opt-in for payment push. The server PAYMENT_PUSH_ENABLED kill switch must also be true.';

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  install_id text not null check (
    char_length(install_id) between 12 and 160
  ),
  expo_push_token text not null check (
    expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
  ),
  platform text not null check (platform in ('android', 'ios')),
  device_name text,
  app_version text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, install_id)
);

comment on table public.device_push_tokens is
  'Per-install Expo tokens. Mobile users can manage only their own eligible owner/head-doctor token.';

create unique index if not exists device_push_tokens_active_token_uidx
  on public.device_push_tokens (expo_push_token)
  where active;

create index if not exists device_push_tokens_recipient_idx
  on public.device_push_tokens (clinic_id, user_id, active, last_seen_at desc);

create table if not exists public.payment_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'sent', 'retry', 'failed', 'skipped')
  ),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id)
);

comment on table public.payment_notification_jobs is
  'Post-commit payment push outbox. A Database Webhook may invoke the staged Edge Function after insert.';

create index if not exists payment_notification_jobs_dispatch_idx
  on public.payment_notification_jobs (status, next_attempt_at, created_at)
  where status in ('queued', 'retry');

create index if not exists payment_notification_jobs_clinic_created_idx
  on public.payment_notification_jobs (clinic_id, created_at desc);

create table if not exists public.payment_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.payment_notification_jobs(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  device_token_id uuid references public.device_push_tokens(id) on delete set null,
  expo_push_token text not null,
  status text not null default 'pending' check (
    status in ('pending', 'ticket_ok', 'ticket_error', 'delivered', 'receipt_error', 'retry', 'invalid')
  ),
  attempt_count integer not null default 0 check (
    attempt_count between 0 and 20
  ),
  expo_ticket_id text,
  expo_receipt_status text,
  error_code text,
  error_detail text,
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, expo_push_token)
);

comment on table public.payment_notification_deliveries is
  'Idempotent per-device push attempts and Expo ticket/receipt audit.';

create index if not exists payment_notification_deliveries_receipt_idx
  on public.payment_notification_deliveries (status, receipt_checked_at, sent_at)
  where expo_ticket_id is not null
    and status in ('ticket_ok', 'retry');

create index if not exists payment_notification_deliveries_clinic_created_idx
  on public.payment_notification_deliveries (clinic_id, created_at desc);

create or replace function public.capdent_v21_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.retire_duplicate_expo_push_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.active then
    update public.device_push_tokens token
    set
      active = false,
      disabled_at = now(),
      last_error = 'Token reassigned to another authenticated installation',
      updated_at = now()
    where token.expo_push_token = new.expo_push_token
      and token.id <> new.id
      and token.active;
  end if;
  return new;
end;
$$;

drop trigger if exists device_push_tokens_retire_duplicate
  on public.device_push_tokens;
create trigger device_push_tokens_retire_duplicate
before insert or update of expo_push_token, active
on public.device_push_tokens
for each row execute function public.retire_duplicate_expo_push_token();

drop trigger if exists device_push_tokens_touch_updated_at
  on public.device_push_tokens;
create trigger device_push_tokens_touch_updated_at
before update on public.device_push_tokens
for each row execute function public.capdent_v21_touch_updated_at();

drop trigger if exists payment_notification_jobs_touch_updated_at
  on public.payment_notification_jobs;
create trigger payment_notification_jobs_touch_updated_at
before update on public.payment_notification_jobs
for each row execute function public.capdent_v21_touch_updated_at();

drop trigger if exists payment_notification_deliveries_touch_updated_at
  on public.payment_notification_deliveries;
create trigger payment_notification_deliveries_touch_updated_at
before update on public.payment_notification_deliveries
for each row execute function public.capdent_v21_touch_updated_at();

create or replace function public.enqueue_capdent_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(
    (
      select c.payment_push_enabled
      from public.clinics c
      where c.id = new.clinic_id
    ),
    false
  ) then
    insert into public.payment_notification_jobs (
      clinic_id,
      payment_id
    )
    values (
      new.clinic_id,
      new.id
    )
    on conflict (payment_id) do nothing;
  end if;

  return new;
exception
  when others then
    -- The nested PL/pgSQL exception block rolls back only outbox work. The
    -- canonical payment insert remains successful.
    raise warning 'CapDent payment notification enqueue skipped for payment %: %',
      new.id,
      sqlerrm;
    return new;
end;
$$;

drop trigger if exists payments_enqueue_capdent_notification
  on public.payments;
create trigger payments_enqueue_capdent_notification
after insert on public.payments
for each row execute function public.enqueue_capdent_payment_notification();

alter table public.device_push_tokens enable row level security;
alter table public.payment_notification_jobs enable row level security;
alter table public.payment_notification_deliveries enable row level security;

drop policy if exists device_push_tokens_select_own_eligible
  on public.device_push_tokens;
create policy device_push_tokens_select_own_eligible
on public.device_push_tokens
for select
to authenticated
using (
  user_id = (select auth.uid())
  and clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
);

drop policy if exists device_push_tokens_insert_own_eligible
  on public.device_push_tokens;
create policy device_push_tokens_insert_own_eligible
on public.device_push_tokens
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
  and active
);

drop policy if exists device_push_tokens_update_own_eligible
  on public.device_push_tokens;
create policy device_push_tokens_update_own_eligible
on public.device_push_tokens
for update
to authenticated
using (
  user_id = (select auth.uid())
  and clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
)
with check (
  user_id = (select auth.uid())
  and clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
);

drop policy if exists payment_notification_jobs_select_owner
  on public.payment_notification_jobs;
create policy payment_notification_jobs_select_owner
on public.payment_notification_jobs
for select
to authenticated
using (
  clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
);

drop policy if exists payment_notification_deliveries_select_owner
  on public.payment_notification_deliveries;
create policy payment_notification_deliveries_select_owner
on public.payment_notification_deliveries
for select
to authenticated
using (
  clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in ('owner', 'head_doctor')
);

-- Current Supabase projects do not necessarily grant Data API access to new
-- tables automatically. Pair explicit least-privilege grants with RLS.
revoke all on table public.device_push_tokens
  from public, anon, authenticated;
grant select on table public.device_push_tokens to authenticated;
grant insert (
  clinic_id,
  user_id,
  install_id,
  expo_push_token,
  platform,
  device_name,
  app_version,
  active,
  last_seen_at,
  disabled_at,
  last_error,
  created_at,
  updated_at
) on public.device_push_tokens to authenticated;
grant update (
  expo_push_token,
  platform,
  device_name,
  app_version,
  active,
  last_seen_at,
  disabled_at,
  last_error,
  updated_at
) on public.device_push_tokens to authenticated;

revoke all on table public.payment_notification_jobs
  from public, anon, authenticated;
grant select on table public.payment_notification_jobs to authenticated;

revoke all on table public.payment_notification_deliveries
  from public, anon, authenticated;
grant select on table public.payment_notification_deliveries to authenticated;

grant update (payment_push_enabled)
  on public.clinics to authenticated;

revoke all on function public.capdent_v21_touch_updated_at()
  from public, anon, authenticated;
revoke all on function public.enqueue_capdent_payment_notification()
  from public, anon, authenticated;
revoke all on function public.retire_duplicate_expo_push_token()
  from public, anon, authenticated;

commit;
