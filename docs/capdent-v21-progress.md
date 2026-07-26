# CapDent v21 Progress Ledger

This file records implementation milestones without secrets, patient data, or
production identifiers.

## 2026-07-27: baseline and architecture audit

- Confirmed protected branch `release/capdent-v18` and protected commit
  `e920d709d8b40133edbbcd4d1fffb17a46efc295`.
- Confirmed protected CapDent `1.2.0`, Android version code `20`, package
  `com.dms.clinic`, and signing SHA-1 remain the baseline.
- Created isolated branch
  `feature/capdent-v21-clinical-notifications` directly from the protected
  commit.
- Confirmed the only pre-existing working-tree change is the generated
  `supabase/.temp/cli-latest` marker; it is excluded from feature scope.
- Audited Add Visit, patient profile, authentication/logout, route layout,
  payment insertion, clinic locale, Supabase RLS, release scripts, and signing
  validation.
- Confirmed payment rows are the canonical cross-screen event source.
- Confirmed the current Add Visit path must remain the fallback because it is a
  multi-step client save and currently supports one optional new treatment.
- Reviewed current Supabase changelog and documentation for Data API grants,
  RLS, Edge Functions, asynchronous Database Webhooks, and `pg_net`.
- Reviewed Expo SDK 57 notification requirements: Android channel creation
  before token acquisition, Android 13 permission handling, development-build
  requirement, token refresh listener, foreground handler, and response
  routing.
- No application behavior, production database, Edge Function, secret, AAB,
  Play release, protected branch, or PR was changed.

## 2026-07-27: isolated v21 release scaffolding

- Installed the Expo SDK 57-compatible `expo-notifications`, `expo-device`, and
  `react-native-svg` packages through Expo's compatibility installer.
- Set only the isolated branch to CapDent `1.2.1`, Android version code `21`.
- Added a dedicated notifications config plugin with the Android `payments`
  channel.
- Added global payment-push and tooth-chart kill switches to every build
  profile and `.env.example`; both remain `false`.
- Added dedicated v21 sync, prepare, and validation scripts while preserving
  the historical v18 scripts.
- Pointed v21 Android build helpers at the Internal Testing profile.
- Verified TypeScript, Expo public configuration, deterministic v21
  configuration, whitespace, and the approved Android signing SHA-1.
- No build was uploaded or promoted.

## 2026-07-27: payment notification implementation

- Added owner/head-doctor device registration with an app-install identifier,
  Android channel-before-permission handling, Expo project-scoped tokens,
  refresh handling, safe foreground behavior, safe payment-report tap routing,
  and best-effort logout deactivation.
- Permission denial, simulator/Expo Go, missing FCM setup, offline state,
  migration absence, and token failures are non-fatal.
- Added a clinic opt-in defaulting false, RLS-scoped device tokens, a payment
  outbox, and idempotent delivery/receipt audit.
- Added an exception-safe local payment trigger. It performs no HTTP and cannot
  make notification delivery part of payment success.
- Added an undeployed Edge Function with a separate webhook secret, server kill
  switch, collector exclusion, multiple-device delivery, retry/backoff,
  receipt maintenance, and invalid-token cleanup.
- Notification payloads contain amount and clinic name only, not patient or
  clinical details.
- Edge helpers pass 5 Deno tests and the full function passes `deno check`.

## 2026-07-27: interactive dental chart and atomic visit

- Added permanent and primary FDI definitions, normalization, summaries, and
  clinical-role helpers.
- Added reusable SVG tooth shapes with condition color plus symbols,
  check/cross marks, dashed borders, accessible labels, and 48px-class touch
  targets.
- Added single-tooth tap editing, long-press multi-selection, condition legend,
  surface selector, treatment link/status, notes, and mixed-dentition support.
- Added an AsyncStorage-backed visit draft keyed by patient/draft ID. The draft
  is cleared only after an atomic save succeeds.
- Added a compact Add Visit chart card after Chief Complaint. Disabled or
  empty charts continue through the existing legacy Add Visit path.
- Added an explicit treatment-state selector. The atomic path never infers
  treatment completion from follow-up presence.
- Added clinic opt-in defaulting false, append-only FDI chart history, clinical
  read access, no direct mobile writes, and a mutation-prevention trigger.
- Added an atomic RPC for visit, multiple treatments, invoices/payments,
  existing-treatment collection, chart rows, queue completion, and follow-up.
- Added full dentist history and receptionist-only treatment-status summary to
  patient profile.
- Pure tooth-chart logic passes 5 Deno tests.

## 2026-07-27: local Supabase verification

- Confirmed the protected repository's historical date-only migrations assume
  a preinstalled legacy schema and are not independently CLI-replayable.
- Added a guarded production-shaped, data-free local fixture only for the two
  v21 migrations. It verifies the exact Supabase Docker project label and local
  port before recreating the disposable local `public` schema.
- Both v21 migrations apply cleanly to that fixture.
- Supabase schema lint reports no public-schema errors.
- Payment notification and chart/atomic-visit suites pass all 45 pgTAP
  assertions, including disabled defaults, RLS/grants, local outbox behavior,
  multiple treatments, explicit status, existing-balance collection,
  append-only protection, queue/follow-up ordering, and cross-clinic rejection.
- No production or linked Supabase schema/data was changed.

## 2026-07-27: final local release validation

- Reinstalled the dependency graph from the committed lockfile with `npm ci`.
- Passed the v21 version/signing/disabled-flag guard, TypeScript, and all 20
  Expo Doctor checks.
- Passed the Android production JavaScript export: 1,714 modules bundled
  without a Metro error.
- Passed 5 tooth-chart tests, 5 notification-worker tests, Deno formatting and
  type checking, Supabase schema lint, and all 45 pgTAP assertions.
- `npm audit` reports zero critical/high findings. The remaining 11 moderate
  findings are in the inherited Expo/Xcode build-tool dependency chain; the
  available forced remediation would downgrade/break the Expo SDK and was not
  applied.
- A read-only hosted-project check confirms neither v21 migration nor
  `send-payment-notification` is deployed. A pre-existing
  `create-r2-upload-url` function is still hosted and requires a separate,
  explicitly approved production cleanup.
- The protected version-code 20 AAB remains at 85,736,347 bytes with SHA-256
  `3A771ACEF95944762F0AC3D92EA097035EA4A1954340EF3063FE0C6884F60851`.
- No v21 AAB was generated in the protected working directory. Its isolated
  build remains approval-gated until FCM credentials and hosted staging are
  ready.

## Status

- Architecture audit: complete
- Written implementation plan: complete
- Release scaffolding: complete
- Application implementation: complete
- Migrations: created and locally verified
- Local automated release checks: complete
- Internal Testing AAB: not built
- Migrations applied: no
- Edge Functions deployed: no
- Feature flags enabled: no
- Build 20 disturbed: no
