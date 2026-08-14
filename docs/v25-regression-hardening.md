# CapDent V25 regression hardening audit

Status: TARGETED V25 RELEASE GATE IN PROGRESS

This document records the V25 mutation-path review before the final production AAB and targeted release-build smoke pass.

Stable V24 workflows are not treated as open V25 blockers by this audit. The production gate focuses only on areas changed or newly activated for V25: consent, quota/entitlements, upload accounting, billing guards, push containment, Firebase Analytics, signing/environment, and production migration activation.

## Patient creation authority

V25 server quota enforcement is designed to be authoritative at `public.patients` through the V25 quota migration trigger. This protects patient inserts regardless of which client screen initiated them once the migration is applied and enforcement is enabled.

Reviewed client paths:

- Standard Add Patient: V25 entitlement preflight plus existing patient-limit UX.
- Add Old Patient: V25 entitlement preflight plus existing patient-limit UX.
- Appointment booking: can create a new patient before booking an appointment. It currently relies on the shared patient creation function and ultimately the database patient trigger for authoritative enforcement. Client-side V25 preflight parity remains a UX follow-up, not a release blocker.
- Reception Quick Check-in: can create a new patient through `reception_quick_checkin`. It already shows the legacy patient-limit warning. The V25 database patient trigger remains the final quota authority for the insert. Client-side V25 entitlement parity remains a UX follow-up, not a release blocker.

## Upload authority

Reviewed paths:

- Clinical X-ray uploads -> unified `/patient/upload` flow.
- Prescription uploads -> unified `/patient/upload` flow.
- Before/after photos -> unified `/patient/upload` flow.
- Other patient files/reports -> unified `/patient/upload` flow.
- Patient profile photos -> dedicated helper with V25 upload/storage preflight.

The V25 Storage trigger remains the final authority for upload-count and storage-byte limits once enabled. Existing clinics remain protected by rollout flags and grandfathering until deliberately changed.

## Payment mutation safety

Reviewed `patient/payment` flow:

- immediate mutation lock prevents repeated-tap payment submissions;
- amount must be greater than zero;
- payment cannot exceed the selected invoice/patient pending amount;
- collection uses the server `record_patient_payment` RPC;
- client does not separately insert a payment and then patch an invoice;
- timeout/error handling preserves an explicit failure state.

Payment flow is not an open V25 blocker. Release-build smoke should only verify the changed duplicate-submit/error-state behavior and notification side effects if the exact AAB is available.

## Appointment mutation safety

Reviewed appointment booking flow:

- immediate mutation lock prevents repeated booking submissions;
- appointment date/time must be in the future;
- existing patient and new-patient paths are separated;
- when a new patient is created successfully but appointment creation fails, the UI explicitly tells the user the patient already exists and must not be registered again;
- appointment creation invalidates appointment/dashboard caches through the shared data layer.

Appointment flow is not an open V25 blocker. Release-build smoke should only verify the changed duplicate-submit/error-state behavior if the exact AAB is available.

## Legal consent

V25 includes:

- mandatory Terms + Privacy checkbox during owner onboarding;
- mandatory Terms + Privacy checkbox for staff invite onboarding;
- server-timestamped/versioned consent RPC foundation;
- existing-user V25 consent gate after the migration is available;
- migration-safe fallback before the additive consent table is deployed.

Production migration must exist before final rollout so existing-user consent becomes server-verifiable.

## Analytics

V25 native Firebase Analytics remains disabled by build configuration until native verification. Event design intentionally excludes patient names, phone numbers, patient IDs, notes, diagnoses, file paths, and other clinical content.

Covered taxonomy includes app readiness, screen categories, quota blocks, legal consent, patient registration, and clinical upload completion. Release-build validation is required before analytics collection is enabled.

## Release blockers still open

1. Re-run local validation after this documentation-only update: `npm run check:v25:rc`, Expo config check, and `git diff --check`.
2. Verify Android signing credential matches the previously approved CapDent Play signing/upload key.
3. Verify EAS production/internal environment variables and Google Services file.
4. Build production/internal versionCode 25 AAB.
5. Install/test the exact AAB from Play Internal for targeted V25 changes only.
6. Apply the reviewed additive V25 Supabase migration after the AAB is proven.
7. Keep quota rollout flags disabled initially; validate entitlement reads and usage counts in production.
8. Verify consent persistence and quota reads after production migration activation.
9. Enable enforcement deliberately only after smoke testing and clinic rollout policy approval.
10. Upload the proven AAB to Google Play Production.

## Targeted V25 release-build smoke gate

This is not a full V24 regression list. V24-stable workflows are assumed to remain valid unless touched by V25.

Must verify only the changed/new V25 areas:

- owner onboarding Terms + Privacy acknowledgement;
- staff invite Terms + Privacy acknowledgement;
- existing-user legal consent gate after migration activation;
- quota usage card loads patient/upload/storage counts;
- patient and old-patient quota preflight messages;
- clinical upload and patient profile-photo quota/storage preflight;
- quota block/upgrade message copy when limits are simulated or reached;
- Google Play subscription launch guard/error state;
- push registration failure containment and payment-route notification sanity;
- Firebase Analytics release-build initialization with PHI-safe event payloads;
- login/logout sanity on an existing clinic;
- one existing-patient read sanity to confirm no obvious session/data break.

No production Supabase change is performed by this audit.
