# Internal Testing Plan

Use this before Play Store internal testing or clinic pilot handover.

## Branch

Use `release/capdent-v18`.

Do not merge to main until testing is complete.

## Test tenant

Use the Supabase clinic stored as `Pavani dental` for v18 application and
database testing. Do not run production-readiness tests against other clinics.

- Database write-path checks must run inside transactions that end with
  `ROLLBACK`.
- Interactive upload tests must use clearly labelled test records and the
  authenticated Storage API for cleanup.
- Never expose patient names, contact details, user IDs, or clinic IDs in test
  reports.

## Test accounts

Prepare these roles:

- Owner / head doctor
- Doctor
- Receptionist

## Test records

Create test records for:

- New patient
- Old patient with opening due
- Prescription upload
- X-ray upload
- Before/after photo
- Pending payment
- Follow-up appointment

## Receptionist test

1. Login as receptionist.
2. Search patient.
3. Add patient if needed.
4. Quick check-in.
5. Collect OP fee.
6. Confirm patient appears in waiting queue.
7. Collect pending amount from patient profile.
8. Open WhatsApp reminder.

## Doctor test

1. Login as doctor.
2. Open waiting queue.
3. Select patient.
4. Add visit.
5. Select complaint.
6. Add treatment/cost if needed.
7. Book follow-up only inside allowed slots.
8. Save visit.
9. Confirm patient leaves waiting queue.
10. Open patient profile and verify visit history.

## Owner test

1. Login as owner/head doctor.
2. Check revenue summary.
3. Open Clinic Report.
4. Check waiting and completed counts.
5. Check revenue split cards.
6. Open staff management.
7. Open subscription screen.
8. Open billing and appointments tabs.

## Upload test

Test:

- Prescription
- X-ray
- Before photo
- After photo
- Report/other

Verify:

- Camera opens
- Gallery opens
- Preview appears
- Upload progress appears
- Success alert appears
- File appears in gallery/patient profile
- File opens in image viewer

## Payment test

Test:

- OP fee
- X-ray fee
- Medication fee
- Treatment fee
- Pending collection
- Partial pending collection

Verify:

- Amount is correct
- Payment method is saved
- Due amount changes correctly
- Owner revenue changes correctly
- Billing tab displays expected state

## Follow-up test

Allowed Add Visit follow-up slots:

- 11:00 AM to 01:30 PM
- 05:00 PM to 07:30 PM

No other time slots should appear.

## Issue format

```txt
Role:
Screen:
Patient name/code:
Steps:
Expected:
Actual:
Screenshot/video:
Urgency: Blocker / Important / Later
```

## Pass condition

Move to internal testing only when:

- No blocker bugs
- No payment calculation bug
- No missing visit history
- No upload failure
- No login/session failure
- Owner dashboard/report is understandable
