# CapDent V28 — Implementation Status

This file is the working completion ledger for `feature/capdent-v28`. A checked item means the code path exists and is integrated on the feature branch; it does **not** mean Production has been changed.

## Completed / already present and retained

- [x] Core role dashboards for owner/head doctor, doctor, and reception.
- [x] Patient registration/directory and patient history flows.
- [x] Visit workflow and immediate mutation locks on critical writes where already implemented.
- [x] Ongoing treatments and treatment reporting.
- [x] Tooth-chart module and existing tooth-chart tests/history behavior.
- [x] Appointments, check-in, reminders, follow-ups.
- [x] Payment entry/review and owner payment reports.
- [x] Invoice document/snapshot utilities already present in the codebase.
- [x] WhatsApp handover utility already present in the codebase.
- [x] Image compression before supported clinical uploads.
- [x] Signed-storage URL support behind the existing release flag.
- [x] V25 server-authoritative quota/consent migration exists and is additive/default-off.
- [x] Free-tier policy constants: 100 patients / 150 uploads / warning at 120 / 1 GB.
- [x] Google Play purchase path uses server verification before paid activation.
- [x] Firebase Analytics wrapper is allow-listed and designed to avoid PHI.
- [x] In-app guide, legal/account, privacy/terms, report-issue/feedback screens exist.
- [x] Owner reports: clinic, activity, export, follow-ups, payments, treatments, staff performance, owner review.

## Implemented specifically on V28 branch

- [x] Feature-complete V28 scope document and release gates.
- [x] Owner **Clinic Health** screen.
- [x] Server entitlement usage meters for patients, uploads, and storage.
- [x] Grandfathering/status visibility in Clinic Health.
- [x] Read-only payment push health check that does not prompt or mutate tokens.
- [x] Explicit owner repair/register action for payment push.
- [x] Guide and feedback/support surfaced directly in owner More tools.
- [x] Google Play restore/recovery helper for reinstall/device-change scenarios.
- [x] Restore path reuses CapDent server verification; local purchase data never unlocks paid access by itself.
- [x] Owner-visible Restore Subscription screen.
- [x] Additive `clinic_payment_accounts` migration committed to the V28 branch only; Production has not been changed.
- [x] Patient payment receiving-account table explicitly stores only non-secret provider metadata.
- [x] Authenticated Android users have no direct insert/update/delete access to provider account metadata.
- [x] Server-safe payment-account status RPC derives clinic context from the signed-in profile.
- [x] Country routing rule locked: explicit India (`IN`) → PhonePe; other explicitly configured countries → card only.
- [x] Missing/invalid country disables online payment routing rather than inferring India from phone/IP/SIM/device locale.
- [x] Owner-visible **Patient Payments** settings screen added under More.
- [x] Patient Payments screen is backward-safe when the additive backend migration is absent.
- [x] Provider onboarding buttons remain deliberately disabled until authenticated provider onboarding and merchant verification are implemented.
- [x] Consolidated-invoice rule documented: no patient messaging after individual OP/X-ray/medication/treatment fee entries.

## Required before V28 feature-complete release

### Client integration

- [ ] Run local TypeScript check for all V28 commits and fix any integration errors.
- [ ] Run Expo Doctor on the synced V28 branch and align SDK 57 patches if required.
- [ ] Remove remaining user-visible legacy "V25" labels where they describe current product UX rather than internal compatibility code.
- [ ] Add V28 release validator only after feature work is complete.
- [ ] Cut final release identity to Expo/package `1.2.8`, Android `versionCode` 28 only at release cut.

### Billing and entitlement QA

- [ ] Physical-device test: new Cloud purchase.
- [ ] Physical-device test: new Intelligence purchase.
- [ ] Physical-device test: restore after reinstall/device change.
- [ ] Test grace period, cancelled, expired, and account-hold display/recovery behavior.
- [ ] Confirm Play Console product IDs/offers exactly match release configuration.

### Quota/consent backend gate

- [ ] Review `20260814093000_capdent_v25_quota_consent_foundation.sql` against current Production schema.
- [ ] Verify authoritative upload/storage counting against current bucket/path conventions.
- [ ] Verify existing-clinic grandfathering behavior.
- [ ] Apply to a non-production/staging environment first if available.
- [ ] Only after explicit approval, apply to Production with enforcement flags still off.
- [ ] Validate legal consent persistence end to end.
- [ ] Enable quota enforcement only after observation and clinic-by-clinic rollout approval.

### Multi-clinic owner support — backend gated

- [ ] Introduce an additive owner/clinic membership model; current `profiles.clinic_id` is single-clinic.
- [ ] Define server-authoritative active clinic selection and allowed clinic list.
- [ ] Add RLS helpers/policies that derive clinic membership server-side.
- [ ] Backfill existing owner/profile clinic membership without changing current access.
- [ ] Add Android clinic switcher only after the above backend foundation passes isolation tests.
- [ ] Enforce plan clinic count (Free/Cloud 1; Intelligence up to configured limit) on the server.

