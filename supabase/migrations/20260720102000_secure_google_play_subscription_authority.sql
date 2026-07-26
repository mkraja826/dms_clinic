-- Make Google Play subscription state server-authoritative.
--
-- Safety guarantees:
--   * no clinic plan is changed by this migration
--   * no checkout is enabled
--   * authenticated clients retain read-only access to their clinic subscription
--   * only trusted server code can write subscription state or Play audit events

begin;

-- The legacy client RPC must never grant paid access directly.
revoke all on function public.record_google_play_subscription_purchase(text,text,text,boolean,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_google_play_subscription_purchase(text,text,text,boolean,jsonb)
  to service_role;

-- Clients may read their clinic subscription, but only trusted server code may write it.
revoke all on table public.clinic_subscriptions from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.clinic_subscriptions from authenticated;
grant select on table public.clinic_subscriptions to authenticated;

-- Google Play verification events are server-owned audit records.
revoke all on table public.google_play_subscription_events from anon, authenticated;

-- Remove broad write policies inherited from the original isolation hardening.
drop policy if exists dms_clinic_isolation_clinic_subscriptions
  on public.clinic_subscriptions;
drop policy if exists "owners manage subscription"
  on public.clinic_subscriptions;
drop policy if exists "clinic members read subscription"
  on public.clinic_subscriptions;

create policy clinic_members_read_subscription
on public.clinic_subscriptions
for select
to authenticated
using (clinic_id = public.current_clinic_id());

drop policy if exists dms_clinic_isolation_google_play_subscription_events
  on public.google_play_subscription_events;

-- A Google purchase token can belong to only one clinic.
create unique index if not exists clinic_subscriptions_google_play_token_unique
on public.clinic_subscriptions (google_play_purchase_token)
where google_play_purchase_token is not null
  and btrim(google_play_purchase_token) <> '';

comment on function public.record_google_play_subscription_purchase(text,text,text,boolean,jsonb) is
  'Legacy server-only compatibility function. Mobile clients cannot execute it; paid access must follow Google Play server verification.';

commit;
