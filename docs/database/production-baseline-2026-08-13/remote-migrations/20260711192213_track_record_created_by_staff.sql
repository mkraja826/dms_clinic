-- Track which staff member created operational records.
-- This fixes reports showing unnamed/unassigned roles when appointments or payments were created without a staff reference.

alter table public.appointments
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.patients
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.invoices
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists appointments_created_by_idx on public.appointments(created_by);
create index if not exists patients_created_by_idx on public.patients(created_by);
create index if not exists invoices_created_by_idx on public.invoices(created_by);

create or replace function public.set_record_created_by_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.created_by is null then
      new.created_by := v_user_id;
    end if;
  elsif tg_table_name = 'patients' then
    if new.created_by is null then
      new.created_by := v_user_id;
    end if;
  elsif tg_table_name = 'invoices' then
    if new.created_by is null then
      new.created_by := v_user_id;
    end if;
  elsif tg_table_name = 'payments' then
    if new.collected_by is null then
      new.collected_by := v_user_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_set_created_by on public.appointments;
create trigger appointments_set_created_by
before insert on public.appointments
for each row execute function public.set_record_created_by_staff();

drop trigger if exists patients_set_created_by on public.patients;
create trigger patients_set_created_by
before insert on public.patients
for each row execute function public.set_record_created_by_staff();

drop trigger if exists invoices_set_created_by on public.invoices;
create trigger invoices_set_created_by
before insert on public.invoices
for each row execute function public.set_record_created_by_staff();

drop trigger if exists payments_set_collected_by on public.payments;
create trigger payments_set_collected_by
before insert on public.payments
for each row execute function public.set_record_created_by_staff();

-- Safe backfill where staff can be inferred from existing payment or waiver records.
update public.appointments a
set created_by = a.op_fee_waived_by
where a.created_by is null
  and a.op_fee_waived_by is not null;

update public.appointments a
set created_by = (
  select p.collected_by
  from public.payments p
  where p.clinic_id = a.clinic_id
    and p.patient_id = a.patient_id
    and p.collected_by is not null
    and abs(extract(epoch from (p.created_at - a.created_at))) <= 180
  order by abs(extract(epoch from (p.created_at - a.created_at))) asc
  limit 1
)
where a.created_by is null
  and exists (
    select 1
    from public.payments p
    where p.clinic_id = a.clinic_id
      and p.patient_id = a.patient_id
      and p.collected_by is not null
      and abs(extract(epoch from (p.created_at - a.created_at))) <= 180
  );

update public.invoices i
set created_by = (
  select p.collected_by
  from public.payments p
  where p.invoice_id = i.id
    and p.collected_by is not null
  order by p.created_at asc
  limit 1
)
where i.created_by is null
  and exists (
    select 1
    from public.payments p
    where p.invoice_id = i.id
      and p.collected_by is not null
  );

update public.patients pt
set created_by = (
  select a.created_by
  from public.appointments a
  where a.patient_id = pt.id
    and a.created_by is not null
    and abs(extract(epoch from (a.created_at - pt.created_at))) <= 300
  order by abs(extract(epoch from (a.created_at - pt.created_at))) asc
  limit 1
)
where pt.created_by is null
  and exists (
    select 1
    from public.appointments a
    where a.patient_id = pt.id
      and a.created_by is not null
      and abs(extract(epoch from (a.created_at - pt.created_at))) <= 300
  );

grant execute on function public.set_record_created_by_staff() to authenticated;
