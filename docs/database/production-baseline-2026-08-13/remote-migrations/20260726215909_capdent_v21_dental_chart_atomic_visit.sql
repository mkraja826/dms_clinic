-- CapDent v21 staged dental chart and atomic charted-visit transaction.
--
-- Additive only. Existing clinics remain disabled. Chart history is
-- append-only for application roles; inserts occur only through the validated
-- atomic RPC.

begin;

alter table public.clinics
  add column if not exists tooth_chart_enabled boolean not null default false;

comment on column public.clinics.tooth_chart_enabled is
  'Clinic opt-in for the staged FDI dental chart. The app build kill switch must also be true.';

create table if not exists public.dental_chart_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid not null references public.patient_visits(id) on delete cascade,
  recorded_by uuid references public.profiles(id) on delete set null,
  tooth_code text not null,
  dentition text not null check (dentition in ('permanent', 'primary')),
  condition text not null check (
    condition in (
      'healthy',
      'caries',
      'filled',
      'missing',
      'crown',
      'root_canal',
      'implant',
      'extraction_planned',
      'unerupted'
    )
  ),
  surfaces text[] not null default '{}'::text[] check (
    surfaces <@ array[
      'mesial',
      'distal',
      'occlusal',
      'buccal',
      'lingual'
    ]::text[]
    and cardinality(surfaces) <= 5
  ),
  notes text check (notes is null or char_length(notes) <= 1000),
  treatment_name text check (
    treatment_name is null or char_length(treatment_name) <= 160
  ),
  treatment_status text not null check (
    treatment_status in ('planned', 'ongoing', 'completed')
  ),
  created_at timestamptz not null default now(),
  constraint dental_chart_entries_fdi_matches_dentition check (
    (
      dentition = 'permanent'
      and tooth_code ~ '^[1-4][1-8]$'
    )
    or (
      dentition = 'primary'
      and tooth_code ~ '^[5-8][1-5]$'
    )
  ),
  unique (visit_id, dentition, tooth_code)
);

comment on table public.dental_chart_entries is
  'Append-only FDI findings captured with a visit. Application roles receive SELECT only; the atomic RPC performs validated inserts.';

create index if not exists dental_chart_entries_patient_current_idx
  on public.dental_chart_entries (
    clinic_id,
    patient_id,
    dentition,
    tooth_code,
    created_at desc
  );

create index if not exists dental_chart_entries_visit_idx
  on public.dental_chart_entries (visit_id);

create index if not exists dental_chart_entries_recorded_by_idx
  on public.dental_chart_entries (recorded_by);

alter table public.dental_chart_entries enable row level security;

create or replace function public.prevent_dental_chart_history_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    raise exception 'Dental chart history is append-only';
  end if;
  return old;
end;
$$;

drop trigger if exists dental_chart_entries_prevent_client_mutation
  on public.dental_chart_entries;
create trigger dental_chart_entries_prevent_client_mutation
before update or delete on public.dental_chart_entries
for each row execute function public.prevent_dental_chart_history_mutation();

drop policy if exists dental_chart_entries_select_clinical
  on public.dental_chart_entries;
create policy dental_chart_entries_select_clinical
on public.dental_chart_entries
for select
to authenticated
using (
  clinic_id = (select public.current_profile_clinic_id())
  and (select public.current_profile_role()) in (
    'owner',
    'head_doctor',
    'working_doctor',
    'doctor'
  )
);

revoke all on table public.dental_chart_entries
  from public, anon, authenticated;
grant select on table public.dental_chart_entries to authenticated;

grant update (tooth_chart_enabled)
  on public.clinics to authenticated;

