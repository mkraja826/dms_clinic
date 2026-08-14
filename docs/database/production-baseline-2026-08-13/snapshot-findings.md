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

`READY_FOR_REVIEWED_V25_DATABASE_MIGRATIONS`

The synthesized recovery chain replays deterministically twice and the
application catalog matches the production capture after explicit platform
exclusions.

A subsequent recovery drill successfully restored the application database,
durable Auth records, and all 367 referenced Storage objects. Application
profile-to-Auth integrity also passed with 17 of 17 profiles linked to restored
Auth users.

The Milestone 0 recovery gate is closed and `replay_ready=true`.

The production project remains on Supabase Free without PITR. PITR and stronger
independently encrypted off-device backup handling remain recommended
operational hardening work.
