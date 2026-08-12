# Snapshot findings and V25 gates

## Material production facts

- Production is PostgreSQL 17 and contains 36 public tables with RLS enabled.
- It has live invoice-version, financial-adjustment and audit infrastructure that
  V25 must extend rather than duplicate.
- `profiles` still models one user and one non-null clinic; no membership layer
  exists.
- `dental_assistant` is absent from profile and invitation constraints.
- Dental-chart entries still require a visit.
- No V25 usage, reservation, consent, chart-session, handover, feedback or
  minimum-version tables exist.

## Security blockers requiring separate compatibility work

- Five storage buckets, including clinical buckets, currently report `public=true`.
- Core patient, appointment, visit, treatment, file, invoice and payment policies
  permit same-clinic `ALL` operations without role predicates.
- `website_appointments` has no clinic identifier and permits authenticated global
  reads.
- The security advisor reports 67 authenticated-callable `SECURITY DEFINER`
  functions requiring authorization-body review.
- Leaked-password protection is disabled.

These issues are not permission to change production immediately. Each remediation
must preserve V24 behavior, be tested on the canonical replay, and have rollback
and storage-URL compatibility plans.

## Release gate status

`BLOCKED_FOR_V25_DATABASE_MIGRATIONS`

The read-only catalog and migration statements are now recovered and protected,
but a restorable schema dump, backup/PITR evidence and disposable replay are still
missing. App-only work that depends on future database contracts should also wait
to avoid designing against the wrong schema.
