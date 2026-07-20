-- Keep one clinic-creation RPC so PostgREST can resolve both legacy and current clients.
-- Older Android builds may send the first five fields only; the remaining fields use defaults.
-- Current web/mobile builds send all nine fields.

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

  if nullif(trim(clinic_name), '') is null then
    raise exception 'Clinic name is required';
  end if;

  if nullif(trim(owner_name), '') is null then
    raise exception 'Owner name is required';
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

  user_email := coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    nullif(trim(clinic_email), '')
  );

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
    trim(clinic_name),
    nullif(trim(clinic_phone), ''),
    coalesce(nullif(trim(clinic_email), ''), user_email),
    nullif(trim(clinic_address), ''),
    clean_country_code,
    clean_currency_code,
    coalesce(clinic_opening_time, '09:00'::time),
    coalesce(clinic_closing_time, '21:00'::time)
  )
  returning id into new_clinic_id;

  insert into public.clinic_subscriptions (
    clinic_id,
    plan_name,
    status,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end,
    monthly_price,
    visit_limit,
    billing_provider,
    google_play_status,
    google_play_auto_renewing
  )
  values (
    new_clinic_id,
    'free',
    'free',
    null,
    null,
    null,
    null,
    0,
    null,
    'manual',
    'not_started',
    false
  )
  on conflict (clinic_id) do nothing;

  insert into public.profiles (id, clinic_id, name, email, role, active)
  values (
    auth.uid(),
    new_clinic_id,
    trim(owner_name),
    user_email,
    'owner',
    true
  )
  returning * into new_profile;

  return new_profile;
end;
$$;

-- The former five-argument overload conflicts with the nine-argument function
-- because the latter has defaults. Removing it makes PostgREST resolution deterministic.
drop function if exists public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text
);

revoke all on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  time without time zone,
  time without time zone
) from public, anon;

grant execute on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  time without time zone,
  time without time zone
) to authenticated, service_role;

comment on function public.create_owner_clinic(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  time without time zone,
  time without time zone
) is
  'Creates a clinic, free subscription, and owner profile. Supports legacy five-field and current nine-field clients through defaults.';