create or replace function public.save_visit_with_tooth_chart(
  p_patient_id uuid,
  p_doctor_id uuid,
  p_chief_complaint text,
  p_doctor_notes text,
  p_next_appointment_date timestamptz,
  p_followup_notes text,
  p_existing_treatment_id uuid,
  p_existing_treatment_status text,
  p_existing_payment_amount numeric,
  p_existing_payment_method text,
  p_treatments jsonb,
  p_chart_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_clinic_id uuid;
  v_actor_role text;
  v_visit_id uuid := gen_random_uuid();
  v_appointment_id uuid;
  v_queue_count integer := 0;
  v_chart_count integer := 0;
  v_treatment_ids uuid[] := '{}'::uuid[];
  v_invoice_ids uuid[] := '{}'::uuid[];
  v_treatment jsonb;
  v_chart jsonb;
  v_treatment_id uuid;
  v_invoice_id uuid;
  v_treatment_name text;
  v_treatment_description text;
  v_treatment_category text;
  v_treatment_status text;
  v_cost numeric;
  v_paid numeric;
  v_due numeric;
  v_payment_method text;
  v_dentition text;
  v_tooth_code text;
  v_condition text;
  v_surfaces text[];
  v_chart_notes text;
  v_chart_treatment_name text;
  v_chart_treatment_status text;
  v_existing_invoice public.invoices%rowtype;
  v_remaining_existing_payment numeric;
  v_applied_existing_payment numeric;
begin
  if v_actor_id is null then
    raise exception 'Authentication required';
  end if;

  select p.clinic_id, p.role
  into v_clinic_id, v_actor_role
  from public.profiles p
  where p.id = v_actor_id
    and p.active = true
  limit 1;

  if v_clinic_id is null then
    raise exception 'Active clinic profile not found';
  end if;

  if v_actor_role not in (
    'owner',
    'head_doctor',
    'working_doctor',
    'doctor'
  ) then
    raise exception 'Only authorized dentists can save dental chart visits';
  end if;

  if not coalesce(
    (
      select c.tooth_chart_enabled
      from public.clinics c
      where c.id = v_clinic_id
    ),
    false
  ) then
    raise exception 'Dental chart is disabled for this clinic';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = v_clinic_id
  ) then
    raise exception 'Patient not found in the active clinic';
  end if;

  if not exists (
    select 1
    from public.profiles doctor
    where doctor.id = p_doctor_id
      and doctor.clinic_id = v_clinic_id
      and doctor.active = true
      and doctor.role in (
        'owner',
        'head_doctor',
        'working_doctor',
        'doctor'
      )
  ) then
    raise exception 'Treating doctor not found in the active clinic';
  end if;

  if nullif(trim(coalesce(p_chief_complaint, '')), '') is null then
    raise exception 'Chief complaint is required';
  end if;
  if char_length(p_chief_complaint) > 2000 then
    raise exception 'Chief complaint is too long';
  end if;
  if p_doctor_notes is not null and char_length(p_doctor_notes) > 4000 then
    raise exception 'Doctor notes are too long';
  end if;
  if p_followup_notes is not null and char_length(p_followup_notes) > 2000 then
    raise exception 'Follow-up notes are too long';
  end if;
  if p_next_appointment_date is not null
    and p_next_appointment_date <= now() then
    raise exception 'Follow-up appointment must be in the future';
  end if;

  if coalesce(jsonb_typeof(p_chart_entries), 'null') <> 'array'
    or jsonb_array_length(p_chart_entries) = 0
    or jsonb_array_length(p_chart_entries) > 52 then
    raise exception 'Dental chart entries must contain between 1 and 52 teeth';
  end if;

  if coalesce(jsonb_typeof(p_treatments), 'null') <> 'array'
    or jsonb_array_length(p_treatments) > 20 then
    raise exception 'Treatments must be a JSON array with no more than 20 rows';
  end if;

  if coalesce(p_existing_payment_amount, 0) < 0 then
    raise exception 'Existing treatment payment cannot be negative';
  end if;

  if p_existing_treatment_id is null then
    if coalesce(p_existing_payment_amount, 0) > 0
      or p_existing_treatment_status is not null then
      raise exception 'Existing treatment details require a treatment id';
    end if;
  else
    if p_existing_treatment_status not in (
      'planned',
      'ongoing',
      'completed'
    ) then
      raise exception 'An explicit valid existing treatment status is required';
    end if;

    if not exists (
      select 1
      from public.treatments treatment
      where treatment.id = p_existing_treatment_id
        and treatment.clinic_id = v_clinic_id
        and treatment.patient_id = p_patient_id
        and treatment.status in ('planned', 'ongoing', 'completed')
    ) then
      raise exception 'Existing treatment not found for this patient';
    end if;
  end if;

  insert into public.patient_visits (
    id,
    clinic_id,
    patient_id,
    doctor_id,
    visit_date,
    chief_complaint,
    diagnosis,
    doctor_notes,
    next_appointment_date,
    visit_status,
    created_by
  )
  values (
    v_visit_id,
    v_clinic_id,
    p_patient_id,
    p_doctor_id,
    now(),
    trim(p_chief_complaint),
    null,
    nullif(trim(coalesce(p_doctor_notes, '')), ''),
    p_next_appointment_date,
    'completed',
    v_actor_id
  );

  if p_existing_treatment_id is not null then
    update public.treatments
    set status = p_existing_treatment_status
    where id = p_existing_treatment_id
      and clinic_id = v_clinic_id
      and patient_id = p_patient_id;

    if coalesce(p_existing_payment_amount, 0) > 0 then
      v_remaining_existing_payment := p_existing_payment_amount;

      for v_existing_invoice in
        select invoice.*
        from public.invoices invoice
        where invoice.clinic_id = v_clinic_id
          and invoice.patient_id = p_patient_id
          and invoice.payment_category = 'treatment_fee'
          and invoice.due_amount > 0
        order by invoice.created_at, invoice.id
        for update
      loop
        exit when v_remaining_existing_payment <= 0;
        v_applied_existing_payment := least(
          v_remaining_existing_payment,
          v_existing_invoice.due_amount
        );

        update public.invoices
        set
          paid_amount = paid_amount + v_applied_existing_payment,
          due_amount = due_amount - v_applied_existing_payment,
          status = case
            when due_amount - v_applied_existing_payment <= 0 then 'paid'
            else 'partial'
          end
        where id = v_existing_invoice.id
          and clinic_id = v_clinic_id;

        insert into public.payments (
          clinic_id,
          invoice_id,
          patient_id,
          amount,
          payment_method,
          notes,
          payment_category,
          collected_by
        )
        values (
          v_clinic_id,
          v_existing_invoice.id,
          p_patient_id,
          v_applied_existing_payment,
          coalesce(nullif(trim(p_existing_payment_method), ''), 'Cash'),
          'Ongoing treatment payment',
          'treatment_fee',
          v_actor_id
        );

        v_remaining_existing_payment :=
          v_remaining_existing_payment - v_applied_existing_payment;
      end loop;

      if v_remaining_existing_payment > 0 then
        raise exception 'Existing payment exceeds pending treatment balance';
      end if;
    end if;
  end if;

  for v_treatment in
    select value
    from jsonb_array_elements(p_treatments)
  loop
    if jsonb_typeof(v_treatment) <> 'object' then
      raise exception 'Each treatment must be an object';
    end if;

    v_treatment_name := nullif(
      trim(coalesce(v_treatment->>'treatment_name', '')),
      ''
    );
    v_treatment_description := nullif(
      trim(coalesce(v_treatment->>'description', '')),
      ''
    );
    v_treatment_category := nullif(
      trim(coalesce(v_treatment->>'category', '')),
      ''
    );
    v_treatment_status := v_treatment->>'status';

    begin
      v_cost := coalesce((v_treatment->>'cost')::numeric, 0);
      v_paid := coalesce((v_treatment->>'paid_amount')::numeric, 0);
    exception
      when invalid_text_representation then
        raise exception 'Treatment cost and paid amount must be numeric';
    end;

    v_payment_method := coalesce(
      nullif(trim(v_treatment->>'payment_method'), ''),
      'Cash'
    );

    if v_treatment_name is null
      or char_length(v_treatment_name) > 160 then
      raise exception 'Treatment name is required and must be at most 160 characters';
    end if;
    if v_treatment_description is not null
      and char_length(v_treatment_description) > 2000 then
      raise exception 'Treatment description is too long';
    end if;
    if v_treatment_category is not null
      and char_length(v_treatment_category) > 120 then
      raise exception 'Treatment category is too long';
    end if;
    if v_treatment_status not in ('planned', 'ongoing', 'completed') then
      raise exception 'Every treatment requires an explicit valid status';
    end if;
    if v_cost < 0 or v_paid < 0 or v_paid > v_cost then
      raise exception 'Treatment amounts are invalid';
    end if;

    v_treatment_id := gen_random_uuid();
    insert into public.treatments (
      id,
      clinic_id,
      visit_id,
      patient_id,
      treatment_name,
      description,
      cost,
      status,
      category
    )
    values (
      v_treatment_id,
      v_clinic_id,
      v_visit_id,
      p_patient_id,
      v_treatment_name,
      v_treatment_description,
      v_cost,
      v_treatment_status,
      v_treatment_category
    );
    v_treatment_ids := array_append(v_treatment_ids, v_treatment_id);

    if v_cost > 0 then
      v_due := greatest(v_cost - v_paid, 0);
      v_invoice_id := gen_random_uuid();
      insert into public.invoices (
        id,
        clinic_id,
        patient_id,
        visit_id,
        total_amount,
        paid_amount,
        due_amount,
        status,
        invoice_type,
        payment_category,
        notes,
        created_by
      )
      values (
        v_invoice_id,
        v_clinic_id,
        p_patient_id,
        v_visit_id,
        v_cost,
        v_paid,
        v_due,
        case
          when v_due <= 0 then 'paid'
          when v_paid > 0 then 'partial'
          else 'unpaid'
        end,
        'treatment',
        'treatment_fee',
        v_treatment_name,
        v_actor_id
      );
      v_invoice_ids := array_append(v_invoice_ids, v_invoice_id);

      if v_paid > 0 then
        insert into public.payments (
          clinic_id,
          invoice_id,
          patient_id,
          amount,
          payment_method,
          notes,
          payment_category,
          collected_by
        )
        values (
          v_clinic_id,
          v_invoice_id,
          p_patient_id,
          v_paid,
          v_payment_method,
          'Invoice paid at charted visit creation',
          'treatment_fee',
          v_actor_id
        );
      end if;
    end if;
  end loop;

  for v_chart in
    select value
    from jsonb_array_elements(p_chart_entries)
  loop
    if jsonb_typeof(v_chart) <> 'object' then
      raise exception 'Each dental chart entry must be an object';
    end if;

    v_tooth_code := trim(coalesce(v_chart->>'tooth_code', ''));
    v_dentition := v_chart->>'dentition';
    v_condition := v_chart->>'condition';
    v_chart_notes := nullif(trim(coalesce(v_chart->>'notes', '')), '');
    v_chart_treatment_name := nullif(
      trim(coalesce(v_chart->>'treatment_name', '')),
      ''
    );
    v_chart_treatment_status := v_chart->>'treatment_status';

    if v_dentition not in ('permanent', 'primary') then
      raise exception 'Invalid dentition';
    end if;
    if not (
      (
        v_dentition = 'permanent'
        and v_tooth_code ~ '^[1-4][1-8]$'
      )
      or (
        v_dentition = 'primary'
        and v_tooth_code ~ '^[5-8][1-5]$'
      )
    ) then
      raise exception 'Invalid FDI tooth code % for % dentition',
        v_tooth_code,
        v_dentition;
    end if;
    if v_condition not in (
      'healthy',
      'caries',
      'filled',
      'missing',
      'crown',
      'root_canal',
      'implant',
      'extraction_planned',
      'unerupted'
    ) then
      raise exception 'Invalid dental condition for tooth %', v_tooth_code;
    end if;
    if v_chart_treatment_status not in (
      'planned',
      'ongoing',
      'completed'
    ) then
      raise exception 'Every chart entry requires an explicit treatment status';
    end if;
    if v_chart_notes is not null and char_length(v_chart_notes) > 1000 then
      raise exception 'Dental note is too long';
    end if;
    if v_chart_treatment_name is not null
      and char_length(v_chart_treatment_name) > 160 then
      raise exception 'Chart treatment name is too long';
    end if;
    if coalesce(jsonb_typeof(v_chart->'surfaces'), 'array') <> 'array' then
      raise exception 'Dental surfaces must be an array';
    end if;

    select coalesce(array_agg(distinct surface), '{}'::text[])
    into v_surfaces
    from jsonb_array_elements_text(
      coalesce(v_chart->'surfaces', '[]'::jsonb)
    ) as item(surface);

    if not (
      v_surfaces <@ array[
        'mesial',
        'distal',
        'occlusal',
        'buccal',
        'lingual'
      ]::text[]
    ) or cardinality(v_surfaces) > 5 then
      raise exception 'Invalid dental surface for tooth %', v_tooth_code;
    end if;

    insert into public.dental_chart_entries (
      clinic_id,
      patient_id,
      visit_id,
      recorded_by,
      tooth_code,
      dentition,
      condition,
      surfaces,
      notes,
      treatment_name,
      treatment_status
    )
    values (
      v_clinic_id,
      p_patient_id,
      v_visit_id,
      v_actor_id,
      v_tooth_code,
      v_dentition,
      v_condition,
      v_surfaces,
      v_chart_notes,
      v_chart_treatment_name,
      v_chart_treatment_status
    );
    v_chart_count := v_chart_count + 1;
  end loop;

  -- Complete only pre-existing same-day queue rows. This deliberately runs
  -- before inserting a same-day follow-up, so the new appointment cannot be
  -- marked completed accidentally.
  update public.appointments appointment
  set status = 'completed'
  where appointment.clinic_id = v_clinic_id
    and appointment.patient_id = p_patient_id
    and timezone('Asia/Kolkata', appointment.appointment_time)::date =
      timezone('Asia/Kolkata', now())::date
    and lower(coalesce(appointment.status, '')) in (
      'waiting',
      'checked_in',
      'scheduled',
      'booked'
    );
  get diagnostics v_queue_count = row_count;

  if p_next_appointment_date is not null then
    v_appointment_id := gen_random_uuid();
    insert into public.appointments (
      id,
      clinic_id,
      patient_id,
      doctor_id,
      appointment_time,
      status,
      notes,
      created_by
    )
    values (
      v_appointment_id,
      v_clinic_id,
      p_patient_id,
      p_doctor_id,
      p_next_appointment_date,
      'scheduled',
      nullif(trim(coalesce(p_followup_notes, '')), ''),
      v_actor_id
    );
  end if;

  return jsonb_build_object(
    'visit_id', v_visit_id,
    'treatment_ids', to_jsonb(v_treatment_ids),
    'invoice_ids', to_jsonb(v_invoice_ids),
    'appointment_id', v_appointment_id,
    'queue_rows_completed', v_queue_count,
    'chart_entries_created', v_chart_count
  );
end;
$$;

revoke all on function public.save_visit_with_tooth_chart(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text,
  uuid,
  text,
  numeric,
  text,
  jsonb,
  jsonb
) from public, anon;

revoke all on function public.prevent_dental_chart_history_mutation()
  from public, anon, authenticated;

grant execute on function public.save_visit_with_tooth_chart(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text,
  uuid,
  text,
  numeric,
  text,
  jsonb,
  jsonb
) to authenticated;

commit;
