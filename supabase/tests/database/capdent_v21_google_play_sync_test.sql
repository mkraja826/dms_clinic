-- Run only against a disposable local Supabase database after migrations.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(4);

select extensions.has_function(
  'public',
  'invoke_capdent_google_play_subscription_sync',
  array[]::text[],
  'The server-only Google Play lifecycle dispatcher exists'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.invoke_capdent_google_play_subscription_sync()',
    'EXECUTE'
  ),
  'Signed-in mobile users cannot invoke lifecycle reconciliation'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'invoke_capdent_google_play_subscription_sync'
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=pg_catalog, pg_temp']
  ),
  'The lifecycle dispatcher is hardened with an explicit search path'
);

select extensions.ok(
  exists (
    select 1
    from cron.job
    where jobname = 'capdent-google-play-subscription-sync'
      and schedule = '17 * * * *'
  ),
  'Google Play subscription state is reconciled hourly'
);

select * from extensions.finish();

rollback;
