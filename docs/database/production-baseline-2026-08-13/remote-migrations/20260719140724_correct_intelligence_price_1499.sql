begin;

create or replace function public.record_google_play_subscription_purchase(
  p_product_id text,
  p_purchase_token text,
  p_order_id text default null,
  p_auto_renewing boolean default true,
  p_raw_purchase jsonb default '{}'::jsonb
)
returns public.clinic_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  updated_subscription public.clinic_subscriptions;
  normalized_product_id text := trim(coalesce(p_product_id, ''));
  normalized_order_id text := nullif(trim(coalesce(p_order_id, '')), '');
  resolved_plan_name text;
  resolved_monthly_price numeric;
  paid_period_end timestamptz := now() + interval '1 month';
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if normalized_product_id = '' then
    raise exception 'Google Play product id is required';
  end if;

  if nullif(trim(coalesce(p_purchase_token, '')), '') is null then
    raise exception 'Google Play purchase token is required';
  end if;

  if normalized_product_id = 'midms_monthly_799' then
    resolved_plan_name := 'professional';
    resolved_monthly_price := 799;
  elsif normalized_product_id = 'midms_clinic_intelligence_monthly' then
    resolved_plan_name := 'clinic_intelligence';
    resolved_monthly_price := 1499;
  else
    raise exception 'Unsupported CapDent Google Play product: %', normalized_product_id;
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid()
    and active = true;

  if actor.id is null or actor.clinic_id is null then
    raise exception 'Active clinic profile not found';
  end if;

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
    google_play_product_id,
    google_play_purchase_token,
    google_play_order_id,
    google_play_auto_renewing,
    google_play_status,
    google_play_linked_at,
    google_play_last_event_at
  )
  values (
    actor.clinic_id,
    resolved_plan_name,
    'active',
    null,
    null,
    now(),
    paid_period_end,
    resolved_monthly_price,
    null,
    'google_play',
    normalized_product_id,
    trim(p_purchase_token),
    normalized_order_id,
    coalesce(p_auto_renewing, true),
    'active',
    now(),
    now()
  )
  on conflict (clinic_id) do update
  set
    plan_name = resolved_plan_name,
    status = 'active',
    trial_started_at = null,
    trial_ends_at = null,
    current_period_start = now(),
    current_period_end = paid_period_end,
    monthly_price = resolved_monthly_price,
    visit_limit = null,
    billing_provider = 'google_play',
    google_play_product_id = normalized_product_id,
    google_play_purchase_token = trim(p_purchase_token),
    google_play_order_id = normalized_order_id,
    google_play_auto_renewing = coalesce(p_auto_renewing, true),
    google_play_status = 'active',
    google_play_linked_at = coalesce(public.clinic_subscriptions.google_play_linked_at, now()),
    google_play_last_event_at = now()
  returning * into updated_subscription;

  insert into public.google_play_subscription_events (
    clinic_id,
    subscription_id,
    profile_id,
    event_type,
    product_id,
    purchase_token,
    order_id,
    auto_renewing,
    raw_purchase
  )
  values (
    actor.clinic_id,
    updated_subscription.id,
    actor.id,
    'client_purchase',
    normalized_product_id,
    trim(p_purchase_token),
    normalized_order_id,
    coalesce(p_auto_renewing, true),
    coalesce(p_raw_purchase, '{}'::jsonb)
  );

  return updated_subscription;
end;
$$;

update public.clinic_subscriptions
set monthly_price = 1499,
    updated_at = now()
where google_play_product_id = 'midms_clinic_intelligence_monthly'
  and monthly_price = 1500;

commit;
