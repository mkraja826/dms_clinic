# CapDent V27 — PhonePe Sandbox Activation Runbook

## Purpose

This runbook activates and validates PhonePe Standard Checkout without exposing merchant credentials to the Android app and without changing a real clinic invoice until sandbox reconciliation is proven.

The Android feature flag must remain **off** until all server checks below pass.

## Safety rules

- Keep `EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=false` in every normal EAS profile.
- Prefer a Supabase development branch for sandbox testing so production clinic data is absent.
- If a Supabase development branch is not available, use only a dedicated test clinic/invoice and never BG Reddy or another real production clinic.
- PhonePe merchant credentials and callback credentials are server-only Supabase secrets. Never add them to `.env`, `eas.json`, GitHub, Expo public configuration, or React Native source.
- A callback body is never payment proof. The callback function re-queries PhonePe order status before settlement.
- A successful browser redirect is never payment proof. CapDent rechecks PhonePe server-to-server.
- Do not enable production PhonePe until sandbox payment, cancellation, pending, duplicate callback, and amount-change scenarios have all been reconciled.

## 1. Database migration

Apply:

`supabase/migrations/20260826184500_capdent_v27_phonepe_invoice_payments.sql`

Expected additions:

- `public.phonepe_payment_orders`
- service-role-only access to the merchant order ledger
- `public.settle_phonepe_invoice_payment_v27(...)`
- idempotent settlement via `settled_payment_id`
- amount/invoice ownership revalidation before inserting a CapDent payment
- `REVIEW_REQUIRED` when the live invoice due amount changes after checkout starts

After applying the migration, run Supabase security/performance advisors before enabling the server feature switch.

## 2. Deploy Edge Functions

Deploy in this order:

1. `phonepe-return`
2. `phonepe-create-payment`
3. `phonepe-check-payment`
4. `phonepe-callback`

Deployment authentication modes:

| Function | `verify_jwt` | Reason |
| --- | --- | --- |
| `phonepe-create-payment` | `true` | Authenticated CapDent staff only |
| `phonepe-check-payment` | `true` | Authenticated clinic status reconciliation |
| `phonepe-callback` | `false` | PhonePe cannot send a Supabase JWT; function performs PhonePe callback authorization itself |
| `phonepe-return` | `false` | Static public return page; reads/writes no data |

The callback function must never be deployed with its custom PhonePe authorization check removed.

## 3. Configure Supabase server secrets

Set these only in the sandbox Supabase environment:

- `PHONEPE_ENV=sandbox`
- `PHONEPE_PAYMENTS_ENABLED=true`
- `PHONEPE_CLIENT_ID=<PhonePe sandbox client id>`
- `PHONEPE_CLIENT_SECRET=<PhonePe sandbox client secret>`
- `PHONEPE_CLIENT_VERSION=<PhonePe sandbox client version>`
- `PHONEPE_CALLBACK_USERNAME=<random callback username configured in PhonePe>`
- `PHONEPE_CALLBACK_PASSWORD=<strong random callback password configured in PhonePe>`
- `PHONEPE_REDIRECT_URL=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/phonepe-return`

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not duplicate those into the Android bundle.

## 4. Configure PhonePe sandbox

Use the same callback credentials as the Supabase secrets above.

Callback URL:

`https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/phonepe-callback`

Checkout redirect URL is sent by CapDent from `PHONEPE_REDIRECT_URL` and should point to `phonepe-return`.

The return page intentionally does **not** say that payment succeeded. It only sends the user back to `dms://reports/invoices`, where CapDent performs an authenticated server status check.

## 5. Preflight checks before any sandbox payment

Confirm all of the following:

- `npm run check:v27` passes.
- Normal EAS profiles still contain `EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=false`.
- `phonepe-create-payment` rejects missing/invalid JWTs.
- `phonepe-check-payment` rejects missing/invalid JWTs.
- `phonepe-callback` rejects an invalid PhonePe `Authorization` header when server payments are enabled.
- `phonepe-return` returns a static no-cache page and exposes no patient/order information.
- The PhonePe ledger is inaccessible to `anon` and `authenticated` database roles.
- No raw checkout redirect URL is stored in `last_status_payload`.
- No raw PhonePe order payload/instrument object is stored in `last_status_payload`.

## 6. Sandbox test build

Do not change a normal EAS profile to enable PhonePe.

For a controlled local/internal sandbox build only, use an environment override:

`EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=true`

The build must point to the isolated Supabase sandbox/development branch if one exists.

After testing, remove the override. Do not commit it as `true`.

## 7. Required test cases

Use a disposable test clinic and test invoice.

### A. Completed payment

1. Start checkout for an invoice with a known due amount.
2. Complete sandbox payment.
3. Return to CapDent.
4. Recheck status.
5. Confirm exactly one `payments` row with `payment_method = 'PhonePe'`.
6. Confirm invoice `paid_amount`, `due_amount`, and `status` match the verified payment.
7. Recheck the same merchant order again and confirm settlement is idempotent and no second payment row is inserted.

### B. Cancelled/failed checkout

- Cancel or fail the sandbox checkout.
- Confirm no CapDent payment row is created.
- Confirm invoice balance is unchanged.

### C. Pending payment

- Leave the payment pending if the sandbox supports it.
- Confirm CapDent reports the PhonePe state but does not mark the invoice paid.

### D. Invoice changed during checkout

1. Start PhonePe checkout.
2. Change the test invoice balance through the normal CapDent payment workflow before completing PhonePe.
3. Complete PhonePe checkout.
4. Confirm the merchant order becomes `REVIEW_REQUIRED` and CapDent does not auto-settle the now-stale amount.

### E. Duplicate callback/recheck

- Replay/retrigger status reconciliation for the same completed order.
- Confirm the existing `settled_payment_id` is returned and no duplicate payment row is created.

### F. Amount mismatch

- Where the PhonePe sandbox permits controlled mismatch simulation, confirm `AMOUNT_MISMATCH` does not settle.
- If the sandbox cannot simulate it, retain this as a code/DB validation test and do not weaken the guard.

## 8. Evidence required before enabling any app profile

Record:

- Supabase migration version applied
- Edge Function versions deployed
- `verify_jwt` setting for each function
- sandbox secret presence (names only, never values)
- PhonePe sandbox merchant/callback configuration completed
- completed-payment merchant order reference
- idempotent recheck evidence
- cancelled/failed evidence
- changed-invoice `REVIEW_REQUIRED` evidence
- latest successful `CapDent V27 feature check` run

Only after all evidence is green may a dedicated internal-testing profile be considered for `EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=true`.

Production and Play release profiles remain off until a separate production merchant activation review.
