# CapDent V28 — Physical Device Regression Checklist

Date: 2026-08-27
Branch: `feature/capdent-v28`
Target release: `1.2.8` / Android versionCode `28`

Purpose: this is the mandatory physical-device gate before the V28 release cut. Record PASS/FAIL/BLOCKED for every item. Do not promote to Play Production with any unresolved release-blocking FAIL/BLOCKED item.

## Test setup

- [ ] Install the exact V28 candidate build on at least one small-screen Android phone and one normal-size Android phone.
- [ ] Confirm package `com.dms.clinic` launches cleanly from a cold start.
- [ ] Confirm no upgrade/install conflict with the currently distributed CapDent build.
- [ ] Confirm test accounts exist for owner/head doctor, doctor, and receptionist in a safe test clinic.
- [ ] Confirm test data is not created in a real clinic that must remain untouched.
- [ ] Record build commit SHA, app version, versionCode, Android version and device model with the test results.

## 1. Authentication, legal and role isolation

- [ ] Fresh login works.
- [ ] Existing session restores correctly after app restart.
- [ ] Logout returns to the expected authentication state.
- [ ] Mandatory Terms + Privacy acceptance appears when required and cannot be bypassed without checking acceptance.
- [ ] Owner/head doctor lands in the owner workspace.
- [ ] Doctor lands in the doctor workspace and cannot access owner-only controls.
- [ ] Receptionist lands in the reception workspace and cannot access clinical/owner controls that are not permitted.
- [ ] Cross-role deep links do not bypass authorization.

## 2. Patient lifecycle

- [ ] Reception/authorized role creates a new patient.
- [ ] Required demographic/contact validation behaves correctly.
- [ ] Patient appears in patient search/directory immediately.
- [ ] Patient profile opens without missing/duplicated data.
- [ ] Patient details can be safely edited where permitted.
- [ ] Another clinic user cannot view or mutate this clinic's patient through a guessed/deep-linked identifier.

## 3. Appointment and waiting-room workflow

- [ ] Create/schedule an appointment.
- [ ] Reception check-in/waiting-room flow works.
- [ ] Owner/head-doctor dashboard reflects waiting count.
- [ ] Doctor can open the patient/visit workflow.
- [ ] Reschedule works and updates all relevant screens.
- [ ] Mark completed removes the patient from active waiting state and increments completed state correctly.
- [ ] Realtime refresh does not duplicate/remove unrelated appointments.

## 4. Visit, treatment and dental chart

- [ ] Start/open a patient visit.
- [ ] Dental/tooth chart renders correctly and remains usable on a small screen.
- [ ] Add/update the intended dental chart finding/status.
- [ ] Add treatment/ongoing treatment data.
- [ ] Save, leave screen, reopen and confirm persistence.
- [ ] Treatment completion/status changes propagate correctly to owner/review views.

## 5. Prescription and clinical documentation

- [ ] Create a prescription.
- [ ] Add/edit/remove expected prescription items.
- [ ] Save and reopen the prescription.
- [ ] Prescription preview/share path works where enabled.
- [ ] No patient/clinical text appears in unintended analytics/debug UI.

## 6. X-ray, before/after and patient media

For each enabled media type (X-ray, prescription photo, before/after, patient/report image):

- [ ] Capture from camera.
- [ ] Select from Android photo picker.
- [ ] Image compression does not make the clinical image unusable.
- [ ] Upload completes on normal mobile data/Wi-Fi.
- [ ] Image opens again after app restart.
- [ ] Delete/remove behavior matches role permissions.
- [ ] Cancellation/back navigation does not create an empty/broken record.
- [ ] Free-tier upload warning/limit behavior is tested in a safe test clinic where practical.

## 7. Billing and manual payments

- [ ] Create billable OP/consultation charge.
- [ ] Create X-ray charge.
- [ ] Create medication charge.
- [ ] Create treatment charge.
- [ ] Create/verify pending or other category where applicable.
- [ ] Finalize/review bill without silently mutating previously finalized historical snapshots.
- [ ] Record a manual payment and verify due/paid balance changes correctly.
- [ ] Partial payment behaves correctly.
- [ ] Owner Payment Review shows correct total/category/method/staff information.
- [ ] Existing historical/legacy payments remain visible.

## 8. Invoice output/share

- [ ] Finalized invoice presentation is readable on device.
- [ ] Generate native PDF/file where enabled.
- [ ] Open the generated file.
- [ ] Android share sheet opens successfully.
- [ ] WhatsApp/manual share path works without exposing internal UUIDs/database IDs.
- [ ] Repeated generation does not corrupt or silently change the historical invoice snapshot.

## 9. Owner reports and V28 navigation polish

- [ ] Owner dashboard loads without layout clipping on a small device.
- [ ] Dashboard header quick controls open Payments, Reconcile and Reports correctly.
- [ ] Clinic Report → Reports & Controls navigation works.
- [ ] Payment Review range chips and collapsible sections work.
- [ ] Verified Online Payments cards expand/collapse Details correctly.
- [ ] Payment Reconciliation cards show Received / Still Due / Apply Now / Excess clearly.
- [ ] PhonePe Accounts screen status text/touch targets are understandable and do not overflow.
- [ ] Pull-to-refresh/loading/empty states do not trap navigation.

## 10. Reception counter QR UI (provider-independent checks)

These checks can be completed without processing real money up to the provider credential boundary.

