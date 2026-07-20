-- Keep anonymous website appointment intake working, but reject empty,
-- oversized, malformed, backdated, or authority-setting payloads.

begin;

drop policy if exists "Anyone can create website appointment"
  on public.website_appointments;

create policy "Validated website appointment intake"
on public.website_appointments
for insert
to anon
with check (
  length(btrim(patient_name)) between 2 and 120
  and phone ~ '^\\+?[0-9][0-9 ()-]{6,19}$'
  and length(phone) between 7 and 20
  and (treatment is null or length(treatment) <= 160)
  and (preferred_time is null or length(preferred_time) <= 80)
  and (message is null or length(message) <= 2000)
  and (preferred_date is null or preferred_date >= current_date)
  and status = 'new'
  and source = 'website'
);

commit;
