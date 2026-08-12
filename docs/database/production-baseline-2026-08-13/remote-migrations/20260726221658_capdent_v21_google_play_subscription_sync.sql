-- CapDent v21 server-side Google Play subscription lifecycle reconciliation.
--
-- The job re-verifies linked purchase tokens hourly so renewal, cancellation,
-- grace-period, hold, and expiry state do not depend on the mobile app being
-- open. The HTTP call is asynchronous and the secret stays in Supabase Vault.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.invoke_capdent_google_play_subscription_sync()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select secret.decrypted_secret
  into v_secret
  from vault.decrypted_secrets secret
  where secret.name = 'capdent_google_play_sync_secret'
  limit 1;

  if v_secret is null or char_length(v_secret) < 32 then
    raise warning 'CapDent Google Play sync ignored: Vault secret is unavailable';
    return null;
  end if;

  select net.http_post(
    url := 'https://mzjtdcpbvoximdukpukd.supabase.co/functions/v1/sync-google-play-subscriptions',
    body := jsonb_build_object('mode', 'maintenance'),
    headers := jsonb_build_object(
      'Content-Type',
      'application/json',
      'x-capdent-google-play-sync-secret',
      v_secret
    ),
    timeout_milliseconds := 15000
  )
  into v_request_id;

  return v_request_id;
exception
  when others then
    raise warning 'CapDent Google Play lifecycle sync invocation failed: %',
      sqlerrm;
    return null;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'capdent-google-play-subscription-sync';

select cron.schedule(
  'capdent-google-play-subscription-sync',
  '17 * * * *',
  $capdent_cron$
    select public.invoke_capdent_google_play_subscription_sync();
  $capdent_cron$
);

revoke all on function public.invoke_capdent_google_play_subscription_sync()
  from public, anon, authenticated;

comment on function public.invoke_capdent_google_play_subscription_sync() is
  'Server-only hourly Google Play lifecycle reconciliation using a Vault-held secret.';

commit;
