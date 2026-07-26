# CapDent v21 Clinical Notifications and Tooth Chart Plan

Date: 2026-07-27

## Protected baseline

- Protected branch: `release/capdent-v18`
- Protected commit: `e920d709d8b40133edbbcd4d1fffb17a46efc295`
- Isolated branch: `feature/capdent-v21-clinical-notifications`
- Protected release: CapDent `1.2.0`, Android version code `20`
- New release target: CapDent `1.2.1`, Android version code `21`
- Initial distribution target: Google Play Internal Testing only

The protected branch, PR #9, version-code 20 AAB, signing configuration, tags,
and production Supabase project are outside the mutation scope of this branch.

## Current architecture audit

### Mobile application

- Expo Router owns the route graph in `src/app/_layout.tsx`.
- Authentication and role routing are centralized in `src/lib/auth.tsx`.
- `src/app/patient/visit.tsx` is the current Add Visit screen. It has a
  sequential client-side save flow for visit, optional treatment/invoice,
  optional follow-up, and queue completion.
- The current visit path intentionally remains the fallback path. The new
  tooth-chart transaction is invoked only when both feature flags are enabled
  and the draft contains entries.
- Patient profile aggregation is handled by `src/app/patient/[id].tsx` and
  `getPatientById()` in `src/lib/supabase.ts`.
- Payment entry points already converge on valid inserts into
  `public.payments`, either directly or through existing fee RPCs. This makes
  the payment row the correct canonical notification event.
- Clinic currency/locale formatting is already isolated in
  `src/lib/clinicLocale.ts` and `src/lib/clinicPreferences.ts`.

### Supabase

- Core clinical and billing tables are clinic-scoped and protected by RLS.
- Existing public helper functions resolve the active authenticated user's
  clinic and role.
- Existing payment records include clinic, patient, invoice, collector,
  payment category, payment method, and amount where the deployed schema
  supports those columns.
- No push-token, notification-delivery, dental-chart, or chart-aware visit RPC
  currently exists.
- New public tables may not be exposed to the Data API automatically on current
  Supabase projects, so migrations must include explicit least-privilege grants
  in addition to RLS.
- Supabase Database Webhooks use asynchronous `pg_net` requests after row
  changes. The design uses a local outbox row inside the payment transaction and
  a post-commit webhook to the Edge Function; external HTTP is never part of
  payment success.

### Release and signing

- App configuration and deterministic validation currently pin `1.2.0` / `20`.
- Android signing is guarded by an exact SHA-1 verification script. The
  approved certificate remains unchanged for version code `21`.
- Android native output, credentials, keystores, Firebase files, and AABs are
  ignored and must never be committed.

## Safety invariants

1. Both features default to globally disabled and clinic disabled.
2. Existing clinics are never automatically enabled.
3. The current Add Visit save implementation remains callable and unchanged in
   behavior when charting is disabled or empty.
4. Payment saving never waits for notification delivery.
5. New database objects are additive; no existing rows are rewritten or
   backfilled.
6. Clinical chart history is append-only. Historical entries cannot be deleted
   or silently overwritten by application roles.
7. Receptionists cannot create or modify clinical chart entries.
8. No migration, Edge Function, webhook, secret, AAB, or Play release is
   applied or deployed without explicit approval.

## Implementation phases

### Phase 1: isolated release scaffolding

- Add v21 version/build scripts without modifying the protected commit.
- Install Expo SDK-compatible notification and SVG packages.
- Add global feature flags, both defaulting to `false`.
- Add clinic feature-setting readers with deny-by-default behavior.

### Phase 2: payment notification client

- Add Android channel and permission handling.
- Register and refresh Expo push tokens for owner/head-doctor devices only.
- Persist a per-install identifier, upsert only the authenticated user's token,
  and deactivate it during logout.
- Add foreground handling and safe notification-response routing to
  `/reports/payments`.
- Treat permission denial, Expo Go, offline state, missing FCM credentials, and
  token registration failures as non-fatal.

### Phase 3: payment notification backend preparation

- Add clinic-level `payment_push_enabled` default `false`.
- Add RLS-protected device tokens, notification outbox jobs, and idempotent
  per-device delivery records.
- Add an exception-safe payment trigger that only enqueues local work.
- Add a secured Edge Function for recipient resolution, Expo delivery,
  idempotency, ticket recording, retry state, receipt maintenance, and invalid
  token deactivation.
- Document the manual Database Webhook, function-secret, and maintenance
  schedule configuration. Do not deploy them.

### Phase 4: graphical chart and visit draft

- Add pure FDI tooth definitions, validation, summaries, and role helpers.
- Add an AsyncStorage-backed in-memory visit-draft provider.
- Add reusable SVG teeth, arches, legend, surface selector, editor modal, and
  summary components.
- Add the focused `/patient/tooth-chart` route with permanent/primary modes,
  single-tap editing, long-press multi-selection, and accessible non-color
  markers.
- Add only a compact summary card to Add Visit.

### Phase 5: chart persistence preparation

- Add clinic-level `tooth_chart_enabled` default `false`.
- Add append-only dental chart entries with FDI/status/surface constraints,
  RLS, and query indexes.
- Add an atomic `save_visit_with_tooth_chart` RPC with explicit authenticated
  clinic/role checks, multiple structured treatments, invoice/payment,
  follow-up, and queue completion.
- Keep the legacy client save path as the fallback.

### Phase 6: patient profile and history

- Add a flag-gated patient profile section.
- Show authorized clinical users current findings, treatment state, and recent
  history.
- Show receptionists only a limited treatment/billing summary.
- Reuse the chart route in read-only history mode.

### Phase 7: validation and release preparation

- Run clean dependency installation, TypeScript, Expo config, v21 validation,
  signing validation, unit tests, static Edge Function checks where tooling is
  available, SQL tests where a safe local database is available, and
  `git diff --check`.
- Build version-code 21 AAB locally only if the local environment remains safe.
- Do not upload or promote the artifact.

## Expected modified files

- `.env.example`
- `app.json`
- `eas.json`
- `package.json`
- `package-lock.json`
- `src/app/_layout.tsx`
- `src/app/patient/visit.tsx`
- `src/app/patient/[id].tsx`
- `src/lib/auth.tsx`
- `src/lib/supabase.ts`
- release/testing documentation and v21 validation scripts

## Expected new files

- `src/lib/featureFlags.ts`
- `src/lib/paymentNotifications.ts`
- `src/components/PaymentNotificationCoordinator.tsx`
- `src/lib/toothChart.ts`
- `src/lib/toothChart.test.ts`
- `src/lib/visitDraft.tsx`
- `src/app/patient/tooth-chart.tsx`
- `src/components/tooth-chart/DentalArch.tsx`
- `src/components/tooth-chart/ToothGraphic.tsx`
- `src/components/tooth-chart/ToothFindingSheet.tsx`
- `src/components/tooth-chart/ToothChartSummary.tsx`
- `src/components/tooth-chart/ToothChartLegend.tsx`
- `src/components/tooth-chart/ToothSurfaceSelector.tsx`
- `src/components/tooth-chart/PatientDentalChartSection.tsx`
- additive Supabase migrations created by the Supabase CLI
- `supabase/functions/send-payment-notification/*`
- database and Edge Function test files
- `docs/capdent-v21-progress.md`
- `docs/capdent-v21-release-checklist.md`
- `docs/capdent-v21-rollback-plan.md`

This list may be narrowed during implementation. Any additional file must remain
inside the isolated feature scope and be recorded in the progress ledger.
