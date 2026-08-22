# CapDent V26 Production Checklist

This checklist is the release source of truth for `release/capdent-v26`.
V26 is based directly on the frozen V25 release branch. Do not merge `main` into this branch.

## Branch and version safety

- [x] Create `release/capdent-v26` directly from `release/capdent-v25`.
- [x] Set Expo app version to `1.2.6`.
- [x] Set Android `versionCode` to `26`.
- [x] Preserve package id `com.dms.clinic`.
- [x] Preserve Android compile/target SDK 36.
- [x] Preserve `package-lock.json` for deterministic installs.
- [ ] Run `npm ci` locally on the final branch.

## V25 regression protection

- [x] Preserve Firebase app and Analytics native integration.
- [x] Preserve Expo payment push notification integration.
- [x] Preserve `payments_coin_drop_v1` Android notification channel and coin-drop sound.
- [x] Preserve Google Play Billing integration.
- [x] Preserve dental chart dependencies and workflows.
- [x] Preserve V25 quota, consent, legal, upload and billing protections.
- [x] Preserve Production and Play Internal EAS profiles.
- [x] Preserve local signing credential policy.
- [x] Preserve Production API 36 target.
- [x] Keep Android AI chat out of scope.

## V26 release gates

- [x] Add `scripts/validate-capdent-v26.mjs`.
- [x] Wire all V26 Android build commands through `check:v26:rc`.
- [x] Wire GitHub Actions on `release/capdent-v26` to run `npm ci`, V26 validation/typecheck, `git diff --check`, and Expo config validation.
- [ ] Confirm the V26 GitHub Actions run completes successfully.
- [ ] Run `npm run check:v26` locally.
- [ ] Run `npm run check:v26:rc` from `release/capdent-v26` locally.
- [ ] Run `git diff --check` locally.
- [ ] Run Expo config inspection and confirm package/version/permissions/plugins locally.
- [ ] Verify approved Android signing certificate.
- [ ] Verify release Google Services configuration.
- [x] Verify EAS Production and Play Internal profiles retain app-bundle output, local versioning/signing policy, and separate Play tracks.

## Device smoke test

- [ ] Login/logout sanity.
- [ ] Existing owner/head-doctor account access.
- [ ] Clinic creation/onboarding/legal consent.
- [ ] Add patient and old patient.
- [ ] Patient profile edit/photo.
- [ ] Appointment create/reschedule.
- [ ] Dental chart and multi-visit treatment flow.
- [ ] Billing/payment collection and duplicate-submit protection.
- [ ] Google Play subscription product loading and purchase flow.
- [ ] Payment push registration and coin-drop notification.
- [ ] X-ray/photo/prescription upload and signed URL access.
- [ ] Quota card/preflight behavior.
- [ ] Firebase Analytics initialization behavior on the exact release build.

## Play Console release path

- [ ] Build V26 AAB using the `play-internal` profile first.
- [ ] Upload/submit V26 to Play Internal Testing.
- [ ] Install the exact Play-delivered build on a physical device.
- [ ] Complete device smoke test against production backend.
- [ ] Confirm no new crash/auth/billing/push regressions.
- [ ] Apply any separately approved V25/V26 production migration only during its explicit migration window.
- [ ] Re-test affected server-authoritative behavior after migration activation.
- [ ] Build/submit the final Production-track AAB only after all gates pass.

## Safety invariants

- Never merge the divergent `main` branch into V26.
- Do not delete or regenerate `package-lock.json` casually.
- Do not disable the signing validator to make a build pass.
- Do not lower Android target SDK below 36.
- Do not remove Firebase/push/billing dependencies inherited from V25.
- Do not run destructive Supabase operations as part of a mobile build.
- Do not submit directly to Production before testing the exact AAB through Play Internal.
