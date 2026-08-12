# Production baseline reconciliation runbook

This runbook is intentionally conservative. Never use `db reset --linked` and
never test replay against the production project.

## 1. Prerequisites

1. Confirm the linked project is `mzjtdcpbvoximdukpukd`.
2. Confirm a restorable production backup and document whether PITR is enabled.
3. Start Docker Desktop and verify `docker version` reports a working daemon.
4. Obtain the production database password through an approved secret channel.
   Let the Supabase CLI prompt for it; do not put it in source, shell history,
   command arguments, chat, or an environment file.
5. Use a disposable local directory outside the repository for raw dumps.

## 2. Read-only capture

Review the installed CLI help before execution. With Supabase CLI 2.106.0, the
intended commands are:

```powershell
$reconcile = Join-Path $env:TEMP ("capdent-v25-reconcile-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $reconcile | Out-Null

# Allow the CLI to prompt for the database password.
supabase db dump --linked --file "$reconcile/application-schema.sql"
supabase db dump --linked --role-only --file "$reconcile/roles.sql"
supabase db dump --linked --schema auth --file "$reconcile/auth-schema.sql"
supabase db dump --linked --schema storage --file "$reconcile/storage-schema.sql"
supabase migration list --linked
```

Do not dump production data. Storage buckets, migration history, extension
versions, Auth/provider configuration, Edge Functions, Vault values and secrets
must be reconciled separately; a default schema dump does not capture them all.

## 3. Sanitization

Before moving any dump into version control:

- scan for passwords, connection strings, JWTs, secret/service-role keys,
  private keys, provider tokens, email credentials and patient data;
- remove managed credentials, role passwords and environment-specific endpoints;
- retain structural grants and role relationships only when safe;
- keep unsanitized raw dumps in the temporary directory and delete them through
  the approved secure-data process after reconciliation.

## 4. Canonical baseline construction

Do not rename the existing duplicate migration files in place. Build a separate,
uniquely versioned baseline for a fresh disposable environment. Preserve:

- exact production tables, columns, constraints, indexes and triggers;
- function signatures, bodies, `search_path`, execution grants and ownership;
- RLS enablement, policies and explicit Data API grants;
- storage bucket metadata and storage policies;
- extension names without pinning deprecated extension versions;
- publications and scheduled jobs;
- frozen portal-owned objects and shared-contract annotations.

Any repair of the production migration ledger requires a separate approval and
must not be bundled with V25 feature migrations.

## 5. Disposable replay

Replay only into a local stack or explicitly approved disposable Supabase branch.
Never use patient data. Verify:

1. blank replay succeeds;
2. a second replay is deterministic;
3. normalized tables, columns, constraints, indexes, functions, triggers, RLS,
   policies, grants, buckets, publications and extensions match this snapshot;
4. expected Supabase-managed differences are documented;
5. security and performance advisors are rerun;
6. V24 database contracts and RPC signatures remain available.

## 6. Exit criteria

Milestone 0 is complete only when:

- the canonical baseline is reproducible from an empty disposable environment;
- catalog comparison passes or every difference is approved and documented;
- portal-owned resources are preserved;
- backup/PITR/restore evidence is recorded;
- no secrets or PHI exist in committed artifacts;
- a reviewer approves the first additive V25 migration boundary.