### Dental Assistant role — backend gated

- [ ] Additive database role/permission migration must be reviewed first.
- [ ] Update owner staff RPC validation/return schema for `dental_assistant` only after DB constraint/policies support it.
- [ ] Define exact Dental Assistant permissions instead of silently inheriting all receptionist actions.
- [ ] Add role to Android staff management only after RLS regression tests pass.

### Consolidated invoice and patient payment flow

- [ ] Add an additive consolidated billing-cycle/final-invoice schema above the current legacy category invoices/payments; do not replace working legacy RPCs.
- [ ] Build receptionist **Review Final Invoice** screen that gathers OP, X-ray, medication, treatment, other charges, and existing payments.
- [ ] Add server-side `finalize_consolidated_bill()` with clinic/RLS checks, idempotency, immutable line-item snapshot, totals, payment snapshot, and safe correction/version semantics.
- [ ] Add concurrency-safe, server-authoritative sequential clinic invoice numbering for new consolidated invoices while preserving historical invoices.
- [ ] Add PDF/print/share output for the finalized consolidated snapshot.
- [ ] Add receptionist-only manual WhatsApp/share action; no automatic patient message after individual fees.
- [ ] Add secure patient invoice/share token with expiry/revocation and no internal clinic secrets.
- [ ] Add online payment request only for the verified remaining balance of a finalized invoice.
- [ ] Review `20260826173000_capdent_v28_clinic_payment_accounts.sql` against the live Production schema before applying it anywhere.
- [ ] Implement authenticated merchant onboarding: India → PhonePe; other configured countries → card provider.
- [ ] Keep provider credentials/API secrets/webhook secrets exclusively in server-side secret storage.
- [ ] Add idempotent provider webhook/callback verification before writing any online payment into the existing CapDent ledger.
- [ ] Ensure patient money settles to each clinic's connected merchant account, not CapDent's operating account.
- [ ] If clinic country is missing/invalid or merchant account unsupported/not connected, invoice sending must still work but online Pay Now must be omitted.
- [ ] Physical-device test finalized paid invoice (no payment link).
- [ ] Physical-device test finalized partially paid invoice (remaining-balance payment link only).
- [ ] Verify WhatsApp/share content contains only intended patient-facing information.

### Upload reliability

- [ ] Verify compression behavior across prescription/X-ray/before-after/report categories.
- [ ] Add/verify retry-safe UX for interrupted uploads.
- [ ] Verify duplicate-submit/file-row protection.
- [ ] Test quota warning at 120 and hard limit at 150 only after server gate is approved.
- [ ] Test signed URLs after expiry/refresh and after logout/login.

### Push reliability

- [ ] Physical-device notification permission denied → recovery flow.
- [ ] Physical-device registered token → payment received notification.
- [ ] Logout deactivates only the current installation token.
- [ ] Owner/head-doctor eligibility regression.
- [ ] Confirm coin-drop sound/channel behavior on upgrade from prior installed builds.

### Analytics / crash safety

- [ ] Review every analytics event for no patient name, phone, email, diagnosis, notes, prescription data, file paths, IDs used as user identifiers, or free text.
- [ ] Decide and document Firebase Analytics release flag state for V28.
- [ ] Add Crashlytics only after its native Expo/RNF integration and no-PHI logging policy are verified; it is not currently a dependency.

### Security and role regression

- [ ] RLS matrix test for owner/head, doctor, reception, and future assistant role.
- [ ] Cross-clinic access attempts must fail for patient, visit, treatment, payment, invoice, file, staff, and settings data.
- [ ] Privileged RPCs must derive authoritative user/clinic membership server-side.
- [ ] Confirm no service-role/admin secret in Android source, EAS config, bundled assets, or logs.
- [ ] Confirm minimal Android permissions and AD_ID remains blocked.

### Release QA

- [ ] Patient registration smoke test.
- [ ] Add Visit + ongoing treatment smoke test.
- [ ] Tooth-chart/history smoke test.
- [ ] Appointment/check-in/reminder smoke test.
- [ ] Consolidated payment/invoice/share smoke test.
- [ ] Online payment request/reconciliation smoke test.
- [ ] Gallery upload/view smoke test.
- [ ] Billing purchase/restore smoke test.
- [ ] Push notification smoke test.
- [ ] Owner Clinic Health smoke test.
- [ ] Owner Patient Payments smoke test.
- [ ] Play Internal AAB installed and tested before Production promotion.

## Deliberately excluded from Android V28

- AI chat / LLM assistant.
- AI X-ray diagnosis.
- Raw database AI access.

Those capabilities remain portal-only at `capdent.in/portal`.
