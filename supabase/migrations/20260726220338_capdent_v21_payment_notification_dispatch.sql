-- CapDent v21 production payment-notification dispatcher.
--
-- The payment transaction only adds a pg_net request to the local queue.
-- Network I/O starts after commit, and every dispatcher error is swallowed so
-- notification availability can never affect the canonical payment write.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create index if not exists dental_chart_entries_patient_id_idx
  on public.dental_chart_entries (patient_id);

create index if not exists payment_notification_deliveries_recipient_user_id_idx
  on public.payment_notification_deliveries (recipient_user_id);

create index if not exists payment_notification_deliveries_device_token_id_idx
  on public.payment_notification_deliveries (device_token_id);

create or replace function public.invoke_capdent_payment_notification(
  p_job_id uuid default null,
  p_mode text default 'dispatch'
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_secret text;
  v_request_id bigint;
  v_body jsonb;
begin
  if p_mode not in ('dispatch', 'maintenance', 'receipts') then
    raise warning 'CapDent payment notification invocation ignored: invalid mode';
    return null;
  end if;

  if p_mode = 'dispatch' and p_job_id is null then
    raise warning 'CapDent payment notification invocation ignored: missing job id';
    return null;
  end if;

  select secret.decrypted_secret
  into v_secret
  from vault.decrypted_secrets secret
  where secret.name = 'capdent_payment_notification_webhook_secret'
  limit 1;

  if v_secret is null or char_length(v_secret) < 32 then
    raise warning 'CapDent payment notification invocation ignored: Vault secret is unavailable';
    return null;
  end if;

  v_body := case
    when p_mode = 'dispatch' then jsonb_build_object('job_id', p_job_id)
    else jsonb_build_object('mode', p_mode)
  end;

  select net.http_post(
    url := 'https://mzjtdcpbvoximdukpukd.supabase.co/functions/v1/send-payment-notification',
    body := v_body,
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-capdent-webhook-secret',
      v_secret
    ),
    timeout_milliseconds := 5000
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    raise warning 'CapDent payment notification invocation failed: %', sqlerrm;
    return null;
end;
$$;

create or replace function public.dispatch_capdent_payment_notification_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform public.invoke_capdent_payment_notification(new.id, 'dispatch');
  return new;
exception
  when others then
    raise warning 'CapDent notification dispatch trigger skipped job %: %',
      new.id,
      sqlerrm;
    return new;
end;
$$;

drop trigger if exists payment_notification_jobs_dispatch_after_insert
  on public.payment_notification_jobs;
create trigger payment_notification_jobs_dispatch_after_insert
after insert on public.payment_notification_jobs
for each row execute function public.dispatch_capdent_payment_notification_job();

select cron.unschedule(jobid)
from cron.job
where jobname = 'capdent-payment-notification-maintenance';

select cron.schedule(
  'capdent-payment-notification-maintenance',
  '*/5 * * * *',
  $capdent_cron$
    select public.invoke_capdent_payment_notification(
      null,
      'maintenance'
    );
  $capdent_cron$
);

revoke all on function public.invoke_capdent_payment_notification(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dispatch_capdent_payment_notification_job()
  from public, anon, authenticated;

comment on function public.invoke_capdent_payment_notification(uuid, text) is
  'Server-only asynchronous dispatcher authenticated with a Vault-held webhook secret.';

comment on function public.dispatch_capdent_payment_notification_job() is
  'Fail-open trigger: payment notification dispatch can never roll back the outbox row.';

commit;
