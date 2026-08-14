# CapDent production database baseline â€” 2026-08-13

This directory is a read-only, secret-scanned snapshot of the linked Supabase
project `mzjtdcpbvoximdukpukd` (`MDMS`). It exists to reconcile the production
database before CapDent V25 migrations are designed.

## Safety classification

- `remote-migrations/` is deliberately outside `supabase/migrations/`.
- Nothing in this directory is an auto-applied migration.
- Do not copy these files into `supabase/migrations/`, run `migration repair`,
  squash history, or push them to production without an approved reconciliation
  plan and a verified backup/restore path.
- The snapshot contains schema metadata and SQL definitions, not table rows,
  patient records, Auth users, storage objects, Vault values, or provider secrets.
- Credential-pattern scans found no likely literal secrets at capture time.

## Captured artifacts

- `migration-ledger.json`: all 73 production migration identities and hashes.
- `remote-migrations/`: recovered SQL statements for all 73 ledger entries.
- `catalog/tables.json`: public/storage tables, columns, RLS flags, and metadata.
- `catalog/constraints-indexes.json`: constraints and indexes.
- `catalog/functions.json`: public RPC/function signatures, definitions and grants.
- `catalog/policies-grants.json`: RLS policies plus table/column privileges.
- `catalog/runtime-objects.json`: triggers, buckets, extensions and publications.
- `catalog/views-types-sequences.json`: views, custom types and sequences.
- `catalog/scheduled-jobs.json`: pg_cron definitions.
- `catalog/edge-functions.json`: deployed function metadata and code hashes only.
- `catalog/advisors.json`: Supabase security and performance advisor findings.

The catalog remains an inspection artifact rather than a production-data
backup. Schema-only dumps were captured outside the repository and used to
validate the disposable replay; neither artifact is a complete restorable
Supabase production environment.

## Production fingerprint

At capture time:

- PostgreSQL server version number: `170006`
- Migration count: `73`
- First migration: `20260704104435`
- Latest migration: `20260807222138`
- Project status: `ACTIVE_HEALTHY`

Migration files use LF line endings for review portability. The manifest records
both the production source MD5 and the expected normalized snapshot-file MD5.
All 73 files were verified against the normalized hashes.

## Ownership boundary

The 14 production migrations from `20260807180754` through `20260807222138`
are provisionally owned by the separate owner web portal. Their tables, RPCs and
five `capdent-ai*` Edge Functions are frozen for Android V25 unless ownership is
explicitly transferred.

The portal also reads shared clinical tables, including `clinics`, `profiles`,
`patients`, `appointments`, `patient_visits`, `treatments`, `files`, `payments`,
`invoices`, `financial_adjustments`, and `dental_chart_entries`. V25 changes to
those contracts must be additive and portal-regression reviewed.

## Current reconciliation status

1. A synthesized pre-ledger bootstrap plus all 73 ledger identities now replays
   twice from an empty disposable local database. This is 72 captured bodies
   plus one verified replay-only serialization repair for `20260727012628`.
2. A guarded, generated replay-only catalog completion closes application-owned
   final-state gaps. After documented platform exclusions, the production and
   replay application catalogs match with no unexplained drift.
3. The captured `20260727012628` body required a documented four-semicolon
   serialization repair for replay only.
4. The production organization remains on Supabase Free and PITR is not
   available under the verified configuration.
5. A V25 recovery drill subsequently restored the public application database,
   durable Auth users/identities, and all 367 referenced Storage objects.
6. All 17 restored application profiles matched a restored Auth user.
7. An off-device recovery archive was retained and the recovery gate was
   approved for V25 migration work.
6. Production security findingsâ€”including public clinical buckets, broad core
   table policies, and privileged RPC exposureâ€”must be handled as separately
   reviewed compatibility changes, not folded into baseline recovery.

See [replay/reconciliation-result.md](replay/reconciliation-result.md) and
[backup-pitr-evidence.md](backup-pitr-evidence.md).

## Required completion gate

Follow [reconciliation-runbook.md](reconciliation-runbook.md). V25 database work
may resume only after an isolated environment can replay the authoritative
baseline, its normalized catalog matches this snapshot with approved
exclusions, backup and restore readiness is verified, and the synthetic recovery
artifacts plus serialization repair are reviewed. The required recovery and reconciliation checks have now been completed and the manifest is explicitly set to `replay_ready=true`.
