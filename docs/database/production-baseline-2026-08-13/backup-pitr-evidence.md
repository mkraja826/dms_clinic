# Backup, PITR and restore evidence

Evidence finalized on 2026-08-14 for Supabase project
`mzjtdcpbvoximdukpukd` (`MDMS`).

Status: VERIFIED

## Recovery evidence

A production recovery drill was completed against a disposable local Supabase
environment without modifying the production project.

Verified results:

- Public application database restored successfully.
- Restored application counts included:
  - 12 clinics
  - 17 profiles
  - 353 patients
  - 540 appointments
  - 318 visits
  - 761 payments
  - 736 invoices
  - 334 file metadata records
- Payment and invoice patient-reference checks returned zero orphan records.
- Durable Supabase Auth records were restored separately:
  - 24 `auth.users`
  - 29 `auth.identities`
- All 17 CapDent profiles matched a restored Auth user.
- Seven Auth users had no application profile; this does not break the
  application profile-to-auth recovery chain.
- Production Storage backup contained 367 objects.
- All 367 objects were downloaded successfully.
- Expected Storage bytes: 368338467.
- Downloaded Storage bytes: 368338467.
- Missing objects: 0.
- Size mismatches: 0.
- All 367 objects were subsequently restored into the disposable local
  Supabase Storage environment.
- Local restored Storage metadata reported 367 objects.
- A recovery archive was created at approximately 369 MB.
- Recovery archive SHA-256:
  `393B84E1B92FA87A8551B99FCD778DBB81EC6BBC22513523AB933312958C9CE3`
- An off-device copy of the recovery archive was placed in Google Drive.

## PITR status

The production project remains on Supabase Free.

Automatic daily backups and Point-in-Time Recovery are not available under the
currently verified plan/configuration. This remains an operational hardening
limitation but does not invalidate the successfully demonstrated logical
database/Auth/Storage recovery procedure.

The off-device archive is not claimed to have independent client-side archive
encryption. Google Drive storage is being used as the off-device copy.

PITR and independently encrypted backup storage remain recommended production
hardening improvements.

## Recovery scope

The recovery procedure intentionally treats Supabase-managed components
separately:

1. application/public database data,
2. durable Auth account records (`auth.users` and `auth.identities`),
3. Storage bucket configuration and Storage objects.

Transient authentication state such as sessions, refresh tokens, one-time
tokens, MFA AMR claims and flow state is not required for durable account
recovery and was intentionally excluded from the durable Auth restore test.

## Gate decision

`PASS`

The V25 Milestone 0 recovery gate is satisfied.

The captured production baseline has a demonstrated application-data restore
path, durable Auth recovery path, Storage object recovery path, integrity
checks, and an off-device recovery copy.

`replay_ready=true`.

Future V25 database migrations may proceed through the normal reviewed
migration process. PITR and stronger independently encrypted backup handling
remain operational hardening work and must not be represented as currently
enabled.
