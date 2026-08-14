# CapDent V25 replay evidence

Milestone 0 was closed on 2026-08-14 for Supabase project `mzjtdcpbvoximdukpukd` after local disposable recovery validation.

## Replay

- Reconstructed the required replay-only pre-ledger bootstrap for the production migration history.
- Replayed the bootstrap plus all 73 authoritative production migration identities successfully.
- Completed two catalog-complete replay passes with deterministic schema hashes.
- Catalog comparison produced zero unexplained application-owned drift.
- All 14 portal-owned migrations were preserved unchanged.
- One replay-only serialization repair was documented for production identity `20260727012628`; the captured production migration was not rewritten.

## Public database recovery

A fresh disposable local Supabase database restored the captured public schema and production public data successfully.

Restored row counts used as recovery evidence:

- clinics: 12
- profiles: 17
- patients: 353
- appointments: 540
- patient visits: 318
- payments: 761
- invoices: 736
- files: 334

Referential validation reported zero payments or invoices without patients and zero orphan payment or invoice patient references.

## Durable Auth recovery

Only durable Auth account records were included in the recovery drill; transient sessions, refresh tokens, MFA flow state, and one-time tokens were intentionally excluded.

- auth.users restored: 24
- auth.identities restored: 29
- public profiles: 17
- profiles without matching Auth user: 0

## Storage recovery

Five production Storage buckets were covered: `avatars`, `prescriptions`, `xrays`, `patient-files`, and `clinic-logos`.

- production Storage objects referenced by captured metadata: 367
- objects downloaded: 367
- missing objects: 0
- size mismatches: 0
- expected bytes: 368338467
- downloaded bytes: 368338467
- objects restored into a fresh local Supabase Storage environment: 367

## Recovery copy

A complete local recovery archive was created after the database/Auth/Storage drill and copied off-device to Google Drive. The archive itself is intentionally not committed to Git because it contains production data.

PITR remains unavailable on the current Supabase Free plan. Milestone 0 closure therefore relies on the demonstrated logical database, durable Auth, and Storage-object backup/restore process rather than PITR.
