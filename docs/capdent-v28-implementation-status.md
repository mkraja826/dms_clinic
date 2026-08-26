# CapDent V28 — Implementation Status

This is the working completion ledger for `feature/capdent-v28`. A checked item means the code path exists on the feature branch. It does **not** mean Production has been changed, a real clinic has been onboarded, or a real patient payment has been tested.

## Branch baseline and safety

- [x] Latest green V27 baseline reconciled into V28 through merge commit `6478e54fd7d719e591e921e55279a3aeeca93322`.
- [x] V28 is now ahead of the current V27 head and no longer behind it.
- [x] Pre-reconciliation V28 state preserved at `backup/capdent-v28-pre-reconcile-20260826`.
- [x] V27 analytics, notification-health, Google Play recovery, quota UX, and version-aware payment-push routing retained.
- [x] V28 billing/provider work retained during reconciliation.
- [ ] No V28 migration or patient-payment Edge Function has been approved for Production deployment yet.
- [ ] No real PhonePe clinic merchant account or patient transaction has been used for V28 validation yet.

## Core CapDent behavior retained

- [x] Owner/head-doctor, doctor, and reception role dashboards.
- [x] Patient registration, directory, visit, treatment, tooth-chart, appointments, check-in, reminders, and follow-up workflows.
- [x] Existing payment ledger, invoice rows, fee collection RPCs, and owner payment reports remain available.
- [x] Free-tier server policy remains 100 patients, 150 uploads, warning at 120 uploads, and 1 GiB storage.
- [x] Google Play paid-plan activation remains server verified.
- [x] Firebase Analytics allow-list/privacy rules from V27 retained.
- [x] Android remains AI-free; AI stays portal-only.

## V28 invoice foundation

- [x] Additive `consolidated_bills` and `consolidated_bill_items` model committed on the feature branch.
- [x] Server-authoritative per-clinic/year invoice numbering (`CD-YYYY-000001`).
- [x] Reception explicitly selects source invoice rows; historical charges are not silently consumed.
- [x] `finalize_v28_consolidated_bill()` validates clinic, role, patient, selected invoices, and duplicate/race conditions.
- [x] Same-patient finalization serialized with advisory locking.
- [x] Finalized bill header and line-item values are frozen snapshots.
- [x] Finalization does not delete or rewrite legacy invoice/payment history.
- [x] Reception **Review Final Invoice** screen exists.
- [x] Reception **Finalized Invoices** list and finalized invoice viewer exist.
- [ ] Define safe correction/version semantics; a finalized snapshot must never be silently edited in place.
- [ ] Complete native PDF/file generation and print/share QA for the finalized snapshot.

## WhatsApp invoice / receipt delivery

- [x] Manual receptionist **Send Invoice on WhatsApp** action exists.
- [x] Opening or reviewing an invoice never sends a patient message automatically.
- [x] Finalized-invoice WhatsApp summary uses the frozen patient-facing bill snapshot.
- [x] Secure invoice-share token foundation exists with SHA-256 token hashes, expiry, revocation, clinic/role checks, and no direct Android access to token rows.
- [ ] Public patient invoice token resolver/viewer is still required before secure external invoice URLs can be enabled.
- [ ] PDF attachment sharing through Android/WhatsApp requires physical-device QA.
- [ ] Automated WhatsApp Business API delivery is not part of the first V28 release gate; manual share remains the safe initial path.

## Clinic payment receiving accounts

- [x] Additive `clinic_payment_accounts` table exists on the feature branch.
- [x] Table stores provider metadata only; Android users cannot directly insert/update/delete provider account rows.
- [x] Server-safe account-status RPC derives clinic context from the authenticated profile.
- [x] Country routing is explicit: configured `IN` → PhonePe; other configured supported countries → card provider.
- [x] Missing/invalid country disables online routing rather than inferring country from phone, IP, SIM, device locale, or user identity.
- [x] Owner **Patient Payments** settings screen exists.
- [x] India/PhonePe checkout path is implemented server-side.
- [x] Non-India card connected-account path is implemented server-side.
- [x] Provider credentials and webhook secrets are referenced only from server-side environment/secret storage, not `EXPO_PUBLIC_*` Android configuration.
- [ ] Real merchant onboarding contract and production credential lifecycle must be approved before enabling a clinic.

## Patient online payment requests

- [x] Additive `patient_payment_requests` foundation exists.
- [x] Requests are tied to a finalized invoice.
- [x] Online requests are created for the verified remaining invoice balance rather than an arbitrary client-entered total.
- [x] Only one live online request per finalized bill is allowed.
- [x] Checkout URL attachment is service-role controlled.
- [x] Raw provider webhook payloads and provider credentials are not stored in patient-readable tables.
- [x] Patient payment provider events store safe/digested metadata.
- [x] Patient Pay Now remains intentionally absent from the finalized-invoice UI while provider release gates are incomplete.

## Verified payment reconciliation

- [x] Additive `patient_payment_reconciliation_entries` exists.
- [x] Reconciliation RPC is service-role controlled.
- [x] Provider-verified money is written into the existing CapDent `payments` ledger rather than a parallel accounting ledger.
- [x] Existing invoice financial recalculation is reused after payment insertion.
- [x] Duplicate provider events/payment application are protected by idempotency/uniqueness checks.
- [x] If invoice balance changes after checkout, the request goes to reconciliation review instead of over-crediting the invoice.
- [x] Original payment category/source invoice context is retained where applicable.
- [ ] Physical-device and database integration tests are still required for full, partial, failed, duplicate, retried, and balance-changed cases.

## PhonePe status — hardened on branch, sandbox still required

