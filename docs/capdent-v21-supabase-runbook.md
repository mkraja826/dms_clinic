# CapDent v21 Supabase Production Runbook

Project: `mzjtdcpbvoximdukpukd` (`MDMS`, Tokyo)

Status on 2026-07-27: all four additive v21 migrations and three supporting
Edge Functions are active in production. The retired R2 upload function has
been removed together with its obsolete Edge secrets.

## Applied components

1. `capdent_v21_payment_notifications`
   - clinic opt-in defaults false;
   - owner/head-doctor per-install Expo tokens;
   - idempotent payment outbox and per-device delivery audit;
   - RLS, least-privilege grants, and exception-safe payment enqueue.
2. `capdent_v21_dental_chart_atomic_visit`
   - clinic opt-in defaults false;
   - append-only FDI chart history;
   - clinical-role read policy;
   - atomic charted-visit RPC.
3. `capdent_v21_payment_notification_dispatch`
   - post-commit `pg_net` Edge invocation;
   - five-minute retry/receipt maintenance;
   - Vault-held shared secret;
   - missing foreign-key indexes identified by the production advisor.
4. `capdent_v21_google_play_subscription_sync`
   - hourly server-side Google Play lifecycle verification;
   - renewal, cancellation, grace, hold, and expiry reconciliation;
   - Vault-held custom authentication.

## Edge Functions

- `verify-google-play-subscription`
  - requires an authenticated owner/head-doctor session;
  - verifies through Android Publisher `subscriptionsv2`;
  - grants paid access only for entitled states;
  - acknowledges eligible purchases server-side;
  - prevents reuse of a purchase token across clinics.
- `sync-google-play-subscriptions`
  - accepts only the Vault-matched scheduler secret;
  - refreshes at most 100 oldest linked subscriptions per run;
  - never downgrades on transient Google API errors;
  - records sanitized lifecycle events;
  - has an authenticated production-access probe that does not require a real
    purchase token.
- `send-payment-notification`
  - accepts only the Vault-matched dispatcher secret;
  - remains server-disabled until FCM and signed-device tests pass;
  - excludes the payment collector;
  - records Expo tickets/receipts, retries transient errors, and retires invalid
    tokens.

## Current kill switches

- `PAYMENT_PUSH_ENABLED=false`
- all `clinics.payment_push_enabled=false`
- all `clinics.tooth_chart_enabled=false`
- `GOOGLE_PLAY_SYNC_ENABLED=true`

No production clinic was enabled during schema or backend deployment.

The Google Cloud `capdent` project has
`androidpublisher.googleapis.com` enabled. Supabase uses the dedicated
`capdent-play-billing@capdent.iam.gserviceaccount.com` identity. The production
health probe returned HTTP 200 with `authorized: true`, and the zero-row
lifecycle maintenance run returned HTTP 200 with no errors.

## Verification

Local:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-capdent-v21-supabase.ps1
```

Expected: schema lint clean and 60 pgTAP assertions passing.

Hosted verification must confirm:

- both cron jobs are active;
- dispatcher functions are not executable by `anon` or `authenticated`;
- all new tables have RLS;
- payment push clinic count is zero before FCM approval;
- Edge smoke responses are HTTP 200;
- no service-role or custom webhook secret appears in app configuration.

## Activation order for payment push

1. Restore access to the existing EAS project.
2. Upload the validated `mi-dms` Firebase Android file as the production EAS
   secret file `GOOGLE_SERVICES_JSON`.
3. Upload the validated Firebase Admin SDK key as the FCM v1 service
   credential.
4. Produce a signed internal version-code 21 build with the app flag enabled.
5. Register an eligible Pavani Dental Clinic owner/head-doctor device.
6. Send synthetic payments and complete the delivery/retry/logout test matrix.
7. Set `PAYMENT_PUSH_ENABLED=true`.
8. Enable only the verified Pavani clinic UUID.
9. Observe jobs, deliveries, receipts, Edge logs, and payment success.
10. Expand clinic flags in reviewed batches; do not match clinics by display
   name.

If any stage fails, turn off the server flag first. Payment records are
independent from notification delivery.
