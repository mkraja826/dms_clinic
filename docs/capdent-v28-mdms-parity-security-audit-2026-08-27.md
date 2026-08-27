# CapDent V28 — MDMS Parity and Cross-Clinic Security Audit

Date: 2026-08-27
Branch: `feature/capdent-v28`
Production Supabase: MDMS (`mzjtdcpbvoximdukpukd`)

## Result

PASS for the remotely verifiable database/security scope covered below.

## Migration parity

MDMS migration history contains the complete V28 payment sequence through:

- consolidated billing foundation
- clinic payment accounts
- invoice share tokens
- patient payment requests
- provider-event RPC restrictions/fixes
- verified payment reconciliation
- reconciliation ACL hardening
- multiple payment accounts
- receiving-account/category audit
- PhonePe account verification lifecycle
- verifier ACL hardening
- owner reconciliation review
- owner safe reconciliation resolution
- counter QR payments
- counter reconciler ACL hardening
- reconciliation dispatcher
- counter QR lifecycle hardening
- counter QR cancellation

The latest applied V28 migration is `capdent_v28_cancel_counter_qr` (`20260827143521`).

## RLS posture

RLS is enabled on the core tables checked during this audit, including:

- `profiles`
- `patients`
- `appointments`
- `treatments`
- `payments`
- `invoices`
- `clinic_payment_accounts`
- `patient_payment_requests`

Core clinical/financial policies bind authenticated access to the current user's clinic through `current_user_clinic_id()` or an equivalent active-profile clinic check.

`clinic_payment_accounts` intentionally has no direct authenticated RLS policy and is directly privileged only to `service_role`; owner/head-doctor management is expected to use the controlled server function rather than direct table reads/writes.

`patient_payment_requests` grants authenticated users SELECT only, with policy filtering to an active profile in the same clinic. Mutation remains server-controlled.

## Sensitive RPC grants

Verified payment reconciliation functions checked during this audit remain executable by `service_role`/Postgres and not by normal authenticated users. The counter-payment cancellation function is intentionally executable by authenticated users because it only retires an eligible request and does not mark money paid or reconcile funds.

## Cross-clinic negative test

A live transactional negative test was executed against MDMS using an authenticated user context from one clinic and a different clinic as the target. No persistent data was modified; the transaction was rolled back.

Observed rows visible from the other clinic:

- patients: 0
- appointments: 0
- invoices: 0
- payments: 0
- treatments: 0

Result: PASS — the tested authenticated session could not read cross-clinic clinical or financial rows.

## Notes

The legacy table-level grants on some RLS-protected tables are broader than the effective row access, but the tested RLS policies prevented cross-clinic visibility. This audit therefore treats RLS as the active security boundary for those tables.

This is not a substitute for the final physical-device role matrix. The release candidate must still test owner/head-doctor/doctor/reception behavior from real authenticated app sessions, including forbidden UI/actions and cross-clinic negative cases.

## Release impact

The GitHub ↔ MDMS migration/security parity item can be marked PASS for the V28 payment/database scope verified here. Remaining release blockers are physical-device regression, Play subscription/push/invoice-share QA, final release signing/build checks, and PhonePe provider E2E certification if PhonePe ships enabled in V28.
