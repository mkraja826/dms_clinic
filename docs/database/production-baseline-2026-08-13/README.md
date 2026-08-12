# CapDent production database baseline — 2026-08-13

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

The catalog is an inspection artifact rather than a `pg_dump`. It is sufficient
to expose drift and establish comparison contracts, but it is not yet a complete
restorable Supabase environment.

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

## Known blockers

1. The repository's 37 migration files are not a canonical replay chain.
2. Production contains 32 later migrations and several earlier identity/content
   differences.
3. Only eight local migration files matched production migration bodies under
   conservative newline normalization.
4. A schema-only `pg_dump` cannot currently be obtained: Docker is stopped,
   native PostgreSQL tools are absent, and the CLI lacks a database password.
5. Backup, PITR and restore readiness remain unverified.
6. Production security findings—including public clinical buckets, broad core
   table policies, and privileged RPC exposure—must be handled as separately
   reviewed compatibility changes, not folded into baseline recovery.

## Required completion gate

Follow [reconciliation-runbook.md](reconciliation-runbook.md). V25 database work
may resume only after an isolated environment can replay the authoritative
baseline and its normalized catalog matches this snapshot, with documented and
approved exclusions for Supabase-managed and portal-owned resources.
