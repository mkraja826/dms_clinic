-- =========================================================
-- MDMS: If an old patient visits on any date, automatically add them
-- to that date's patient list through appointments.
--
-- Behavior:
-- 1) If same-day appointment/check-in exists, mark it completed.
-- 2) If no same-day appointment exists, create a completed appointment
--    for that visit date so dashboard/day list includes the patient.
-- 3) Does not touch future appointments on other dates.
-- =========================================================

create or replace function public.complete_open_appointment_after_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_same_day_appointment_id uuid;
begin
  -- First complete any open appointment/check-in for the same patient on the visit date.
  update public.appointments ap
  set status = 'completed'
  where ap.clinic_id = new.clinic_id
    and ap.patient_id = new.patient_id
    and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', coalesce(new.visit_date, now()))::date
    and lower(coalesce(ap.status, '')) in ('scheduled', 'waiting', 'checked_in', 'booked')
  returning ap.id into v_same_day_appointment_id;

  -- If there was no open appointment, check whether any appointment already exists for that same date.
  if v_same_day_appointment_id is null then
    select ap.id
    into v_same_day_appointment_id
    from public.appointments ap
    where ap.clinic_id = new.clinic_id
      and ap.patient_id = new.patient_id
      and timezone('Asia/Kolkata', ap.appointment_time)::date = timezone('Asia/Kolkata', coalesce(new.visit_date, now()))::date
    order by ap.appointment_time asc
    limit 1;
  end if;

  -- If no same-day appointment exists, create one as completed.
  -- This makes old patients appear in that day's patient list after Add Visit.
  if v_same_day_appointment_id is null then
    insert into public.appointments (
      clinic_id,
      patient_id,
      doctor_id,
      appointment_time,
      status,
      notes,
      op_fee_amount,
      op_fee_status
    )
    values (
      new.clinic_id,
      new.patient_id,
      null,
      coalesce(new.visit_date, now()),
      'completed',
      'Auto-added to daily patient list from doctor visit',
      0,
      'waived'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_complete_open_appointment_after_visit on public.patient_visits;

create trigger trg_complete_open_appointment_after_visit
after insert on public.patient_visits
for each row
execute function public.complete_open_appointment_after_visit();

notify pgrst, 'reload schema';
