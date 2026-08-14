# Disposable replay artifacts

This directory contains recovery infrastructure for local Milestone 0 replay.
It is deliberately outside `supabase/migrations` and is never production input.

## `pre-ledger-bootstrap.sql`

The bootstrap reconstructs the 18 public tables and the 12 helper functions
that the 73-entry production ledger references without creating.
It contains no tenant rows, Auth users, patient data or storage objects. The
five `storage.buckets` rows are configuration metadata needed for later
authoritative migrations to reproduce production bucket settings.

This is a synthetic consolidated recovery artifact, not a claim that every
object existed at `20260704104435`. Provenance is mixed:

- the pre-ledger core came from Git commit `c9630c24abb559e8e14d216e57a918dcc260360b`,
  particularly `supabase/schema.sql` (blob `7a44888942a84a6601c0e0662c18a9769e7f6a8d`)
  and `supabase/dms-v1.1-clinic-ready.sql` (blob
  `13556726f8a53ee783c67f16ca10bf3daaa24b3a`);
- later out-of-ledger prerequisites were recovered from repository patch files
  and the read-only production schema/catalog captured on 2026-08-13;
- final columns that are added by one of the 73 migrations are intentionally
  omitted, so those migrations still exercise their DDL.

Both recovery SQL artifacts require the local role sentinel
`capdent.replay_workspace=v25-production-baseline-2026-08-13` and abort before
DDL when it is absent. Use the guarded runner with a newly initialized,
unlinked, empty workspace named `capdent-v25-replay-*` outside the repository:

```powershell
powershell -ExecutionPolicy Bypass `
  -File scripts/database/run-v25-baseline-replay.ps1 `
  -Workspace "$replay"
```

The runner starts only that local Supabase project and writes a disposable
`supabase/roles.sql` globals seed containing the sentinel. Each `--local` reset
therefore reinstalls the guard after recreating roles and before applying the
bootstrap. It then stages the recovery chain, runs two resets and saves logs
plus schema hashes outside the repository. The local ledger contains two
documented recovery rows, which must be excluded from the 73-row production
comparison.

## Known authoritative-capture defect

The recovered file
`remote-migrations/20260727012628_activate_capdent_v22_features.sql` is not
parseable: four terminating semicolons are absent. The production ledger entry
reports a statement-array source (`sql_chars=842`), while the repository's
same-name migration is 850 characters and differs only by those four
terminators after whitespace normalization. For local replay only, use the
tracked file at `supabase/migrations/20260727012628_activate_capdent_v22_features.sql`
as a documented serialization repair. Do not alter the captured production
file or its hash record.

Until replay completes twice, catalogs match, backup/PITR evidence is recorded,
and this exception is reviewed, `ReplayReady` remains false.

## Final-state catalog completion

The production ledger also omits final-state indexes, functions, policies and
grants. The guarded runner generates the recovery-only completion after staging
the bootstrap and the 73 ledger identities. For inspection-only regeneration in
an already guarded disposable workspace, use:

```powershell
node scripts/database/build-replay-only-catalog-completion.mjs `
  --workspace "$replay"
```

The generator canonicalizes the workspace and migration directory, rejects
links/junctions and linked-project state, writes a fixed new file exclusively,
and refuses any destination inside the repository. Its output is derived from
the captured catalogs and must never be copied into the application migration
directory or pushed to production.

The final two-pass results, catalog counts, exclusions and gate decision are in
[reconciliation-result.md](reconciliation-result.md). Replay and catalog
reconciliation now pass, but backup/restore readiness was explicitly skipped
and remains a Milestone 0 blocker. `ReplayReady` therefore remains false.
