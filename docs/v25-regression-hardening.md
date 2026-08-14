# CapDent V25 regression hardening audit

Status: BUILD REVIEW IN PROGRESS

This document records the V24 -> V25 mutation-path review before the final production AAB and physical-device regression pass.

## Patient creation authority

V25 server quota enforcement is designed to be authoritative at `public.patients` through the V25 quota migration trigger. This protects patient inserts regardless of which client screen initiated them once the migration is applied and enforcement is enabled.

Reviewed client paths:

- Standard Add Patient: V25 entitlement preflight plus existing patient-limit UX.
- Add Old Patient: V25 entitlement preflight plus existing patient-limit UX.
- Appointment booking: can create a new patient before booking an appointment. It currently relies on the shared patient creation function and ultimately the database patient trigger for authoritative enforcement. Client-side V25 preflight parity remains a UX follow-up.
- Reception Quick Check-in: can create a new patient through `reception_quick_checkin`. It already shows the legacy patient-limit warning. The V25 database patient trigger remains the final quota authority for the insert. Client-side V25 entitlement parity remains a UX follow-up.

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
- timeout/error handling preserves an explicit failure state for later device verification.

Physical-device regression still required for network interruption immediately after server commit, repeated taps, pending invoice refresh, and push-notification side effects.

## Appointment mutation safety

Reviewed appointment booking flow:

- immediate mutation lock prevents repeated booking submissions;
- appointment date/time must be in the future;
- existing patient and new-patient paths are separated;
- when a new patient is created successfully but appointment creation fails, the UI explicitly tells the user the patient already exists and must not be registered again;
- appointment creation invalidates appointment/dashboard caches through the shared data layer.

Physical-device regression still required for rapid taps, offline/timeout behavior, new-patient partial success, and appointment list refresh.

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

Covered taxonomy includes app readiness, screen categories, quota blocks, legal consent, patient registration, and clinical upload completion. Physical-device validation is required before analytics collection is enabled.

## Release blockers still open

1. Run TypeScript and V25 RC validation after syncing the latest GitHub commits locally.
2. Re-run local disposable Supabase replay with the V25 quota/consent migration included.
3. Verify appointment-new-patient and reception-new-patient UX against the V25 entitlement RPC; server trigger already remains authoritative.
4. Verify Android signing credential matches the previously approved CapDent Play signing/upload key.
5. Build production versionCode 25 AAB.
6. Perform physical-device V24 -> V25 regression testing.
7. Apply the reviewed additive V25 Supabase migration after the AAB is proven.
8. Keep quota rollout flags disabled initially; validate entitlement reads and usage counts in production.
9. Enable enforcement deliberately only after smoke testing and clinic rollout policy approval.
10. Upload the proven AAB to Google Play Production.

## Must-pass device regression

- login/session restore
- owner onboarding and clinic creation
- staff invite onboarding
- existing-user legal consent gate
- add patient
- add old patient
- quick check-in existing patient
- quick check-in new patient
- appointment booking existing patient
- appointment booking new patient
- visits and dental chart
- treatments
- OP/X-ray/medication/treatment/pending payments
- invoices and dues
- X-ray upload
- prescription upload
- before/after photo upload
- patient profile photo upload
- gallery/image viewer
- push notifications
- Google Play subscription state
- owner Account Settings atomic save
- quota usage card
- quota block/upgrade messages
- logout/login again

No production Supabase change is performed by this audit.