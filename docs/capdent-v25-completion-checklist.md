# CapDent V25 Completion Checklist

This checklist is the authoritative release-progress view for `release/capdent-v25`.
It supplements, but does not weaken, the production reconciliation runbook.

## Milestone 0 — production database reconciliation

- [x] Capture read-only production baseline outside `supabase/migrations`.
- [x] Verify 73 production migrations and baseline hashes.
- [x] Verify zero credential-pattern hits in committed baseline artifacts.
- [x] Classify the 14 portal-owned migrations from `20260807180754` through `20260807222138`.
- [x] Confirm Docker daemon can run locally.
- [x] Replay the captured production history in an isolated disposable Supabase environment.
- [x] Compare replay catalogs against the captured production catalogs and document every mismatch.
- [x] Record replay evidence under `docs/database/production-baseline-2026-08-13/replay/`.
- [x] Obtain independent backup/restore-readiness evidence.
- [x] Record backup/restore evidence in `docs/database/production-baseline-2026-08-13/backup-pitr-evidence.md`.
- [x] Set `manifest.json` `replay_ready=true` after successful documented replay.
- [x] Commit replay/recovery evidence in dedicated V25 commits.
- [x] Clear the additive V25 migration boundary for repository development; production application remains deferred until the release migration step.

**Milestone 0 status:** CLOSED. Repository V25 migration work may proceed, but no production `db push`, linked reset, destructive SQL, or production Edge deployment is permitted without the explicit release migration step.

## V25 product foundation

- [x] Free-tier source of truth: 100 patients.
- [x] Free-tier upload source of truth: 150 uploads, warning at 120.
- [x] Free-tier storage source of truth: 1 GB.
- [x] Pricing terminology aligned to Free / Cloud / Intelligence.
- [x] Cloud fallback price aligned to ₹799/month.
- [x] Intelligence fallback price aligned to ₹1,499/month.
- [x] Pricing observation remains non-enforcing before production migration activation.
- [x] Subscription UI consumes shared V25 limits/pricing constants.
- [x] Observed entitlement counts are clamped to safe non-negative values.
- [x] Server-authoritative quota/consent migration exists in the V25 branch and is rollout-gated.
- [x] Client preflight exists for patient creation, old-patient creation, clinical uploads, and patient profile photos.
- [x] Owner quota card shows patient/upload/storage usage and near-limit states.
- [ ] Apply the approved V25 quota/consent migration to production after the production AAB is built and release migration window opens.
- [ ] Activate server-authoritative upload/storage usage accounting in production.
- [ ] Finalize and activate the grandfathering policy server-side.

## Onboarding, legal, privacy, support

- [x] Mandatory Terms/Privacy acknowledgement in onboarding.
- [x] Existing signed-in users have a current-version legal-consent gate.
- [x] Indian State/UT field removed from V25 scope.
- [x] Country/currency/usual-hours preferences retained.
- [x] Privacy, Terms, deletion, guide, issue-reporting surfaces hardened.
- [x] External legal/support actions guarded against repeat taps and failures.
- [x] Auth callback can retry safely after a failed callback attempt.
- [x] Client/server consent helpers and versioned consent evidence are implemented in the V25 migration.
- [ ] Verify consent persistence end-to-end after the production migration is applied.

## Clinic settings and staff

- [x] Clinic preference/feature caches protected from accidental mutation.
- [x] Clinic creation RPC response validated on the client.
- [x] Clinic branding input validated before logo upload.
- [x] Clinic branding save guarded against duplicate submit.
- [x] Existing staff invite creation protected from duplicate submit.
- [x] Staff role/access changes guarded against duplicate mutations.
- [x] Malformed/null `owner_update_staff_access` RPC responses are validated and rejected on the client.
- [x] Account Settings fields are saved in one atomic `clinics` row update with response validation and cache invalidation.
- [ ] Reassess staff role/removal server authorization only during a separately approved authorization review.
- [ ] Add `dental_assistant` database constraint/authorization support only through an approved additive migration.
- [ ] Design membership model separately; current production is one-user/one-clinic.

## Clinical workflow and uploads