- [x] PhonePe patient collection uses current Standard Checkout v2 (`/checkout/v2/pay`) rather than mixing the Paylinks product with checkout verification.
- [x] PhonePe secrets are server-side (`PHONEPE_PARTNER_CLIENT_ID`, secret, client version, environment).
- [x] INR is converted to paise server-side.
- [x] Standard Checkout uses a server-configured HTTPS redirect URL.
- [x] CapDent stores the merchant order ID as the generic provider request reference because PhonePe order status is keyed by merchant order ID.
- [x] Patient phone/contact data is no longer sent by the V28 PhonePe checkout adapter.
- [x] PhonePe webhook endpoint uses Standard Checkout order callback types.
- [x] Callback authorization is validated server-side with constant-time comparison using PhonePe's SHA-256 username/password scheme.
- [x] Raw callback body is hashed instead of being persisted as patient-readable payload.
- [x] Every terminal callback independently authenticates to PhonePe and calls `/checkout/v2/order/{merchantOrderId}/status` before money can move.
- [x] Verified merchant order, clinic merchant, exact amount in paise, and terminal provider state are bound before a provider event can be treated as successful.
- [x] Only independently verified `COMPLETED` status may enter the CapDent reconciliation path; `PENDING`/unknown status cannot credit the ledger.
- [x] Failed/expired provider states never call the payment reconciliation RPC.
- [x] V28 patient-payment validator enforces Standard Checkout, bans Paylink mixing, and requires status verification before reconciliation.
- [x] V28 CI run `32996227660` passed feature invariants, patient-payment security validation, TypeScript, diff formatting, and Expo public configuration for this hardening batch.
- [ ] Match the final checkout/status/callback headers and end-merchant semantics to the exact PhonePe PG Partner contract issued for CapDent clinics before production enablement.
- [ ] Sandbox test: successful full payment.
- [ ] Sandbox test: partial-balance request where allowed by CapDent invoice state.
- [ ] Sandbox test: failed/cancelled payment.
- [ ] Sandbox test: duplicate callback/replay.
- [ ] Sandbox test: authenticated callback says success but PhonePe status lookup is non-success — must not credit invoice.
- [ ] Production PhonePe remains disabled until all above external/provider gates pass.

## Card provider status

- [x] Connected-account onboarding/sync functions exist for the card-provider path.
- [x] Card checkout routes settlement through the clinic-connected account rather than CapDent's operating account.
- [x] Card webhook path exists and feeds the same verified reconciliation model.
- [ ] Provider onboarding/commercial/account requirements need real sandbox/connected-account QA before release.

## Payment settlement rule

- [x] Architecture is clinic-direct settlement: patient money belongs to and settles to the clinic's connected merchant account.
- [x] CapDent orchestrates checkout, verification, invoice reconciliation, receipt state, and reporting.
- [x] CapDent does not intentionally collect patient funds into its own operating account for redistribution.

## Push / notification reliability retained from V27

- [x] Current install identity helper retained for notification diagnostics.
- [x] V28 read-only payment-push health snapshot retained.
- [x] Owner Notification Health screen retained.
- [x] Registration repair and token-rotation registration path retained.
- [x] Android canonical `payments_coin_drop_v1` channel retained.
- [x] Server dispatch keeps legacy `payments` channel compatibility for older registrations and newer channel routing for supported app versions.
- [ ] Physical-device notification regression still required before V28 release.

## Analytics/privacy retained from V27

- [x] Firebase Analytics is enabled only for release/internal release profiles as defined by current release configuration; development/preview remain off.
- [x] Analytics event allow-list/sanitizer retained.
- [x] No patient name, phone, diagnosis, purchase token, order ID, or clinical free text is accepted by the V27 analytics schema.
- [x] Advertising storage/user-data/personalization consent remains disabled.
- [ ] Re-audit any new V28 payment/invoice analytics before adding events; provider transaction IDs and patient identifiers must not be sent to Firebase.

## Backend/deployment gates

- [ ] Review every V28 migration against the live Production schema before applying it anywhere.
- [ ] Prefer staging/non-production application first where available.
- [ ] Verify RLS for owner/head doctor, doctor, reception, and cross-clinic denial.
- [ ] Verify privileged RPCs derive authoritative clinic membership server-side.
- [ ] Do not destructive-test a real production clinic.
- [ ] Do not deploy PhonePe/card patient-payment functions to Production until provider-contract confirmation, idempotency, and sandbox tests are green.
- [ ] Keep patient Pay Now hidden until the backend release gates are explicitly approved.

## Release QA still required

- [x] Current V28 feature validator + patient-payment validator + TypeScript are green after baseline reconciliation and PhonePe status hardening.
- [ ] Expo Doctor on the final synced V28 branch.
- [ ] Patient registration smoke test.
- [ ] Visit/treatment/tooth-chart regression.
- [ ] Appointment/check-in/reminder regression.
- [ ] Finalized invoice full/partial/due scenarios.
- [ ] PDF/native share/WhatsApp physical-device test.
- [ ] PhonePe sandbox checkout → callback → status recheck → reconciliation → receipt test.
- [ ] Duplicate webhook/replay test.
- [ ] Failed/pending payment must never mark invoice paid.
- [ ] Owner Clinic Health and Patient Payments smoke tests.
- [ ] Google Play purchase/recovery regression.
- [ ] Payment push regression.
- [ ] Play Internal AAB installed and tested before any Production promotion.
- [ ] Cut final Expo/package `1.2.8` and Android release code only at release cut; do not change identity during feature development.

## Deliberately excluded from Android V28

- AI chat / LLM assistant.
- AI X-ray diagnosis.
- Raw database AI access.

Those capabilities remain portal-only at `capdent.in/portal`.
