-- Keep the existing Google Play subscription function aligned with the
-- CapDent Intelligence price configured in Play Console.
--
-- Safe to run repeatedly:
--   * no clinic access is changed
--   * no subscription is activated
--   * only the obsolete INR 1,500 value is corrected to INR 1,499

begin;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.record_google_play_subscription_purchase(text,text,text,boolean,jsonb)'::regprocedure
  )
  into function_definition;

  if position('resolved_monthly_price := 1500;' in function_definition) > 0 then
    execute replace(
      function_definition,
      'resolved_monthly_price := 1500;',
      'resolved_monthly_price := 1499;'
    );
  elsif position('resolved_monthly_price := 1499;' in function_definition) = 0 then
    raise exception 'Could not locate the Intelligence price assignment in record_google_play_subscription_purchase';
  end if;
end;
$$;

update public.clinic_subscriptions
set
  monthly_price = 1499,
  updated_at = now()
where google_play_product_id = 'midms_clinic_intelligence_monthly'
  and monthly_price = 1500;

commit;
