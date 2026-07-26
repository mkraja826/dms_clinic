# CapDent v21 Supabase Preparation Runbook

Status: source prepared only. No hosted migration, function deployment, secret,
webhook, cron job, or clinic flag change has been performed.

## Additive migration contents

`20260726204205_capdent_v21_payment_notifications.sql` adds:

- clinic opt-in defaulting false;
- owner/head-doctor per-install Expo token records;
- a unique payment outbox job;
- idempotent per-token delivery/ticket/receipt audit;
- explicit RLS and Data API grants;
- an exception-safe payment trigger that performs no HTTP.

`20260726205851_capdent_v21_dental_chart_atomic_visit.sql` adds:

- clinic opt-in defaulting false;
- append-only, FDI-constrained chart history;
- clinical-role-only read access;
- an atomic `save_visit_with_tooth_chart` RPC for visit, multiple treatments,
  invoices/payments, chart entries, queue completion, and follow-up;
- explicit treatment statuses that are never derived from follow-up presence.

## Edge Function environment

The hosted runtime provides `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The operator must add:

- `PAYMENT_NOTIFICATION_WEBHOOK_SECRET`: a long random secret stored outside
  source control;
- `PAYMENT_PUSH_ENABLED=false` initially.

The function rejects missing/wrong secrets, validates the job/payment/clinic,
selects only active owner/head-doctor recipients, excludes the collector,
supports multiple devices, records Expo tickets, retries transient failures,
checks receipts during maintenance, and deactivates
`DeviceNotRegistered` tokens. The lock-screen body contains amount and clinic
name only; it does not contain patient identity or clinical details.

## Webhook contract

- Table: `public.payment_notification_jobs`
- Event: `INSERT`
- Method: `POST`
- Header: `x-capdent-webhook-secret: <protected value>`
- Body: Supabase Database Webhook payload
- Function config: `verify_jwt=false` because authentication is performed with
  the separate constant-time-checked webhook secret

Manual maintenance requests use:

```json
{"mode":"maintenance"}
```

Receipt-only requests use:

```json
{"mode":"receipts"}
```

## Rollout order

1. Disposable local database.
2. Supabase preview branch or approved staging.
3. Edge Function deployed with server flag false.
4. Webhook and maintenance schedule configured but clinic flags false.
5. Expo development/release build with approved FCM credentials.
6. Internal Testing with one global feature flag at a time.
7. Exact test-clinic UUID verification.
8. Pavani Dental Clinic opt-in only.
9. Security, retry, offline, permission-denied, and atomic-failure tests.
10. Disable again and request production rollout approval.

At no point should a clinic be enabled by name matching, and the service-role
key must never enter Expo environment variables or mobile source.
