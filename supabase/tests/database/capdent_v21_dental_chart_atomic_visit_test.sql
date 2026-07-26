-- Run only against a disposable local Supabase database after migrations.
-- The test creates synthetic rows, exercises the atomic RPC, and rolls back.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

select extensions.has_column(
  'public',
  'clinics',
  'tooth_chart_enabled',
  'Clinics have a staged dental-chart flag'
);

select extensions.has_table(
  'public',
  'dental_chart_entries',
  'Append-only dental chart table exists'
);

select extensions.ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.dental_chart_entries'::regclass
  ),
  'Dental chart entries have RLS enabled'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.dental_chart_entries',
    'INSERT'
  ),
  'Mobile clients cannot insert chart history directly'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.dental_chart_entries',
    'UPDATE'
  ),
  'Mobile clients cannot update chart history'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.dental_chart_entries',
    'DELETE'
  ),
  'Mobile clients cannot delete chart history'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.save_visit_with_tooth_chart(uuid,uuid,text,text,timestamptz,text,uuid,text,numeric,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'Authenticated clinical clients can invoke the validated RPC'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.save_visit_with_tooth_chart(uuid,uuid,text,text,timestamptz,text,uuid,text,numeric,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'Anonymous clients cannot invoke the charted-visit RPC'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.dental_chart_entries'::regclass
      and tgname = 'dental_chart_entries_prevent_client_mutation'
      and not tgisinternal
  ),
  'Chart history has a mutation-prevention trigger'
);

create temporary table capdent_v21_chart_fixture as
select
  gen_random_uuid() as clinic_id,
  gen_random_uuid() as other_clinic_id,
  gen_random_uuid() as actor_id,
  gen_random_uuid() as patient_id,
  gen_random_uuid() as other_patient_id,
  gen_random_uuid() as queue_appointment_id;

insert into public.clinics (id, name, tooth_chart_enabled)
select clinic_id, 'CapDent v21 chart test clinic', true
from capdent_v21_chart_fixture;

insert into public.clinics (id, name)
select other_clinic_id, 'CapDent v21 isolated clinic'
from capdent_v21_chart_fixture;

select extensions.ok(
  not (
    select tooth_chart_enabled
    from public.clinics
    where id = (
      select other_clinic_id
      from capdent_v21_chart_fixture
    )
  ),
  'New and existing clinics default dental chart to disabled'
);

-- Local pgTAP runs as a database administrator. Suppress the auth.users
-- foreign-key trigger only for this synthetic profile fixture.
set local session_replication_role = replica;
insert into public.profiles (
  id,
  clinic_id,
  name,
  email,
  role,
  active
)
select
  actor_id,
  clinic_id,
  'Local Test Dentist',
  'chart-test@example.invalid',
  'head_doctor',
  true
from capdent_v21_chart_fixture;
set local session_replication_role = origin;

insert into public.patients (id, clinic_id, name)
select patient_id, clinic_id, 'Local Chart Patient'
from capdent_v21_chart_fixture;

insert into public.patients (id, clinic_id, name)
select other_patient_id, other_clinic_id, 'Other Clinic Patient'
from capdent_v21_chart_fixture;

insert into public.appointments (
  id,
  clinic_id,
  patient_id,
  doctor_id,
  appointment_time,
  status,
  notes
)
select
  queue_appointment_id,
  clinic_id,
  patient_id,
  actor_id,
  now(),
  'waiting',
  'Synthetic local queue row'
from capdent_v21_chart_fixture;

select set_config(
  'request.jwt.claim.sub',
  (select actor_id::text from capdent_v21_chart_fixture),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table capdent_v21_chart_result as
select public.save_visit_with_tooth_chart(
  p_patient_id := (
    select patient_id
    from capdent_v21_chart_fixture
  ),
  p_doctor_id := (
    select actor_id
    from capdent_v21_chart_fixture
  ),
  p_chief_complaint := 'Local atomic chart test',
  p_doctor_notes := 'Synthetic test only',
  p_next_appointment_date := now() + interval '1 day',
  p_followup_notes := 'Local follow-up',
  p_existing_treatment_id := null,
  p_existing_treatment_status := null,
  p_existing_payment_amount := 0,
  p_existing_payment_method := 'Cash',
  p_treatments := '[
    {
      "treatment_name": "Composite filling",
      "category": "Restorative",
      "cost": 1000,
      "paid_amount": 400,
      "payment_method": "UPI",
      "status": "ongoing"
    },
    {
      "treatment_name": "Review",
      "category": "Preventive",
      "cost": 200,
      "paid_amount": 0,
      "payment_method": "Cash",
      "status": "planned"
    }
  ]'::jsonb,
  p_chart_entries := '[
    {
      "tooth_code": "16",
      "dentition": "permanent",
      "condition": "caries",
      "surfaces": ["occlusal", "mesial"],
      "notes": "Synthetic local finding",
      "treatment_name": "Composite filling",
      "treatment_status": "ongoing"
    },
    {
      "tooth_code": "11",
      "dentition": "permanent",
      "condition": "filled",
      "surfaces": ["distal"],
      "notes": null,
      "treatment_name": null,
      "treatment_status": "completed"
    }
  ]'::jsonb
) as result;

select extensions.is(
  (
    select count(*)::integer
    from public.patient_visits
    where id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  ),
  1,
  'Atomic RPC creates one visit'
);

select extensions.is(
  (
    select count(*)::integer
    from public.dental_chart_entries
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  ),
  2,
  'Atomic RPC creates all chart findings'
);

select extensions.is(
  (
    select count(*)::integer
    from public.treatments
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  ),
  2,
  'Atomic RPC supports multiple structured treatments'
);

