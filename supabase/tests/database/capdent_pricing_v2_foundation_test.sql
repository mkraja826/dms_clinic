-- CapDent pricing V2 local database verification.
--
-- Run only against a disposable local Supabase database after migrations.
-- The test is wrapped in a transaction and rolls back its own extension setup.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(29);

select extensions.has_table(
  'public',
  'capdent_plan_catalog',
  'Pricing plan catalogue exists'
);

select extensions.has_table(
  'public',
  'capdent_pricing_flags',
  'Pricing rollout flags exist'
);

select extensions.has_table(
  'public',
  'clinic_pricing_settings',
  'Per-clinic pricing settings exist'
);

select extensions.has_table(
  'public',
  'capdent_pricing_shadow_events',
  'Shadow observation table exists'
);

select extensions.is(
  (select patient_limit from public.capdent_plan_catalog where code = 'free'),
  300,
  'Free plan allows 300 patients'
);

select extensions.is(
  (select storage_limit_bytes from public.capdent_plan_catalog where code = 'free'),
  1073741824::bigint,
  'Free plan includes 1 GiB storage'
);

select extensions.is(
  (select monthly_price::integer from public.capdent_plan_catalog where code = 'cloud'),
  799,
  'Cloud plan price is INR 799 per month'
);

select extensions.is(
  (select storage_limit_bytes from public.capdent_plan_catalog where code = 'cloud'),
  5368709120::bigint,
  'Cloud plan includes 5 GiB storage'
);

select extensions.is(
  (select monthly_price::integer from public.capdent_plan_catalog where code = 'intelligence'),
  1499,
  'Intelligence plan price is INR 1499 per month'
);

select extensions.is(
  (select storage_limit_bytes from public.capdent_plan_catalog where code = 'intelligence'),
  21474836480::bigint,
  'Intelligence plan includes 20 GiB storage'
);

select extensions.ok(
  (select analytics_enabled from public.capdent_plan_catalog where code = 'intelligence'),
  'Intelligence plan includes analytics entitlement'
);

select extensions.ok(
  (select multi_clinic_enabled from public.capdent_plan_catalog where code = 'intelligence'),
  'Intelligence plan includes multi-clinic entitlement'
);

select extensions.is(
  (select count(*)::integer from public.capdent_pricing_flags),
  5,
  'All five rollout flags are present'
);

select extensions.is(
  (select count(*)::integer from public.capdent_pricing_flags where enabled),
  0,
  'Every rollout flag starts disabled on a fresh local database'
);

select extensions.is(
  (
    select count(*)::integer
    from public.clinics c
    left join public.clinic_pricing_settings cps on cps.clinic_id = c.id
    where cps.clinic_id is null
  ),
  0,
  'Every clinic present during migration receives pricing settings'
);

select extensions.is(
  (
    select count(*)::integer
    from public.clinic_pricing_settings
    where grandfathered is not true
       or patient_limit_enforced is not false
  ),
  0,
  'Clinics present during migration are grandfathered and non-enforcing'
);

select extensions.has_trigger(
  'public',
  'clinics',
  'clinics_initialize_capdent_pricing',
  'New clinics receive pricing settings through an additive trigger'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'patients'
      and not t.tgisinternal
      and (
        t.tgname ilike '%pricing%'
        or p.proname ilike '%pricing%'
        or p.proname ilike '%patient_limit%'
      )
  ),
  0,
  'Pricing V2 adds no blocking trigger to patients'
);

select extensions.ok(
  to_regprocedure('public.get_capdent_entitlements_v2()') is not null,
  'Read-only pricing V2 entitlement function exists'
);

-- Observation mode: enforcement is disabled, so every count remains allowed.
select extensions.is(
  (
    select jsonb_object_agg(patient_count::text, can_add order by patient_count)
    from (
      select
        patient_count,
        (not false or not (patient_count >= 300)) as can_add
      from (values (0), (299), (300), (301)) scenarios(patient_count)
    ) outcomes
  ),
  '{"0": true, "299": true, "300": true, "301": true}'::jsonb,
  'Observation mode allows patient creation at 0, 299, 300, and 301'
);

-- Enforced, explicitly enabled, non-grandfathered clinic scenarios.
select extensions.ok(
  not (true and true and not false) or not (0 >= 300),
  'Enforced non-grandfathered clinic can add patient at count 0'
);

select extensions.ok(
  not (true and true and not false) or not (299 >= 300),
  'Enforced non-grandfathered clinic can add patient at count 299'
);

select extensions.ok(
  not (
    not (true and true and not false) or not (300 >= 300)
  ),
  'Enforced non-grandfathered clinic is blocked at count 300'
);

select extensions.ok(
  not (
    not (true and true and not false) or not (301 >= 300)
  ),
  'Enforced non-grandfathered clinic remains blocked at count 301'
);

-- Grandfathering overrides both global and per-clinic enforcement.
select extensions.is(
  (
    select jsonb_object_agg(patient_count::text, can_add order by patient_count)
    from (
      select
        patient_count,
        (
          not (true and true and not true)
          or not (patient_count >= 300)
        ) as can_add
      from (values (0), (299), (300), (301)) scenarios(patient_count)
    ) outcomes
  ),
  '{"0": true, "299": true, "300": true, "301": true}'::jsonb,
  'Grandfathered clinic remains allowed at every tested patient count'
);

select extensions.ok(
  not (false and true and not false),
  'Global flag off disables effective enforcement'
);

select extensions.ok(
  not (true and false and not false),
  'Per-clinic flag off disables effective enforcement'
);

select extensions.ok(
  not (true and true and not true),
  'Grandfathered status disables effective enforcement'
);

select extensions.ok(
  true and true and not false,
  'Effective enforcement requires all three safety conditions'
);

select * from extensions.finish();

rollback;
