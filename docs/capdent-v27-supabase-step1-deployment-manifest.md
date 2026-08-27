# CapDent V27 — Supabase Step 1 Deployment Manifest

Status: prepared, **not deployed**

Pinned source branch: `feature/capdent-v27`
Pinned reviewed head: `e4b73abec97c2bedf9e85392ab466d6145ab4e10`
Production Supabase project: `mzjtdcpbvoximdukpukd`

This manifest exists so PhonePe sandbox deployment uses the exact reviewed files rather than an unreviewed later branch state.

## Database migration order

1. `supabase/migrations/20260826184500_capdent_v27_phonepe_invoice_payments.sql`
   - Git blob SHA: `41a5bc720ea1a4f183e1d98a800d06c841276ddd`
   - Creates `public.phonepe_payment_orders`.
   - Enables RLS and revokes `anon` / `authenticated` access.
   - Adds service-role-only `settle_phonepe_invoice_payment_v27(...)`.
   - Includes billing-schema preflight and idempotent settlement.

2. `supabase/migrations/20260827022000_capdent_v27_phonepe_environment_guard.sql`
   - Git blob SHA: `f60554250e563998db025309004d856dfebf78c7`
   - Adds non-null `environment` restricted to `sandbox` / `production`.
   - Backfills existing unclassified rows to `sandbox`.

Do not apply migration 2 before migration 1.

## Edge Function deployment order

All PhonePe functions below share:

`supabase/functions/_shared/phonepeV27.ts`

Git blob SHA: `f8129c719bafdb1e40c07ce63c0e56792495f386`

Deploy:

1. `phonepe-return`
   - Entrypoint blob SHA: `98b5383797e75285a72ea83c77366506661f2165`
   - `verify_jwt = false`
   - Public static return page only; no database access.

2. `phonepe-create-payment`
   - Entrypoint blob SHA: `b19c5ed2a1a295a7a005617ccab0f934bb3530fa`
   - `verify_jwt = true`
   - Requires authenticated active clinic profile and allowed collection role.
   - Amount comes from authoritative invoice due balance.

3. `phonepe-check-payment`
   - Entrypoint blob SHA: `082c79ebf9e924ccbea484602d9e6a1227a68eb2`
   - `verify_jwt = true`
   - Requires authenticated clinic role.
   - Rejects cross-environment orders before contacting PhonePe.

4. `phonepe-callback`
   - Entrypoint blob SHA: `56e3f48d1757a5a013f077ca92217f7fa7c6dcff`
   - `verify_jwt = false`
   - PhonePe cannot supply a Supabase JWT.
   - Function validates PhonePe callback authorization itself, then independently rechecks PhonePe order status before settlement.

## Required server-only sandbox secrets

Do not place these in the Android bundle, Expo public environment, GitHub source, or `eas.json`:

- `PHONEPE_ENV=sandbox`
- `PHONEPE_PAYMENTS_ENABLED=true`
- `PHONEPE_CLIENT_ID`
- `PHONEPE_CLIENT_SECRET`
- `PHONEPE_CLIENT_VERSION`
- `PHONEPE_CALLBACK_USERNAME`
- `PHONEPE_CALLBACK_PASSWORD`
- `PHONEPE_REDIRECT_URL=https://<PROJECT_REF>.supabase.co/functions/v1/phonepe-return`

Callback URL configured at PhonePe:

`https://<PROJECT_REF>.supabase.co/functions/v1/phonepe-callback`

## Safety boundary

Until Step 1 verification is complete:

- Keep `EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=false` in every committed EAS profile.
- Do not test against BG Reddy or any real production clinic.
- Prefer a Supabase development branch or a disposable test clinic/invoice.
- Do not mark an invoice paid from redirect or callback payload alone.
- Run Supabase security and performance advisors after the migrations.

## Post-deploy evidence required

Record before Step 1 can be marked complete:

- both migration versions applied successfully
- table and settlement RPC exist
- RLS enabled and `anon` / `authenticated` cannot read the merchant-order ledger
- all four function versions and `verify_jwt` modes
- secret names present (never record secret values)
- `PHONEPE_ENV=sandbox`
- create/check reject unauthenticated requests
- callback rejects invalid authorization
- return page is public, static, no-cache, and contains no payment/patient data
- Supabase security advisor results
- Supabase performance advisor results

Only after those checks pass should Step 2 begin.