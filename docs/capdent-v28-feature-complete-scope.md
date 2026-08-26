# CapDent V28 — Feature-Complete Android Scope

V28 is a real product release, not merely an Android `versionCode` increment. The stable production/release branch stays protected until every required V28 gate is satisfied.

## Product boundary

- Android remains the clinic operating application for owner/head doctor, doctor, receptionist, and approved Dental Assistant workflows.
- AI chat, LLM/API access, AI diagnosis, and X-ray AI remain **portal-only** at `capdent.in/portal` and must not be added to the Android binary.
- Existing V24/V25 clinical behavior, dental chart history, billing safety, payment notifications, and clinic isolation must not regress.

## V28 required feature set

### 1. Plans, quotas, and usage visibility
- Server-authoritative entitlements and plan state.
- Free tier: 100 patients, 150 uploads, warning at 120 uploads, 1 GB storage.
- Clear usage meters for patients, uploads, and storage.
- Grandfathering/observation-mode awareness during rollout.
- Friendly upgrade messaging before hard rejection.
- No client-side-only enforcement: production quota enforcement remains database-authoritative.

### 2. Google Play billing reliability
- Free / Cloud / Clinic Intelligence plan presentation.
- Purchase flow, server verification, restore/recovery flow, grace/account-hold/expired/cancelled states.
- Retry-safe processing and clear locked-feature messaging.
- Never unlock paid access solely from a local purchase callback.

### 3. Onboarding and clinic setup
- Guided owner setup: clinic details → staff → first patient → key settings.
- Useful empty states and first-run guidance.
- Mandatory versioned Terms and Privacy consent.
- Permission refresh/recovery prompts where permissions are required.

### 4. Owner operations and multi-clinic readiness
- Owner dashboard operational snapshot and attention items.
- Owner review, activity, payments, follow-ups, treatments, staff-performance, reports, and export.
- Multi-clinic switching/readiness without cross-clinic data leakage.
- Clinic settings, branding, feature controls, and account controls.

### 5. Staff and Dental Assistant controls
- Owner-controlled staff invite/access lifecycle.
- Explicit role/permission mapping.
- Dental Assistant role support only where backend/RLS policy supports it.
- No privilege escalation or cross-clinic membership leakage.

### 6. Clinical workflow stability
- Preserve Add Visit, ongoing treatments, tooth chart, patient history, prescriptions/medications, appointments, and follow-ups.
- Tooth chart remains separated from Add Visit where already designed, while preserving longitudinal history.
- Mutation locking/duplicate-submit protection on critical clinical writes.

### 7. Consolidated invoices, patient payments, and handover
- Preserve the existing internal OP/X-ray/medication/treatment/other charge and payment paths; do not rewrite their working RPCs in place.
- Individual charges/payments accumulate internally and are **not** automatically messaged to the patient.
- Reception explicitly reviews and finalizes one consolidated patient-facing invoice for the billing cycle/visit.
- The finalized invoice is an immutable/auditable snapshot with safe corrections/versioning and server-authoritative sequential numbering.
- PDF/print/share output remains available.
- Reception manually sends the finalized invoice through supported WhatsApp/share paths; no automatic WhatsApp is sent after individual fees.
- Online payment is offered only for the verified remaining finalized-invoice balance.
- Clinic country stored on the server controls the patient payment provider: explicit `IN` → PhonePe; other explicitly configured countries → card only for V28.
- Missing/invalid clinic country disables online payment routing; CapDent must not infer India from phone number, IP, SIM, or device locale.
- Patient money settles to the clinic's connected merchant receiving account, not to a CapDent operating account.
- Provider credentials, merchant secrets, bank passwords, OTPs, UPI PINs, webhook secrets, and API keys must never be stored in Android or `EXPO_PUBLIC_*` configuration.
- Provider webhook/callback verification is server-authoritative and idempotent before any verified online payment enters the existing CapDent payment ledger.
- Payment review and owner financial reporting remain clinic-scoped.

### 8. Upload and gallery reliability
- Image compression before upload where applicable.
- Upload count/storage quota awareness.
- Retry-safe handling and duplicate protection.
- Clear failure state for offline/interrupted upload.
- Signed storage URLs for protected clinical files.

### 9. Push notification reliability
- Owner/head-doctor payment push eligibility only.
- Android notification channel + coin-drop sound preserved.
- Permission health and recovery guidance.
- Token registration/deactivation remains per user/install and clinic scoped.
- V24-compatible payment notification payload/route behavior must be regression tested.

### 10. Help, feedback, and support
- In-app guide.
- Report issue / feedback flow.
- Support/contact entry points.
- Actionable error, loading, empty, and recovery states.

### 11. Analytics and crash safety
- Firebase Analytics only when explicitly enabled by release configuration.
- Strict no-PHI analytics: never send patient name, phone, email, diagnosis, treatment notes, file paths, prescription data, or free text.
- Crash/error reporting must also avoid PHI/secrets.

### 12. Security and privacy gates
- RLS and clinic isolation verified for every new/changed backend path.
- Server derives authoritative clinic/user context for privileged operations.
- Signed storage URLs and minimal Android permissions.
- No service-role/admin secret in client source or build configuration.
- Safe logging: no tokens, secrets, patient records, or raw sensitive payloads.

## V28 release identity

Development branch: `feature/capdent-v28`

Final release branch will be created only after feature completion and review. At release cut:
- Expo/package version: `1.2.8`
- Android `versionCode`: `28`
- Android package: `com.dms.clinic`
- Target/compile SDK: 36

## Release gates

V28 must not be called complete until all of the following are true:

1. TypeScript and Expo Doctor pass.
2. V28-specific validator passes from the final V28 release branch.
3. Approved Android signing SHA-1 passes unchanged.
4. No Android AI/chat/LLM code is present.
5. Quota/consent backend migration is reviewed separately before production application.
6. Clinic isolation/RLS regression tests pass.
7. Physical-device smoke tests pass for owner/head doctor, doctor, and reception roles.
8. Patient registration, visit, tooth chart, treatment, consolidated invoice/share, online payment reconciliation, gallery upload, billing recovery, and push notification flows pass.
9. Play Internal AAB is installed and tested before any Production promotion.
10. Production release requires explicit approval after the above gates are green.
