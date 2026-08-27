# CapDent V28 — Production Gap Audit

Date: 2026-08-27
Branch: `feature/capdent-v28`
Target release: `1.2.8` / Android versionCode `28`

Legend: PASS = production implementation is present and current automated/live checks support it. FIX = implementation exists but production-grade QA/polish remains. BLOCKED = cannot be signed off until an external dependency or real-device/provider test is completed.

## Release governance

- PASS — V28 is isolated on its feature branch and the stable baseline remains separate.
- PASS — Android production/APK/AAB build commands run `check:v28:rc` before release build/signing.
- PASS — V28 feature architecture validator, payment validator, TypeScript, diff check, and Expo public-config validation are green in CI.
- PASS — Dependency audit completed; current high findings are Metro/image-size build-tool exposure rather than shipped Android runtime code. No unsafe forced dependency downgrade/upgrade was applied.
- FIX — Branch protection/release PR discipline should be enforced before the final merge/release cut.
- FIX — App identity intentionally remains development identity `1.2.6` / versionCode `27`; cut `1.2.8` / `28` only after all blockers below are cleared.

## Core clinic workflows

- PASS — Owner/head doctor, doctor and receptionist role-specific navigation/workspaces exist.
- PASS — Patient registration and patient directory are retained.
- PASS — Visit, treatment, tooth chart, appointment, check-in, reminder and follow-up paths are retained from the reconciled V27 baseline.
- PASS — Existing invoice/payment ledger and owner payment-review paths are retained.
- FIX — Full physical-device regression is still required for patient registration, visit/treatment/tooth chart, appointment/check-in/reminders and role navigation.

## Legal/privacy

- PASS — Mandatory Terms of Service + Privacy Policy checkbox exists.
- PASS — Consent records terms version, privacy version, app version and platform before allowing continuation.
- PASS — Legal links are opened externally and acceptance cannot proceed until checked.
- FIX — Final Play Store Data Safety answers must be reconciled against the V28 feature set before submission.

## Analytics

- PASS — React Native Firebase App + Analytics are configured in the Expo app.
- PASS — Advertising ID permission is explicitly blocked.
- PASS — V27 analytics allow-list/privacy architecture is retained.
- FIX — Confirm no newly added V28 payment/invoice event sends patient identifiers, merchant transaction IDs or clinical text to Firebase.
- FIX — Verify Analytics events on a release/internal physical build.

## Notifications

- PASS — Expo Notifications is configured with the canonical payment channel and custom coin-drop sound.
- PASS — V27 notification-health/token-repair architecture is retained.
- PASS — Server payment-notification function remains deployed.
- FIX — Physical-device push regression is required for owner/head-doctor/reception paths and token rotation.

## Google Play subscriptions

- PASS — `react-native-iap` remains installed and billing permission is declared.
- PASS — `verify-google-play-subscription` and `sync-google-play-subscriptions` are ACTIVE in MDMS.
- PASS — Server-verified paid-plan activation architecture is retained.
- FIX — Real Play internal-track purchase, renewal/recovery and entitlement regression is required on the V28 candidate.

## Uploads / clinical media

- PASS — Camera/photo-picker support is configured for patient photos, prescription photos, X-rays and reports.
- PASS — Broad storage permissions are blocked; Android photo picker path is preferred.
- PASS — Free-tier policy retained at 150 uploads with warning threshold retained from prior release architecture.
- FIX — Physical-device capture/select/compress/upload/view/delete/regression tests are required for X-ray, prescription and before/after/patient media paths.
- FIX — Verify free-tier upload-limit UX and server enforcement in a real test clinic.

## Consolidated billing and invoices

- PASS — Consolidated bill/header and frozen line-item snapshot foundation exists.
- PASS — Reception can review/finalize selected invoice rows and existing legacy financial history is preserved.
- PASS — Server-authoritative invoice numbering and race/duplicate protections exist.
- FIX — Finalized-invoice correction/version semantics still need an explicit safe UX rule; finalized historical snapshots must never be silently edited.
- FIX — Native PDF/file generation, print/share and WhatsApp physical-device QA remain incomplete.
- FIX — Public patient invoice token resolver/viewer is not yet production-complete; manual safe sharing remains the initial path.

## Clinic-owned payment accounts

- PASS — Clinic owners/head doctors can manage multiple PhonePe receiving-account records.
- PASS — Accounts have verification lifecycle, enabled/disabled state and one verified default receiving account.
- PASS — Owners cannot self-verify accounts; trusted server verification is service-role controlled.
- PASS — Merchant secrets/PINs/OTPs are never requested or stored in the Android app.
- PASS — Patient money is architected to settle directly to the clinic account, not CapDent.
- BLOCKED — No real/sandbox PhonePe merchant/provider credentials are currently available for verification.
- BLOCKED — Exact PhonePe multi-merchant/platform/end-merchant contract must be confirmed against provider-issued credentials before production enablement.

