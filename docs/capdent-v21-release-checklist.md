# CapDent v22 Production Rollout Checklist

Target: CapDent `1.2.2`, Android version code `22`

Branch: `feature/capdent-v21-clinical-notifications`

Status on 2026-07-27: billing, payment push, and tooth charting are enabled in
the v22 release profiles and for all current and future clinics. EAS Firebase
client and FCM v1 credentials are configured.

## Protected release invariants

- [x] `release/capdent-v18` remains unchanged at
  `e920d709d8b40133edbbcd4d1fffb17a46efc295`.
- [x] Android package remains `com.dms.clinic`.
- [x] Android version code is `22`.
- [x] Release signing SHA-1 is
  `EC:7F:C4:82:FA:0B:AA:0F:8F:06:12:6D:D3:75:9B:99:2C:6D:1E:E6`.
- [x] No keystore, service-account JSON, Firebase file, patient data, or AAB
  is committed.

## Automated validation

- [x] `npm run check:v21`
- [x] `npm run verify:android-signing`
- [x] `npx expo-doctor` (20/20)
- [x] `deno check` for the purchase verifier and lifecycle synchronizer
- [x] Disposable local Supabase migration run and schema lint
- [x] Four pgTAP suites, 60/60 assertions
- [x] `git diff --check`
- [x] Signed v22 production AAB build
- [x] Google `bundletool validate` for v22
- [x] AAB manifest independently confirms `com.dms.clinic`, version `1.2.2`,
  and version code `22`
- [x] AAB signing certificate independently confirms the approved SHA-1

Current verified v22 artifact (ignored by Git):

- `dist/CapDent-v1.2.2-v22-production.aab`
- 56,115,061 bytes
- ARM64 and ARMv7 device architectures
- SHA-256
  `C85691E586C8ADE07B958890F3D5A3B20540C445C8BECF1D7A3B712B83BE6462`

Previous verified v21 artifact (ignored by Git):

- `dist/CapDent-v1.2.1-v21-production.aab`
- 90,302,241 bytes
- SHA-256
  `1BD30DE9CD2499366452C8DF571B36B2B51258C9310E56221781AD13B54F597C`

## Production Supabase state

- [x] Payment notification tables/trigger/RLS migration applied.
- [x] Atomic dental chart migration applied.
- [x] Post-commit payment dispatcher migration applied.
- [x] Google Play lifecycle reconciliation migration applied.
- [x] `send-payment-notification` version 3 is active.
- [x] `verify-google-play-subscription` version 6 is active with JWT auth.
- [x] `sync-google-play-subscriptions` version 6 is active.
- [x] Payment dispatcher secret is stored separately in Edge secrets and Vault.
- [x] Payment push server switch is enabled.
- [x] Google Play lifecycle sync is enabled and runs hourly.
- [x] Android Publisher API is enabled in Google Cloud project `capdent`.
- [x] The dedicated Play service account is active, limited to CapDent, and
  stored in Supabase Edge secrets.
- [x] Production billing health check reached `subscriptionsv2` and returned
  `authorized: true`.
- [x] Payment retry/receipt maintenance runs every five minutes.
- [x] Both server dispatchers returned HTTP 200 in production smoke tests.
- [x] The retired `create-r2-upload-url` Edge Function is deleted; production
  uploads use Supabase Storage only.
- [x] All five obsolete R2 Edge secret values are removed from Supabase.
- [x] All 12 existing clinics have payment push and tooth charting enabled.
- [x] New clinics default to payment push and tooth charting enabled.
- [x] Production currently has zero linked Google Play subscriptions.

The production advisor's three missing foreign-key indexes were added. Its
remaining v21 security warning is intentional: the authenticated
`save_visit_with_tooth_chart` RPC is `SECURITY DEFINER`, has a fixed search
path, and validates the authenticated active profile, clinic, role, patient,
doctor, and payload before performing the atomic transaction.

## App release configuration

- [x] Production and Play Internal profiles enable server-verified Google Play
  billing.
- [x] Production submission profile targets the Google Play Production track.
- [x] Cloud fallback price is aligned with the live India price: ₹800/month.
- [x] Intelligence remains ₹1,499/month.
- [x] Payment push and tooth chart are enabled in Production and Play Internal
  builds; development and preview builds remain isolated.
- [x] The default build command remains Play Internal as a safety guard.
- [x] Explicit production build and submit commands exist.

## External blockers

### Google Play production access

Google Play reports 12 opted-in closed testers, but only 6 continuous days.
Production access requires at least 12 testers for 14 continuous days, followed
by Google's production-access review. The Apply button is currently disabled.
No code or Supabase change can bypass this gate.

### Android push credentials

The Firebase client file is stored as the production EAS secret-file variable
`GOOGLE_SERVICES_JSON`. The matching `mi-dms` Admin SDK key is attached to
`com.dms.clinic` as the EAS FCM v1 service credential. The Expo account has
Admin access to the existing project
`666248db-ff00-4a45-bbbf-65455c109dad`.

## Release commands

Internal safety build:

```powershell
npm run build:android:play-internal
```

Production build after both external gates and the push test matrix are clear:

```powershell
npm run build:android:production
npm run submit:android:production
```

Do not run the production submit command while Google Play Production access is
inactive. Android cannot replace a published version with the same or a lower
version code.

## Manual gates still required

- [ ] Production-access application becomes available and is approved.
- [x] Correct Expo/EAS project access is restored.
- [x] Firebase Android client and FCM Admin SDK files are validated locally.
- [x] FCM v1 and client-file credentials are uploaded to the existing EAS
  project.
- [ ] Billing purchase/renewal/cancel/grace/hold/expiry tests pass with licensed
  Google Play testers.
- [ ] Push device and delivery matrix passes on a signed Android build.
- [x] Production-wide database activation is verified for all 12 clinics.
- [x] Production v22 AAB package, version, signing certificate, and hashes are
  independently verified before upload.