- [ ] Reception can open Collect by QR.
- [ ] Patient search/select is fast and selected patient state is obvious.
- [ ] Category selection supports OP, X-ray, medication, treatment, pending and other.
- [ ] Amount entry uses the correct keyboard and remains visible above the keyboard.
- [ ] Server refuses an amount above the outstanding amount for the selected category.
- [ ] QR creation fails safely and clearly when no verified/default merchant account exists.
- [ ] Active/waiting, verifying, expired, failed, cancelled, replaced and needs-review UI states hide/show the QR appropriately where they can be simulated/tested.
- [ ] Cancelling/replacing a QR does not leave the old request presented as active in the app.

## 11. PhonePe E2E certification — BLOCKED until credentials exist

Do not mark this section PASS using mocks alone.

- [ ] BLOCKED — Add/verify a real or official sandbox clinic merchant account.
- [ ] BLOCKED — Confirm exact PhonePe contract/credentials for CapDent's clinic-owned multi-merchant model.
- [ ] BLOCKED — Reception selects patient + category + amount and generates a real payable QR.
- [ ] BLOCKED — Patient scans and pays.
- [ ] BLOCKED — Provider callback is authenticated and independent status verification succeeds.
- [ ] BLOCKED — Verified merchant ID matches the exact account locked into the request.
- [ ] BLOCKED — Verified amount matches the exact payment request.
- [ ] BLOCKED — Correct selected category alone is credited in CapDent.
- [ ] BLOCKED — Reception screen transitions to Paid & recorded.
- [ ] BLOCKED — Owner Verified Online Payments report shows receiving account and category allocation.
- [ ] BLOCKED — Duplicate callback does not duplicate ledger money.
- [ ] BLOCKED — Failed/expired provider transaction creates no false payment.
- [ ] BLOCKED — Replaced/expired QR paid late is held for reconciliation rather than silently lost/credited.
- [ ] BLOCKED — Balance changed while payment is in-flight produces Needs Review safely.
- [ ] BLOCKED — Owner Apply Current Due Only applies no more than current due and preserves excess separately.

## 12. Push notifications

- [ ] Notification permission/request flow is appropriate for Android version under test.
- [ ] Device token registers for owner/head doctor/reception role as designed.
- [ ] Relevant server push reaches the physical device.
- [ ] Payment notification channel/sound behaves correctly where applicable.
- [ ] Tapping notification opens the correct app destination.
- [ ] Logout/login or token rotation does not leave notifications bound to the wrong user/clinic.

## 13. Google Play subscription regression

Must be tested using a Play-distributed internal-track candidate, not only a local APK.

- [ ] Product/plan information loads from Google Play.
- [ ] Test purchase completes.
- [ ] Server verification activates the expected entitlement.
- [ ] App restart restores the entitlement.
- [ ] Restore/recovery path works after reinstall/login where expected.
- [ ] Invalid/unverified purchase cannot unlock paid features.
- [ ] Subscription state remains clinic/user scoped correctly.

## 14. Analytics/privacy

- [ ] Firebase Analytics initializes on the release/internal build.
- [ ] Expected allow-listed events appear.
- [ ] Newly added V28 payment/invoice events, if any, contain no patient name, phone, clinical notes, raw merchant ID, provider transaction ID or other disallowed sensitive payload.
- [ ] Advertising ID permission remains absent.
- [ ] Crash/log output contains no secrets, OTPs, merchant credentials or sensitive provider payloads.

## 15. Network/interruption regression

- [ ] App handles temporary offline state without crashing.
- [ ] Retry after network recovery works for patient/report/billing data.
- [ ] Double-tapping save/pay/finalize actions does not duplicate records.
- [ ] Background/foreground during a form does not unexpectedly lose committed data.
- [ ] Force-close/reopen does not display stale Paid/Completed state incorrectly.

## 16. Performance, accessibility and Android UX

- [ ] No obvious screen flicker/crash during normal navigation.
- [ ] Keyboard does not cover critical amount/search/action fields.
- [ ] Touch targets are usable on a small-screen device.
- [ ] Long patient/clinic/account names do not break layout.
- [ ] Back button/back gesture behaves predictably on every new V28 screen.
- [ ] Text remains readable at common Android font scaling.
- [ ] App remains responsive with realistic patient/history data volume.

## 17. Final RC gate after physical-device PASS

Only after all non-PhonePe physical checks are PASS and PhonePe E2E is PASS if the feature will ship enabled:

- [ ] Final GitHub ↔ MDMS migration/function parity snapshot is clean.
- [ ] Cross-clinic RLS negative matrix is clean for owner/head doctor/doctor/receptionist.
- [ ] Play Data Safety/privacy disclosures are reconciled with V28.
- [ ] Expo Doctor is clean or every warning has an explicit accepted-risk note.
- [ ] Signing keystore/fingerprint is verified.
- [ ] Set app version to `1.2.8` and Android versionCode to `28`.
- [ ] Run `check:v28:rc` successfully on the release-cut commit.
- [ ] Build signed AAB.
- [ ] Upload to Play Internal Testing.
- [ ] Install the Play-distributed AAB on physical device(s) and repeat the critical smoke subset.
- [ ] Review Crashlytics/Analytics/notification behavior.
- [ ] Promote only after zero release-blocking FAIL/BLOCKED items remain.

## Critical smoke subset for the final Play-distributed AAB

The final Internal build must at minimum pass: login/legal, owner/reception/doctor role routing, create/search patient, waiting-room + visit, dental chart, prescription, one clinical media upload, manual bill/payment, invoice share, owner reports, notification receipt, subscription entitlement, and the full PhonePe success/reconciliation flow if PhonePe is enabled in V28.

## Release decision rule

`1.2.8 / versionCode 28` is **not production-ready** until this checklist is completed with evidence. PhonePe provider E2E is a hard blocker if the payment feature is visible/enabled in the Play Store V28 build.