## Reception counter QR payments

- PASS — Reception can select patient, payment category and amount.
- PASS — Supported categories include OP/consultation, X-ray, medication, treatment, pending collection and other.
- PASS — Server limits the requested amount to the selected category's actual outstanding due.
- PASS — Payment request locks patient, amount, category and exact receiving account.
- PASS — QR checkout/status screen handles waiting, verifying, paid, failed, expired, cancelled, superseded and needs-review states.
- PASS — Old/replaced/expired QR money is never silently lost or auto-applied incorrectly; it can be held for reconciliation review.
- PASS — Duplicate provider events/reconciliation paths are idempotency protected.
- BLOCKED — End-to-end QR scan/payment/provider callback/status verification has not been executed with PhonePe credentials.

## Payment verification/reconciliation

- PASS — Provider callback alone cannot mark a CapDent payment paid.
- PASS — PhonePe webhook re-authenticates to provider/status endpoint before money can move.
- PASS — Merchant identity and exact amount are bound to the locked clinic receiving account/request.
- PASS — Verified money is written into the existing CapDent `payments` ledger.
- PASS — Category allocation remains traceable for OP/X-ray/medication/treatment/etc.
- PASS — Receiving account/merchant/category snapshots are preserved in reconciliation audit rows.
- PASS — Sensitive provider-event and reconciliation RPCs are service-role only in MDMS.
- PASS — Owner reconciliation review and safe `apply current due only` resolution flow exist.
- BLOCKED — Real provider full-success, failure, duplicate callback, late payment, replacement QR and changed-balance scenarios require sandbox/E2E certification.

## Owner payment reporting

- PASS — Verified Online Payments report exists.
- PASS — Receiving account, masked merchant ID, total and category allocations are surfaced.
- PASS — Reconciliation Required owner review exists.
- FIX — UI should be simplified before final RC: compact transaction rows, expandable forensic details and clearer receiving-account state language.

## UI/UX production polish

- FIX — Reception Collect by QR should be optimized into the fastest possible counter workflow: selected patient header → category → amount → QR, with less explanatory copy/card density.
- FIX — Payment state visuals should be dominant and unmistakable at a glance.
- FIX — PhonePe account status should be simplified into human language such as Pending verification / Ready to receive / Default / Disabled, with technical details secondary.
- FIX — Standardize headers, spacing, loading/skeleton states, keyboard behavior and small-screen wrapping across new V28 screens.
- FIX — Run physical-device accessibility/touch-target and keyboard regression on smaller Android devices.

## Supabase / MDMS

- PASS — Full V28 payment migration chain is applied in MDMS through counter-QR cancellation/lifecycle hardening.
- PASS — Payment tables checked during validation have RLS enabled.
- PASS — Money-moving/provider-verification RPCs checked during validation remain service-role only.
- PASS — `create-patient-payment-checkout`, `manage-phonepe-payment-accounts`, `create-counter-payment-checkout`, `get-counter-payment-qr` and the hardened PhonePe webhook are ACTIVE.
- FIX — Before release cut, perform one final GitHub migration/function source-to-live MDMS parity snapshot and RLS role matrix test.
- FIX — Cross-clinic negative tests should be explicitly executed for owner/head doctor/doctor/reception identities.

## Android release configuration

- PASS — Package remains `com.dms.clinic`.
- PASS — targetSdk/compileSdk are 36.
- PASS — backups are disabled.
- PASS — unnecessary sensitive permissions including AD_ID, audio and broad storage permissions are blocked.
- PASS — Release build scripts include V28 RC validation and Android signing verification.
- FIX — Run Expo Doctor on the final release-cut commit.
- FIX — Verify final release signing fingerprint/keystore path before AAB generation.
- FIX — Cut `1.2.8` / Android versionCode `28` only after all BLOCKED items are cleared.

## Play Store release

- FIX — Update/reconfirm Play Console Data Safety and privacy disclosures for V28 analytics, notifications, billing and payment-routing behavior.
- FIX — Generate signed Play Internal AAB only after RC gate passes.
- FIX — Install Play-distributed Internal build on physical devices and run full smoke/regression matrix.
- FIX — Review crash/analytics/notification behavior from the Internal build before Production promotion.
- BLOCKED — Production promotion must not occur until PhonePe E2E certification is complete if PhonePe is shipped as enabled functionality in V28.

## Current release decision

**NOT READY TO CUT 1.2.8 / versionCode 28 yet.**

The main external blocker is PhonePe merchant/provider E2E certification. The main internal work remaining is physical-device regression, final UI/UX polish, invoice PDF/share QA, Play subscription/push regression, cross-clinic permission testing and final Play Store compliance/release checks.

Release policy: no new optional feature expansion. Only production hardening, activation, QA and blocker closure until the V28 production checklist reaches zero unresolved BLOCKED/FIX items required for release.