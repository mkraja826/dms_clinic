-- CapDent V28 compatibility backfill for the multiple receiving-account rollout.
--
-- Before 20260827190000, clinic_payment_accounts enforced one row per
-- (clinic_id, provider). That migration introduced is_default=false, while the
-- payment status and checkout RPCs immediately started requiring is_default=true.
-- Without this backfill, an already configured clinic can appear disconnected
-- after upgrading to V28.

begin;

with ranked_accounts as (
  select
    a.id,
    row_number() over (
      partition by a.clinic_id, a.provider
      order by
        case
          when a.status = 'connected'
            and coalesce(a.payments_enabled, false) = true
            and coalesce(a.settlements_enabled, false) = true then 0
          when a.status = 'connected' then 1
          else 2
        end,
        a.connected_at asc nulls last,
        a.created_at asc,
        a.id asc
    ) as account_rank
  from public.clinic_payment_accounts a
  where not exists (
    select 1
    from public.clinic_payment_accounts existing_default
    where existing_default.clinic_id = a.clinic_id
      and existing_default.provider = a.provider
      and existing_default.is_default = true
  )
)
update public.clinic_payment_accounts target
set is_default = true
from ranked_accounts ranked
where target.id = ranked.id
  and ranked.account_rank = 1;

commit;
