# Milestone 0 replay and catalog reconciliation

Validated locally on 2026-08-13 against the capture for production project
`mzjtdcpbvoximdukpukd`. All database resets targeted the disposable local
Supabase workspace. No linked reset, migration repair, database push or
production write was performed.

## Recovery chain

The reproducible local chain is:

1. synthetic `00000000000000_pre_ledger_bootstrap.sql` copied from
   [pre-ledger-bootstrap.sql](pre-ledger-bootstrap.sql);
2. all 73 production ledger identities, in order: 72 captured bodies plus the
   documented replay-only serialization repair for `20260727012628`;
3. one generated, synthetic
   `99999999999999_replay_only_catalog_completion.sql` produced outside the
   repository by
   `scripts/database/build-replay-only-catalog-completion.mjs`.

The local migration ledger therefore has 75 rows. The first and last rows are
recovery-only and must be excluded when comparing it with the 73-row production
ledger. Neither recovery artifact belongs in `supabase/migrations`.

### Pre-ledger objects reconstructed

- Extension prerequisite: `pgcrypto`.
- Public tables, in dependency order: `clinics`, `profiles`, `staff_invites`,
  `patients`, `medical_history`, `appointments`, `patient_visits`, `treatments`,
  `files`, `invoices`, `payments`, `patient_audit_logs`, `charges`,
  `clinic_subscriptions`, `google_play_subscription_events`,
  `medication_catalog`, `patient_medications`, and `website_appointments`.
- Each table's recovered base primary keys, foreign keys, unique constraints,
  base check constraints, defaults and RLS-enabled flag are in the bootstrap.
  Columns added by one of the 73 migrations are deliberately absent.
- Storage configuration rows: `avatars`, `clinic-logos`, `patient-files`,
  `prescriptions`, and `xrays`; no Storage objects are included.
- Helper functions required by the ledger: `current_clinic_id`, `current_role`,
  `can_manage`,
  `current_profile_clinic_id`, `current_profile_role`,
  `current_user_is_head_doctor`, `generate_invite_code`, `invoice_status`,
  `apply_dms_clinic_isolation_policy`, `create_staff_invite`,
  `owner_update_staff_access`, and `rls_auto_enable`.

The bootstrap is a minimal, synthesized recovery contract, not an assertion
that all of these objects were created in one historical transaction.

### Captured migration serialization repair

The captured body for migration `20260727012628` is not parseable because four
statement terminators are absent. For disposable replay only, the same-name
repository migration was substituted. After whitespace normalization, the only
differences are those four semicolons. The substituted file has SHA-256
`978DA4FF0FB6B6E9C860CD025C5F4E9B886195851CBFC4FF2AEC3D0AECA8D85B`.
The captured production file and hash manifest remain unchanged.

## Replay results

- Bootstrap plus all 73 ledger identities (72 captured bodies and one approved
  replay-only serialization repair): pass from an empty database.
- Immediate second empty reset of the same chain: pass.
- Final chain including generated catalog completion, pass 1: pass.
- Immediate second reset of the final chain, pass 2: pass.
- All 14 portal-owned migrations were replayed unchanged.

The final schema dumps were byte-for-byte deterministic across the last two
resets:

| Schema dump | Pass 1 SHA-256 | Pass 2 SHA-256 |
| --- | --- | --- |
| Auth | `749F9B5A4713F1A7B1DB366D8ED98163F8C9CB19EA4202DF92DADB198AEACE6A` | `749F9B5A4713F1A7B1DB366D8ED98163F8C9CB19EA4202DF92DADB198AEACE6A` |
| Public | `5AD6301228D29A1991E7CBA8BF753BDA31D6EFCFEA030AB14810E366711A1E6A` | `5AD6301228D29A1991E7CBA8BF753BDA31D6EFCFEA030AB14810E366711A1E6A` |
| Storage | `E85F0B4980661A35D8D46A98765102282EFD2011AF17A3F3CB63A31C67D2B0EA` | `E85F0B4980661A35D8D46A98765102282EFD2011AF17A3F3CB63A31C67D2B0EA` |

## Catalog completion scope

The 73-row ledger does not encode the complete final production catalog. The
guarded generator reads the immutable captured JSON catalogs and emits a
disposable-only completion containing:

- 31 production-only indexes and the captured definition of one drifted index;
- 18 production-only functions and the exact final definitions of 11 bootstrap
  functions whose synthesized bodies differed;
- final function execution ACLs, including `service_role`;
- nine production-only policies;
- captured public table grants, the existing public sequence ACL, and captured
  default privileges.

The generator refuses to write anywhere inside the repository. Two independent
generations produced SHA-256
`4A0228388C06986001E9999923C5F7642F30C5093E4C3F10FCE8B510FA3A9187`.

## Final application catalog comparison

| Category | Production | Replay | Unexplained application drift |
| --- | ---: | ---: | ---: |
| Public tables | 36 | 36 | 0 |
| Public columns | 446 | 446 | 0 |
| Public constraints | 198 | 198 | 0 |
| Public indexes | 175 | 175 | 0 |
| Public functions | 94 | 94 | 0 |
| Policies | 57 | 57 | 0 |
| Triggers | 28 | 28 | 0 |
| Storage buckets | 5 | 5 | 0 functional differences |
| Extensions | 7 | 7 | 0 version differences |
| Public views/materialized views | 0 | 0 | 0 |
| Public custom types | 0 | 0 | 0 |
| Public sequences | 1 | 1 | 0 |
| Cron jobs | 2 | 2 | 0 |
| Comments | 18 | 18 | 0 |
| Default-privilege rows | 47 | 47 | 0 |

The 94 function signatures, definitions, security-definer flags, languages,
volatility, parallel mode, owner, search path and execution ACLs match exactly.
The application `supabase_realtime` publication and its members
(`appointments`, `invoices`, `payments`, `treatments`) also match exactly.

## Approved platform and capture exclusions

- Local Storage has 18 additional table-grant rows and 108 additional
  column-grant rows on `storage.iceberg_namespaces` and
  `storage.iceberg_tables`. They are owned by `supabase_storage_admin` and are
  current Storage-runtime objects; they must not be revoked for parity.
- All five bucket definitions match semantically. Their `created_at` and
  `updated_at` values differ because local rows are created at reset time.
- `pg_net` version `0.20.3` matches, but production installed it in `public`
  while the current local platform image installs the non-relocatable extension
  in `extensions`.
- The platform-owned dynamic publication
  `supabase_realtime_messages_publication` and its date partitions differ by
  environment and capture date. It is not an application migration object.
- The sequence catalog JSON rounded bigint maximum
  `9223372036854775807` to `9223372036854776000`. The production schema dump
  says `NO MAXVALUE`, which matches the local bigint sequence; no DDL repair is
  appropriate.

After these explicit exclusions, there is no unexplained application-owned
catalog drift.

## Gate decision

Replay and application catalog reconciliation are complete.

The subsequent V25 recovery drill verified restoration of the application
database, durable Auth records, and all 367 referenced Storage objects in a
disposable local Supabase environment. All 17 application profiles retained a
matching restored Auth user.

Milestone 0 is therefore CLOSED and `replay_ready=true`.

The current Supabase Free plan still does not provide PITR. PITR and stronger
independently encrypted off-device backup handling remain operational
hardening recommendations rather than claims of currently enabled capability.
See [../backup-pitr-evidence.md](../backup-pitr-evidence.md).
