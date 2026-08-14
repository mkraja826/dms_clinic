# Backup, PITR and restore evidence

Evidence finalized on 2026-08-14 for Supabase project `mzjtdcpbvoximdukpukd`.

Status: VERIFIED FOR V25 LOGICAL RECOVERY

## Verified recovery path

- A schema-only production database export was captured read-only.
- A production public-data export was captured read-only.
- The public schema and public data were restored into a fresh disposable local Supabase database.
- Financial referential checks passed with no orphan patient references in payments or invoices.
- Durable `auth.users` and `auth.identities` were separately restored into the disposable environment because Supabase-managed Auth schema versions can differ between production and local images.
- All 17 restored CapDent profiles had matching restored Auth users.
- Production Storage metadata identified 367 objects across five CapDent buckets.
- All 367 objects were downloaded, verified by object count and recorded byte size, and restored into a fresh local Supabase Storage environment.
- An off-device copy of the recovery archive was stored in Google Drive. The production recovery files themselves are not committed to Git.

## Integrity evidence

The local recovery archive created during the drill had SHA-256:

`393B84E1B92FA87A8551B99FCD778DBB81EC6BBC22513523AB933312958C9CE3`

Storage verification:

- objects: 367 / 367
- missing: 0
- size mismatches: 0
- expected bytes: 368338467
- restored objects: 367

Auth verification:

- durable users: 24
- identities: 29
- CapDent profiles: 17
- profiles without Auth user: 0

## PITR limitation

The verified Supabase organization is on the Free plan. PITR is unavailable in the current plan configuration. V25 release recovery readiness is therefore based on the tested logical database + durable Auth + Storage backup/restore procedure above, not on PITR.

This evidence does not claim that transient Auth sessions, refresh tokens, MFA flow state, or one-time tokens are recoverable; they are intentionally regenerated through normal authentication flows after a recovery.