select extensions.ok(
  (
    select
      count(*) filter (where status = 'ongoing') = 1
      and count(*) filter (where status = 'planned') = 1
    from public.treatments
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  ),
  'Treatment status is saved exactly as supplied'
);

select extensions.is(
  (
    select count(*)::integer
    from public.invoices
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  ),
  2,
  'Atomic RPC creates one invoice per costed treatment'
);

select extensions.is(
  (
    select count(*)::integer
    from public.payments
    where invoice_id in (
      select id
      from public.invoices
      where visit_id = (
        select (result->>'visit_id')::uuid
        from capdent_v21_chart_result
      )
    )
  ),
  1,
  'Atomic RPC creates only the supplied positive payment'
);

select extensions.is(
  (
    select status
    from public.appointments
    where id = (
      select queue_appointment_id
      from capdent_v21_chart_fixture
    )
  ),
  'completed',
  'Existing same-day waiting queue row is completed'
);

select extensions.is(
  (
    select count(*)::integer
    from public.appointments
    where patient_id = (
      select patient_id
      from capdent_v21_chart_fixture
    )
      and status = 'scheduled'
      and appointment_time > now()
  ),
  1,
  'New follow-up remains scheduled'
);

select extensions.is(
  (
    select (result->>'chart_entries_created')::integer
    from capdent_v21_chart_result
  ),
  2,
  'RPC reports the chart row count'
);

select extensions.is(
  (
    select jsonb_array_length(result->'treatment_ids')
    from capdent_v21_chart_result
  ),
  2,
  'RPC returns both treatment ids'
);

select extensions.throws_ok(
  $$
    update public.dental_chart_entries
    set notes = 'Forbidden rewrite'
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  $$,
  'P0001',
  'Dental chart history is append-only',
  'Authenticated context cannot update chart history'
);

select extensions.throws_ok(
  $$
    delete from public.dental_chart_entries
    where visit_id = (
      select (result->>'visit_id')::uuid
      from capdent_v21_chart_result
    )
  $$,
  'P0001',
  'Dental chart history is append-only',
  'Authenticated context cannot delete chart history'
);

select extensions.throws_ok(
  $$
    select public.save_visit_with_tooth_chart(
      p_patient_id := (
        select other_patient_id
        from capdent_v21_chart_fixture
      ),
      p_doctor_id := (
        select actor_id
        from capdent_v21_chart_fixture
      ),
      p_chief_complaint := 'Cross-clinic attempt',
      p_doctor_notes := null,
      p_next_appointment_date := null,
      p_followup_notes := null,
      p_existing_treatment_id := null,
      p_existing_treatment_status := null,
      p_existing_payment_amount := 0,
      p_existing_payment_method := 'Cash',
      p_treatments := '[]'::jsonb,
      p_chart_entries := '[{
        "tooth_code": "11",
        "dentition": "permanent",
        "condition": "healthy",
        "surfaces": [],
        "treatment_status": "planned"
      }]'::jsonb
    )
  $$,
  'P0001',
  'Patient not found in the active clinic',
  'Atomic RPC rejects cross-clinic patients'
);

create temporary table capdent_v21_existing_treatment as
select
  gen_random_uuid() as treatment_id,
  gen_random_uuid() as invoice_id;

insert into public.treatments (
  id,
  clinic_id,
  patient_id,
  treatment_name,
  cost,
  status
)
select
  existing.treatment_id,
  fixture.clinic_id,
  fixture.patient_id,
  'Existing local treatment',
  500,
  'ongoing'
from capdent_v21_existing_treatment existing
cross join capdent_v21_chart_fixture fixture;

insert into public.invoices (
  id,
  clinic_id,
  patient_id,
  total_amount,
  paid_amount,
  due_amount,
  status,
  payment_category
)
select
  existing.invoice_id,
  fixture.clinic_id,
  fixture.patient_id,
  500,
  0,
  500,
  'unpaid',
  'treatment_fee'
from capdent_v21_existing_treatment existing
cross join capdent_v21_chart_fixture fixture;

select public.save_visit_with_tooth_chart(
  p_patient_id := (
    select patient_id
    from capdent_v21_chart_fixture
  ),
  p_doctor_id := (
    select actor_id
    from capdent_v21_chart_fixture
  ),
  p_chief_complaint := 'Existing treatment chart test',
  p_doctor_notes := null,
  p_next_appointment_date := null,
  p_followup_notes := null,
  p_existing_treatment_id := (
    select treatment_id
    from capdent_v21_existing_treatment
  ),
  p_existing_treatment_status := 'completed',
  p_existing_payment_amount := 200,
  p_existing_payment_method := 'UPI',
  p_treatments := '[]'::jsonb,
  p_chart_entries := '[{
    "tooth_code": "12",
    "dentition": "permanent",
    "condition": "filled",
    "surfaces": ["distal"],
    "treatment_name": "Existing local treatment",
    "treatment_status": "completed"
  }]'::jsonb
);

select extensions.is(
  (
    select status
    from public.treatments
    where id = (
      select treatment_id
      from capdent_v21_existing_treatment
    )
  ),
  'completed',
  'Existing treatment uses the explicit supplied status'
);

select extensions.is(
  (
    select sum(due_amount)
    from public.invoices
    where patient_id = (
      select patient_id
      from capdent_v21_chart_fixture
    )
      and payment_category = 'treatment_fee'
  ),
  1100::numeric,
  'Existing treatment collection reduces the patient treatment balance atomically'
);

select extensions.is(
  (
    select count(*)::integer
    from public.payments
    where patient_id = (
      select patient_id
      from capdent_v21_chart_fixture
    )
      and amount = 200
      and payment_method = 'UPI'
  ),
  1,
  'Existing treatment collection creates one canonical payment'
);

select * from extensions.finish();

rollback;
