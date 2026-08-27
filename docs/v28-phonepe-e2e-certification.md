# CapDent V28 PhonePe E2E Certification

This checklist must be completed before cutting CapDent 1.2.8 / Android versionCode 28 for production.

## Preconditions

- Use a non-production test clinic/patient only.
- PhonePe sandbox/test credentials are present only in Supabase Edge Function secrets.
- At least one clinic-owned PhonePe merchant account is added by owner/head doctor.
- The merchant account is verified by trusted server-side verification and is marked connected, payments enabled, settlements enabled, and default.
- Receptionist account is active for the same clinic.
- The selected patient has known outstanding amounts in at least two categories so category isolation can be verified.

## Test A — Merchant account ownership and account selection

1. Owner adds PhonePe merchant account A.
2. Confirm it starts pending and cannot receive payments before verification.
3. Mark A verified through trusted server verification.
4. Make A default.
5. Add merchant account B and verify it.
6. Change default to B.
7. Confirm previously prepared requests remain locked to their original payment_account_id.
8. Confirm new requests use B.

PASS: multiple clinic-owned accounts work, only verified accounts can be default, and existing requests never silently switch merchants.

## Test B — Successful receptionist counter QR

1. Reception opens Collect by QR.
2. Search and select the test patient.
3. Select OP / Consultation.
4. Enter an amount less than or equal to the patient’s outstanding OP amount.
5. Generate QR.
6. Confirm QR shows Waiting for payment and a live expiry countdown.
7. Scan QR from a second device and complete the PhonePe test payment.
8. Confirm the app changes to Paid & recorded only after provider verification.
9. Confirm one payment entry exists for the exact amount and category `op_fee`.
10. Confirm no X-ray, medication, treatment, pending, or other balance was reduced.
11. Confirm reconciliation audit contains the exact payment request, payment account, provider merchant ID snapshot, account label snapshot, category, and amount.

PASS: money goes to the clinic merchant account and CapDent records only the selected category/amount.

## Test C — Category isolation

Repeat Test B separately for:

- X-ray
- Medication
- Treatment
- Pending Collection
- Other

For each test, verify only that category is reduced and the owner report shows the same category allocation.

PASS: category selection by reception is preserved end to end.

## Test D — Amount guard

1. Select a category with a known due.
2. Enter an amount greater than that category due.
3. Attempt to create the payment request.

PASS: backend rejects the request and no payable QR is generated.

## Test E — Duplicate callback / idempotency

1. Complete one successful QR payment.
2. Replay the same provider event/callback through the approved sandbox mechanism if available, or re-query the same successful provider order.
3. Inspect the ledger and reconciliation audit.

PASS: exactly one financial payment is recorded; duplicate provider events do not double-credit the patient.

## Test F — Expired QR

1. Generate a counter QR and allow it to expire without paying.
2. Confirm the QR disappears and the UI shows QR expired.
3. Confirm no payment ledger row is created.
4. Generate a new QR for the same patient/category.

PASS: expired QR cannot remain displayed as payable and replacement works.

## Test G — Explicit replacement/cancellation

1. Generate a QR.
2. Use Cancel / New QR before payment begins.
3. Confirm the server marks the old request cancelled.
4. Confirm the old QR disappears from reception.
5. Generate a replacement QR.

PASS: reception and server agree that the previous request is retired before replacement.

## Test H — Late payment on old/replaced/expired QR

1. Generate QR A and open it on the payer device.
2. Cancel/replace or expire QR A from CapDent.
3. Complete the already-open provider payment for QR A if the sandbox allows it.
4. Confirm CapDent verifies the real provider money but does not automatically credit the patient.
5. Confirm the request appears under Payment Reconciliation / Needs review.

PASS: real money is never lost, but stale QR money is held for owner review instead of auto-applied.

## Test I — Balance changes while payment is in progress

1. Generate a QR for an amount/category.
2. Before the payer completes payment, record another legitimate collection that reduces the same category balance.
3. Complete the provider payment.
4. Confirm CapDent does not over-credit.
5. Confirm the verified payment goes to reconciliation-required status.
6. Owner chooses Apply Current Due Only.
7. Confirm only the remaining genuine due is applied and any excess remains explicitly unresolved.

PASS: concurrent reception activity cannot create an overpayment in the ledger.

## Test J — Merchant disable after QR issuance

1. Generate a valid QR against a verified merchant account.
2. Disable that merchant account before the payer completes the already-created checkout.
3. Complete the payment.
4. Confirm CapDent still verifies the payment against the locked merchant identity.
5. Confirm no new QR can be created against the disabled account.

PASS: disabling blocks new collection but cannot make already-received money disappear.

## Test K — Provider failure

1. Generate a QR.
2. Complete a sandbox failure/cancel scenario.
3. Confirm the UI shows Payment failed or provider terminal state.
4. Confirm no financial payment ledger row is created.

PASS: failed provider transactions never become clinic collections.

## Test L — Owner reporting

After successful tests, open Verified Online Payments and Payment Review.

Verify for each payment:

- patient
- provider
- exact total
- receiving account label
- masked merchant ID
- category allocation
- date/time

PASS: owner can trace every verified online collection to a clinic receiving account and accounting category.

## Test M — Security / permissions

Confirm in MDMS:

- provider-event recorder is service-role only
- finalized-invoice reconciler is service-role only
- counter reconciler is service-role only
- merchant verification transition is service-role only
- owner/head doctor can manage merchant accounts
- receptionist cannot verify or change merchant accounts
- webhook remains custom-authenticated and does not trust the Android client to mark a payment paid

PASS: no authenticated client can spoof provider verification or reconciliation.

## Final production-release gate

Cut CapDent 1.2.8 / Android versionCode 28 only when:

- all applicable tests above pass
- `npm run check:v28:feature` passes
- `npm run check:v28:rc` passes after the version cut
- Android release AAB builds successfully
- release signing identity matches the existing Play Store application
- a final physical-device smoke test confirms login, patient search, normal billing, counter QR UX, reports, notifications, and existing v24/v27 core workflows have no regression

Record the tested clinic, merchant account label, test transaction IDs, category, amount, UTC timestamp, and result for each provider test. Do not commit credentials, secrets, OTPs, UPI PINs, API keys, webhook passwords, or full merchant credentials to GitHub.
