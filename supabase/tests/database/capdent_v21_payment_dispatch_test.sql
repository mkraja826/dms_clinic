-- Run only against a disposable local Supabase database after migrations.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

select extensions.ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'The asynchronous pg_net extension is enabled'
);

select extensions.ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'The retry and receipt maintenance scheduler is enabled'
);

select extensions.has_function(
  'public',
  'invoke_capdent_payment_notification',
  array['uuid', 'text'],
  'The server-only asynchronous dispatcher exists'
);

select extensions.has_function(
  'public',
  'dispatch_capdent_payment_notification_job',
  array[]::text[],
  'The outbox trigger function exists'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.invoke_capdent_payment_notification(uuid,text)',
    'EXECUTE'
  ),
  'Signed-in mobile users cannot invoke the dispatcher'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.dispatch_capdent_payment_notification_job()',
    'EXECUTE'
  ),
  'Signed-in mobile users cannot call the dispatcher trigger'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.payment_notification_jobs'::regclass
      and tgname = 'payment_notification_jobs_dispatch_after_insert'
      and not tgisinternal
  ),
  'New outbox rows enqueue post-commit HTTP dispatch'
);

select extensions.ok(
  exists (
    select 1
    from cron.job
    where jobname = 'capdent-payment-notification-maintenance'
      and schedule = '*/5 * * * *'
  ),
  'Retry and receipt maintenance runs every five minutes'
);

select extensions.has_index(
  'public',
  'dental_chart_entries',
  'dental_chart_entries_patient_id_idx',
  'Dental chart patient foreign keys have a covering index'
);

select extensions.has_index(
  'public',
  'payment_notification_deliveries',
  'payment_notification_deliveries_recipient_user_id_idx',
  'Notification recipient foreign keys have a covering index'
);

select extensions.has_index(
  'public',
  'payment_notification_deliveries',
  'payment_notification_deliveries_device_token_id_idx',
  'Notification device foreign keys have a covering index'
);

select * from extensions.finish();

rollback;
