-- Automatically set treatment status from the Add Visit follow-up workflow.
-- If a treatment is created from a visit with a follow-up date, it stays active as ongoing.
-- If a treatment is created from a visit without a follow-up date, it is treated as completed.

create or replace function public.set_treatment_status_from_visit_followup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_appointment_date timestamptz;
begin
  if new.visit_id is null then
    return new;
  end if;

  -- Only auto-decide the default Add Visit status. Manual status choices stay respected.
  if coalesce(new.status, 'planned') = 'planned' then
    select pv.next_appointment_date
      into v_next_appointment_date
    from public.patient_visits pv
    where pv.id = new.visit_id
      and pv.clinic_id = new.clinic_id;

    if v_next_appointment_date is not null then
      new.status := 'ongoing';
    else
      new.status := 'completed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists before_treatments_status_from_visit_followup on public.treatments;

create trigger before_treatments_status_from_visit_followup
before insert on public.treatments
for each row
execute function public.set_treatment_status_from_visit_followup();