- [x] Preserve production dental-chart requirement that `visit_id` is non-null.
- [x] Preserve V24 fallback visit workflow.
- [x] Preserve V24 ongoing-treatment vs new-treatment workflow and multi-visit treatment behavior.
- [x] Image uploads remain optimized to WebP in current mobile tiers.
- [x] Storage URL resolution failures fail safely to the original URL.
- [x] Do not make existing public buckets private blindly.
- [x] Guard appointment booking against immediate duplicate submit.
- [x] Guard reschedule confirmation against immediate duplicate submit.
- [x] Guard clinical upload against immediate duplicate submit.
- [x] Gallery accessibility/interaction cleanup completed without changing storage policy.
- [x] Gallery delete actions are guarded per file against duplicate deletion.
- [x] Patient profile-photo upload verifies the patient belongs to the current clinic before upload and cleans up a new object if linking fails.
- [x] Final active-code sweep found no remaining old 300-patient/V18/V24 pricing copy in current V25 UI paths.
- [ ] Decide high-quality ₹2,499 imaging entitlement outside Android AI scope before changing compression behavior.

## Notifications and billing

- [x] Push registration failures are contained.
- [x] Payment notification routing remains restricted to the safe payment report route.
- [x] Google Play purchase launch has an immediate in-flight guard.
- [x] Google Play callback product IDs are required and validated.
- [x] Purchase-listener async failures are routed through the UI error path.
- [x] Valid Cloud and Intelligence product handling remains unchanged.
- [x] Quick Check-in remains RPC-backed and preserves V24 pending-fee-first behavior.
- [x] Payment collection remains RPC-backed with overpayment and duplicate-submit guards.
- [ ] Run end-to-end Play billing/push tests only at the RC/device gate.

## Analytics

- [x] Privacy-safe Firebase Analytics wrapper added.
- [x] Firebase Analytics coordinator mounted in the application layer.
- [x] Analytics collection defaults off and remains environment-flagged.
- [x] Analytics parameters are limited to privacy-minimized app/product metadata; no patient names, phone numbers, diagnoses, notes, X-rays, photos, prescriptions, or other PHI are intentionally sent.
- [x] Analytics initialization is serialized before first event logging.
- [x] Native Firebase Analytics package/plugin and native adapter are present in the V25 branch.
- [x] Workflow taxonomy includes app/screen, quota, consent, patient registration, and clinical upload outcomes without patient identifiers.
- [ ] Verify Analytics configuration separately from FCM push configuration on the exact release build.

## Portal / AI freeze

- [x] Treat migrations `20260807180754` through `20260807222138` as portal-owned.
- [x] Freeze portal AI tables/functions during mobile V25 reconciliation.
- [x] Freeze the five portal AI Edge Functions unless separately coordinated.
- [x] Android app does not add AI chat.

## Pre-RC verification

- [x] Pull latest `release/capdent-v25` locally for the previously verified pre-RC pass.
- [x] Run `npm run check:v25` successfully on the previously synchronized tree.
- [x] Run `powershell -ExecutionPolicy Bypass -File scripts/database/verify-production-baseline.ps1` successfully.
- [x] Run `git diff --check` successfully on the previously synchronized tree.
- [x] `npm run check:v25:rc` passed after Milestone 0 closure and V25 consent/quota foundation integration.
- [ ] Pull the latest GitHub branch and re-run typecheck, `check:v25:rc`, Expo config, and `git diff --check` after all GitHub-only changes land.
- [ ] Perform V24 regression pass: login, onboarding, patient create/edit, old-patient import, visits, ongoing/new treatment selection, dental chart, payments, appointments, Quick Check-in, staff, gallery/uploads, prescriptions, notifications, subscription screen, logout.

## RC gate

Do not submit a Production-track build until the latest branch passes the local/device gates below.

- [x] Android `versionCode` is 25.
- [ ] Add/verify the final V25 version-name decision.
- [x] Android validation commands are wired to `check:v25:rc`.
- [x] `npm run check:v25:rc` has passed on the previously synchronized V25 RC state.
- [ ] Verify approved Android signing key on the final synchronized branch.
- [ ] Verify EAS production/internal environment variables and Google Services file.
- [ ] Build Play Internal AAB.
- [ ] Install/test the exact AAB from Play Internal.
- [ ] Verify Firebase Analytics and push behavior on the release build.
- [ ] Apply/activate the approved V25 production migration after the AAB build according to the release migration plan.
- [ ] Re-test quota and consent behavior against production after migration activation.
- [ ] Final production-readiness review before any Production-track submission.

## Safety invariants

- Preserve V24 behavior unless an existing behavior is conclusively proven defective; report suspected regressions before changing established clinical workflows.
- Extend existing `financial_adjustments`, `invoice_versions`, and audit structures; do not create duplicates.
- Keep production storage bucket visibility unchanged until a compatibility migration and URL strategy are approved.
- Never treat the captured SQL files under `docs/database/.../remote-migrations` as new repository migrations.
- Keep V25 server enforcement rollout-gated until the explicit production migration/activation step.
