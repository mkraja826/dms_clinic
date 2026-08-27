# CapDent V28 Physical Test APK Build

This is the pre-release physical-device build path for CapDent V28. It deliberately keeps the app at the development release identity (`1.2.6`, Android `versionCode 27`) while enabling the same production-facing feature flags required for V28 testing.

## Safety rules

- Do not change `app.json` to `1.2.8` / `versionCode 28` for this test build.
- Do not use `build:android:production` or `build:android:play-internal` yet.
- Do not commit `credentials.json`, `.jks`, `google-services.json`, passwords, PhonePe credentials, or Firebase service-account JSON.
- The `v28-test` profile has no EAS submit profile and is intended only for direct APK installation.

## Local prerequisites

From the local repository root, confirm all of the following exist:

1. `credentials.json`
2. The Android keystore referenced by `credentials.json`
3. `google-services.json`, or a valid `GOOGLE_SERVICES_JSON` environment value
4. Java/keytool (Android Studio JBR is acceptable)
5. EAS CLI authenticated to the CapDent Expo account

The signing verification script requires the release signing certificate SHA-1:

`EC:7F:C4:82:FA:0B:AA:0F:8F:06:12:6D:D3:75:9B:99:2C:6D:1E:E6`

## Build sequence

```powershell
cd C:\dms
git fetch origin
git checkout feature/capdent-v28
git pull --ff-only origin feature/capdent-v28
npm ci
npx expo-doctor
npm run check:v28:feature
npm run verify:android-signing
npm run build:android:v28-test
```

The final command builds an internal-distribution APK using the `v28-test` EAS profile. That profile enables paid plans, Firebase Analytics, realtime, payment push, tooth chart, and signed storage URLs against the MDMS Supabase project, but does not run the V28 release-version gate.

## Before installing

Record the commit SHA used for the build:

```powershell
git rev-parse HEAD
```

Do not test an APK if the working tree contains uncommitted source/config changes:

```powershell
git status --short
```

Expected result: no output.

## Physical-device first-pass order

After installing the APK, test in this order:

1. Cold launch and splash.
2. Login and mandatory Terms/Privacy consent.
3. Owner/head-doctor dashboard and navigation.
4. Reception login and role restrictions.
5. Patient search/create/open patient.
6. Appointment/waiting-room workflow.
7. Dental chart and treatments.
8. Prescription creation/view/share.
9. X-ray/photo uploads and signed-image loading.
10. Manual OP/X-ray/medication/treatment billing.
11. Invoice view/PDF/share.
12. Collect-by-QR UI through the point where real provider credentials are required.
13. Payment Review, Verified Online Payments, and Reconciliation screens.
14. Push-notification registration and payment notification behavior.
15. Google Play subscription screen/recovery behavior where test-account conditions permit.
16. Background/foreground, network interruption, app restart, and small-screen keyboard/layout checks.

## Hard release boundary

This APK is evidence for physical regression only. It does not authorize the V28 production cut. `1.2.8 / versionCode 28` remains blocked until the required physical-device regression items and real PhonePe E2E certification are complete.
