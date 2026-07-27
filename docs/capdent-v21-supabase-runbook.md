# CapDent v21 Supabase Production Runbook

Project: `mzjtdcpbvoximdukpukd` (`MDMS`, Tokyo)

Status on 2026-07-27: all v21 backend components and the v22 production-wide
activation are active. The retired R2 upload function has been removed
together with its obsolete Edge secrets.

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
  - is server-enabled with EAS FCM v1 credentials configured;
  - excludes the payment collector;
  - records Expo tickets/receipts, retries transient errors, and retires invalid
    tokens.

## Current kill switches

- `PAYMENT_PUSH_ENABLED=true`
- all `clinics.payment_push_enabled=true`
- all `clinics.tooth_chart_enabled=true`
- `GOOGLE_PLAY_SYNC_ENABLED=true`

Both clinic feature columns now default to `true` for future clinics.

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
- payment push and tooth chart enabled counts match the total clinic count;
- Edge smoke responses are HTTP 200;
- no service-role or custom webhook secret appears in app configuration.

## v22 activation

1. EAS access restored for the existing project.
2. `GOOGLE_SERVICES_JSON` uploaded as a production secret file.
3. Matching `mi-dms` FCM v1 service credential attached to `com.dms.clinic`.
4. Version `1.2.2`, code `22`, enables billing, push, and charting in release
   profiles.
5. `PAYMENT_PUSH_ENABLED=true`.
6. All existing clinics enabled; future clinic defaults set to enabled.
7. Signed-device delivery and licensed Google Play transaction tests remain
   release verification steps.

If any stage fails, turn off the server flag first. Payment records are
independent from notification delivery.
