# CapDent v21 Rollback Plan

The preferred rollback is feature deactivation, not destructive database
rollback. Both migrations are additive and retain audit/history rows.

## Before any hosted rollout

No action is needed. The committed global flags are false, clinic columns do
not exist until approval, and the Edge Function is not deployed.

## Payment notification rollback

Apply in this order:

1. Set `PAYMENT_PUSH_ENABLED=false`.
2. Set `payment_push_enabled=false` for only the affected approved test clinic,
   identified by UUID.
3. Unschedule `capdent-payment-notification-maintenance` if repeated invocation
   is contributing to the incident. The post-commit trigger may remain because
   the server kill switch returns without delivery.
4. Leave queued jobs, delivery audit rows, and device tokens in place for
   investigation. Do not delete them during an incident.
5. If needed, deactivate affected device-token rows with a reviewed,
   clinic-scoped statement.
6. Roll the internal app build back to both global flags false.

## Google Play billing rollback

1. Ship the next valid version code with
   `EXPO_PUBLIC_ENABLE_PAID_PLANS=false` to stop new checkout.
2. Keep `sync-google-play-subscriptions` enabled so existing customers retain
   accurate renewal, cancellation, grace, hold, and expiry state.
3. If Google API reconciliation itself is faulty, set
   `GOOGLE_PLAY_SYNC_ENABLED=false` and preserve the last verified entitlement
   state for investigation.
4. Never revoke an active paid entitlement solely because Google returned a
   transient API or network error.

Payment inserts continue independently because the database trigger performs
only local outbox work and catches notification-side enqueue exceptions.

## Dental chart rollback

1. Set `tooth_chart_enabled=false` for only the affected approved test clinic.
2. Ship an Internal Testing build with
   `EXPO_PUBLIC_ENABLE_TOOTH_CHART=false`.
3. The existing Add Visit path becomes the active fallback again.
4. Preserve `dental_chart_entries`; do not update, delete, or rewrite clinical
   history.
5. Investigate failed atomic calls using server logs and synthetic test data,
   not by editing patient history.

## App artifact rollback

Android cannot install a lower version code over a higher one. Never republish
or modify the protected version-code 20 artifact. If version-code 21 has only
reached Internal Testing, remove it from the tester rollout or publish a new
reviewed version code based on the stable logic. If a later rollout requires a
store replacement, use a new version code (22 or greater) and keep the same
approved package and signing certificate.

## Database objects

Do not drop the new columns, tables, triggers, or RPC during an incident unless
a separately reviewed destructive migration and data-retention decision are
approved. Disabled additive objects are safer than an emergency schema
reversal that could remove audit evidence or block older app versions.

## Verification after rollback

- Create a synthetic payment and confirm it saves with no push attempt.
- Save an uncharted visit and confirm the legacy Add Visit flow works.
- Confirm both clinic flags are false for the test clinic.
- Confirm the server payment flag is false.
- Confirm no real clinic was enabled.
- Confirm chart and notification audit rows remain intact.
