-- Run only against a disposable local Supabase database after migrations.
-- No production data is read or changed; the entire fixture rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(19);

select extensions.has_column(
  'public',
  'clinics',
  'payment_push_enabled',
  'Clinics have a staged payment-push flag'
);

select extensions.has_table(
  'public',
  'device_push_tokens',
  'Device token table exists'
);

select extensions.has_table(
  'public',
  'payment_notification_jobs',
  'Payment notification outbox exists'
);

select extensions.has_table(
  'public',
  'payment_notification_deliveries',
  'Per-device delivery audit exists'
);

select extensions.ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.device_push_tokens'::regclass
  ),
  'Device tokens have RLS enabled'
);

select extensions.ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.payment_notification_jobs'::regclass
  ),
  'Notification jobs have RLS enabled'
);

select extensions.ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.payment_notification_deliveries'::regclass
  ),
  'Notification deliveries have RLS enabled'
);

select extensions.ok(
  has_table_privilege(
    'authenticated',
    'public.device_push_tokens',
    'SELECT'
  ),
  'Authenticated eligible users may select their own token through RLS'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.device_push_tokens',
    'DELETE'
  ),
  'Mobile users cannot delete device-token audit rows'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.payment_notification_jobs',
    'INSERT'
  ),
  'Mobile users cannot enqueue notification jobs'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.payment_notification_deliveries',
    'UPDATE'
  ),
  'Mobile users cannot edit delivery results'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_capdent_payment_notification()',
    'EXECUTE'
  ),
  'The payment trigger function is not callable through the Data API'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_enqueue_capdent_notification'
      and not tgisinternal
  ),
  'Payments have a local outbox trigger'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.device_push_tokens'::regclass
      and tgname = 'device_push_tokens_retire_duplicate'
      and not tgisinternal
  ),
  'Reassigned Expo tokens retire stale active ownership before uniqueness checks'
);

create temporary table capdent_v21_payment_fixture as
select
  gen_random_uuid() as clinic_id,
  gen_random_uuid() as patient_id,
  gen_random_uuid() as invoice_id,
  gen_random_uuid() as disabled_payment_id,
  gen_random_uuid() as enabled_payment_id;

insert into public.clinics (id, name)
select clinic_id, 'CapDent v21 local test clinic'
from capdent_v21_payment_fixture;

select extensions.ok(
  not (
    select payment_push_enabled
    from public.clinics
    where id = (select clinic_id from capdent_v21_payment_fixture)
  ),
  'Existing and new clinics default payment push to disabled'
);

insert into public.patients (id, clinic_id, name)
select patient_id, clinic_id, 'Local Test Patient'
from capdent_v21_payment_fixture;

insert into public.invoices (
  id,
  clinic_id,
  patient_id,
  total_amount,
  paid_amount,
  due_amount,
  status
)
select
  invoice_id,
  clinic_id,
  patient_id,
  200,
  0,
  200,
  'unpaid'
from capdent_v21_payment_fixture;

insert into public.payments (
  id,
  clinic_id,
  invoice_id,
  patient_id,
  amount,
  payment_method
)
select
  disabled_payment_id,
  clinic_id,
  invoice_id,
  patient_id,
  100,
  'Cash'
from capdent_v21_payment_fixture;

select extensions.is(
  (
    select count(*)::integer
    from public.payment_notification_jobs
    where payment_id = (
      select disabled_payment_id
      from capdent_v21_payment_fixture
    )
  ),
  0,
  'Disabled clinics do not enqueue payment notifications'
);

update public.clinics
set payment_push_enabled = true
where id = (select clinic_id from capdent_v21_payment_fixture);

insert into public.payments (
  id,
  clinic_id,
  invoice_id,
  patient_id,
  amount,
  payment_method
)
select
  enabled_payment_id,
  clinic_id,
  invoice_id,
  patient_id,
  100,
  'Cash'
from capdent_v21_payment_fixture;

select extensions.is(
  (
    select count(*)::integer
    from public.payment_notification_jobs
    where payment_id = (
      select enabled_payment_id
      from capdent_v21_payment_fixture
    )
  ),
  1,
  'Enabled clinics enqueue exactly one local outbox job'
);

select extensions.is(
  (
    select status
    from public.payment_notification_jobs
    where payment_id = (
      select enabled_payment_id
      from capdent_v21_payment_fixture
    )
  ),
  'queued',
  'New outbox jobs are queued for post-commit delivery'
);

select extensions.is(
  (
    select count(*)::integer
    from public.payment_notification_deliveries
  ),
  0,
  'The payment transaction performs no external delivery work'
);

select * from extensions.finish();

rollback;
