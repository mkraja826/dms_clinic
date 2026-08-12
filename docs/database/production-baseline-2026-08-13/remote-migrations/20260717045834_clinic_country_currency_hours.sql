-- CapDent universal clinic preferences
-- Country and currency are stored per clinic. Opening and closing times are guidance only.

alter table public.clinics
  add column if not exists country_code text not null default 'IN',
  add column if not exists currency_code text not null default 'INR',
  add column if not exists opening_time time without time zone not null default '09:00',
  add column if not exists closing_time time without time zone not null default '21:00';

update public.clinics
set
  country_code = upper(coalesce(nullif(trim(country_code), ''), 'IN')),
  currency_code = upper(coalesce(nullif(trim(currency_code), ''), 'INR')),
  opening_time = coalesce(opening_time, '09:00'::time),
  closing_time = coalesce(closing_time, '21:00'::time);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_country_code_format'
      and conrelid = 'public.clinics'::regclass
  ) then
    alter table public.clinics
      add constraint clinics_country_code_format
      check (country_code ~ '^[A-Z]{2}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_currency_code_format'
      and conrelid = 'public.clinics'::regclass
  ) then
    alter table public.clinics
      add constraint clinics_currency_code_format
      check (currency_code ~ '^[A-Z]{3}$');
  end if;
end $$;

create or replace function public.create_owner_clinic(
  clinic_name text,
  owner_name text,
  clinic_phone text default null,
  clinic_email text default null,
  clinic_address text default null,
  clinic_country_code text default 'IN',
  clinic_currency_code text default 'INR',
  clinic_opening_time time without time zone default '09:00',
  clinic_closing_time time without time zone default '21:00'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  new_clinic_id uuid;
  new_profile public.profiles;
  user_email text;
  clean_country_code text;
  clean_currency_code text;
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This user already belongs to a clinic';
  end if;

  clean_country_code := upper(coalesce(nullif(trim(clinic_country_code), ''), 'IN'));
  clean_currency_code := upper(coalesce(nullif(trim(clinic_currency_code), ''), 'INR'));

  if clean_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Invalid clinic country code';
  end if;

  if clean_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Invalid clinic currency code';
  end if;

  user_email := coalesce(auth.jwt() ->> 'email', clinic_email);

  insert into public.clinics (
    name,
    phone,
    email,
    address,
    country_code,
    currency_code,
    opening_time,
    closing_time
  )
  values (
    clinic_name,
    clinic_phone,
    coalesce(clinic_email, user_email),
    clinic_address,
    clean_country_code,
    clean_currency_code,
    coalesce(clinic_opening_time, '09:00'::time),
    coalesce(clinic_closing_time, '21:00'::time)
  )
  returning id into new_clinic_id;

  insert into public.profiles (id, clinic_id, name, email, role, active)
  values (auth.uid(), new_clinic_id, owner_name, user_email, 'owner', true)
  returning * into new_profile;

  return new_profile;
end;
$$;
