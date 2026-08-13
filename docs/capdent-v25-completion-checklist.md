# CapDent V25 Completion Checklist

This checklist is the authoritative release-progress view for `release/capdent-v25`.
It supplements, but does not weaken, the production reconciliation runbook.

## Milestone 0 — production database reconciliation

- [x] Capture read-only production baseline outside `supabase/migrations`.
- [x] Verify 73 production migrations and baseline hashes.
- [x] Verify zero credential-pattern hits in committed baseline artifacts.
- [x] Classify the 14 portal-owned migrations from `20260807180754` through `20260807222138`.
- [x] Confirm Docker daemon can run locally.
- [ ] Replay the captured production history in an isolated disposable Supabase environment.
- [ ] Compare replay catalogs against the captured production catalogs and document every mismatch.
- [ ] Record replay evidence in `docs/database/production-baseline-2026-08-13/replay-evidence.md`.
- [ ] Obtain independent backup/PITR/restore-readiness evidence.
- [ ] Record backup/PITR evidence in `docs/database/production-baseline-2026-08-13/backup-pitr-evidence.md`.
- [ ] Set `manifest.json` `replay_ready=true` only after successful documented replay.
- [ ] Commit replay evidence as a separate small commit.
- [ ] Reviewer approves the first additive V25 migration boundary.

**Hard stop:** no additive V25 migration, migration repair, production `db push`, linked reset, destructive SQL, or production Edge deployment before Milestone 0 is cleared.

## V25 product foundation

- [x] Free-tier source of truth: 100 patients.
- [x] Free-tier upload source of truth: 150 uploads, warning at 120.
- [x] Free-tier storage source of truth: 1 GB.
- [x] Pricing terminology aligned to Free / Cloud / Intelligence.
- [x] Cloud fallback price aligned to ₹799/month.
- [x] Intelligence fallback price aligned to ₹1,499/month.
- [x] Pricing observation remains non-enforcing before reconciliation clearance.
- [x] Subscription UI consumes shared V25 limits/pricing constants.
- [ ] Server-authoritative quota enforcement migration after Milestone 0.
- [ ] Server-authoritative upload/storage usage accounting after Milestone 0.
- [ ] Grandfathering policy finalized and enforced server-side.

## Onboarding, legal, privacy, support

- [x] Mandatory Terms/Privacy acknowledgement in onboarding.
- [x] Indian State/UT field removed from V25 scope.
- [x] Country/currency/usual-hours preferences retained.
- [x] Privacy, Terms, deletion, guide, issue-reporting surfaces hardened.
- [x] External legal/support actions guarded against repeat taps and failures.
- [ ] Persist auditable consent evidence server-side after Milestone 0.

## Clinic settings and staff

- [x] Clinic preference/feature caches protected from accidental mutation.
- [x] Clinic creation RPC response validated on the client.
- [x] Clinic branding input validated before logo upload.
- [x] Existing staff invite creation protected from duplicate submit.
- [ ] Replace the two independent Account Settings writes with one transactional RPC after Milestone 0.
- [ ] Reassess staff role/removal mutations only after reconciliation clearance.
- [ ] Add `dental_assistant` database constraint/authorization support only through an approved additive migration.
- [ ] Design membership model separately; current production is one-user/one-clinic.

## Clinical workflow and uploads

- [x] Preserve production dental-chart requirement that `visit_id` is non-null.
- [x] Preserve V24 fallback visit workflow.
- [x] Image uploads remain optimized to WebP in current mobile tiers.
- [x] Storage URL resolution failures fail safely to the original URL.
- [x] Do not make existing public buckets private blindly.
- [ ] Local patch: guard appointment booking against immediate duplicate submit.
- [ ] Local patch: guard reschedule confirmation against immediate duplicate submit.
- [ ] Local patch: finish Gallery accessibility/interaction cleanup without changing storage policy.
- [ ] Local patch: finish clinic-branding screen save guard if still missing after branch sync.
- [ ] Decide high-quality ₹2,499 imaging entitlement outside Android AI scope before changing compression behavior.

## Notifications and billing

- [x] Push registration failures are contained.
- [x] Payment notification routing remains restricted to the safe payment report route.
- [x] Google Play purchase launch has an immediate in-flight guard.
- [x] Google Play callback product IDs are required and validated.
- [x] Purchase-listener async failures are routed through the UI error path.
- [x] Valid Cloud and Intelligence product handling remains unchanged.
- [ ] Run end-to-end Play test only at RC gate.

## Analytics

- [ ] Add Firebase Analytics only when the RC/native gate opens.
- [ ] Instrument privacy-minimized clinic/product events; never send patient names, phone numbers, diagnoses, notes, X-rays, photos, prescriptions, or other PHI as analytics parameters.
- [ ] Verify Analytics configuration separately from FCM push configuration.

## Portal / AI freeze

- [x] Treat migrations `20260807180754` through `20260807222138` as portal-owned.
- [x] Freeze portal AI tables/functions during mobile V25 reconciliation.
- [x] Freeze the five portal AI Edge Functions unless separately coordinated.
- [x] Android app does not add AI chat.

## Pre-RC verification

- [ ] Pull latest `release/capdent-v25` locally.
- [ ] Run `npm run check:v25`.
- [ ] Run `powershell -ExecutionPolicy Bypass -File scripts/database/verify-production-baseline.ps1`.
- [ ] Run `git diff --check`.
- [ ] Run `git status --short --branch` and confirm clean tree.
- [ ] Complete the four queued large-file local patches above.
- [ ] Repeat `npm run check:v25` and `git diff --check` after local integration.
- [ ] Perform V24 regression pass: login, onboarding, patient create/edit, old-patient import, visits, dental chart, payments, appointments, staff, gallery/uploads, prescriptions, notifications, subscription screen, logout.

## RC gate

Do not enter RC until Milestone 0 and the pre-RC verification section are complete.

- [ ] Set Android `versionCode` to 25 only at RC.
- [ ] Add/verify the V25 version-name decision.
- [ ] Wire Android build commands from `check:v21` to `check:v25:rc`.
- [ ] Run `npm run check:v25:rc`.
- [ ] Verify approved Android signing key.
- [ ] Verify EAS production/internal environment variables and Google Services secret file.
- [ ] Build Play Internal AAB.
- [ ] Install/test the exact AAB from Play Internal.
- [ ] Verify Firebase Analytics and push behavior on the release build.
- [ ] Final production-readiness review before any Production-track submission.

## Safety invariants

- Preserve V24 behavior until each V25 server feature is explicitly cleared.
- Extend existing `financial_adjustments`, `invoice_versions`, and audit structures; do not create duplicates.
- Keep production storage bucket visibility unchanged until a compatibility migration and URL strategy are approved.
- Never treat the captured SQL files under `docs/database/.../remote-migrations` as new repository migrations.
- No native Android/AAB work before the RC gate.
