# CapDent v21 Internal Testing Release Checklist

Target: CapDent `1.2.1`, Android version code `21`

Branch: `feature/capdent-v21-clinical-notifications`

Distribution: Google Play Internal Testing only

This is an approval-gated checklist. Commands under the manual rollout section
are documentation only and have not been run against a hosted Supabase project.

## Protected release invariants

- [x] `release/capdent-v18` still points to
  `e920d709d8b40133edbbcd4d1fffb17a46efc295`.
- [x] PR #9, the version-code 20 AAB, tags, and protected artifacts are
  unchanged.
- [x] Android package is still `com.dms.clinic`.
- [x] Release signing SHA-1 is still
  `EC:7F:C4:82:FA:0B:AA:0F:8F:06:12:6D:D3:75:9B:99:2C:6D:1E:E6`.
- [x] No generated native directory, credential, keystore, Firebase file,
  patient data, or AAB is staged for Git.

## Code and local validation gates

- [x] `npm ci`
- [x] `npm run check:v21`
- [x] `npm run verify:android-signing`
- [x] `npx expo config --type public`
- [x] `npx expo-doctor` (20/20 checks)
- [x] Android production JavaScript export (1,714 modules)
- [x] `deno test --unstable-sloppy-imports src/lib/toothChart.test.ts`
- [x] `deno test supabase/functions/send-payment-notification/helpers_test.ts`
- [x] `deno check supabase/functions/send-payment-notification/index.ts`
- [x] Guarded disposable Supabase v21 fixture/migration run succeeds.
- [x] Both pgTAP suites under `supabase/tests/database` pass locally (45/45).
- [x] `git diff --check`
- [ ] Manual Android development-build test covers permission denied,
  offline token registration, foreground notification, notification tap, and
  logout deactivation.
- [ ] Manual chart test covers permanent/primary modes, single edit,
  multi-selection, draft restoration, atomic save, history, receptionist
  restriction, and failure preserving the draft.

The protected repository predates a CLI-replayable baseline: its early
date-only migration files assume `supabase/schema.sql` was already installed.
For the two new migrations, use the guarded local-only fixture runner:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-capdent-v21-supabase.ps1
```

It verifies the exact local Docker project label and port before recreating
only the disposable local `public` schema. It never links to or modifies a
hosted project.

## Disabled-by-default gates

- [ ] `EXPO_PUBLIC_ENABLE_PAYMENT_PUSH=false` in every committed EAS profile.
- [ ] `EXPO_PUBLIC_ENABLE_TOOTH_CHART=false` in every committed EAS profile.
- [ ] `PAYMENT_PUSH_ENABLED=false` when Edge Function secrets are first set.
- [ ] `clinics.payment_push_enabled` defaults to `false`.
- [ ] `clinics.tooth_chart_enabled` defaults to `false`.
- [ ] No existing clinic is backfilled or enabled by either migration.

## Manual hosted Supabase rollout - stop for approval

Do not use the production project for the first run. Substitute an approved
staging or Supabase preview-branch reference.

1. Confirm a recoverable database backup and record the migration list.
2. Link the CLI to the approved non-production project.
3. Run a migration dry run and review the exact SQL.
4. Apply, in order:
   - `20260726204205_capdent_v21_payment_notifications.sql`
   - `20260726205851_capdent_v21_dental_chart_atomic_visit.sql`
5. Run the pgTAP suites and Supabase security/performance advisors.
6. Create a strong `PAYMENT_NOTIFICATION_WEBHOOK_SECRET` outside the
   repository. Set function secrets with `PAYMENT_PUSH_ENABLED=false`.
7. Deploy `send-payment-notification`; keep it server-disabled.
8. In Database Webhooks, add an `INSERT` webhook for
   `public.payment_notification_jobs` to the function URL and send the secret
   in `x-capdent-webhook-secret`. Database Webhooks use asynchronous `pg_net`
   delivery after the database change, so payment success is not coupled to
   the HTTP request.
9. Configure a scheduled maintenance invocation using the same protected
   header and body `{"mode":"maintenance"}`. This processes due retries and
   Expo receipts. Store the header secret in Supabase Vault or another approved
   secret store.
10. Configure Android FCM v1 credentials through the approved Expo/EAS
    credential workflow. Never commit service-account JSON or
    `google-services.json`.
11. Smoke-test the unchanged app with both build flags still false.
12. For a dedicated version-code 21 Internal Testing build only, enable one
    global flag at a time. Do not change the production build profile.
13. Enable the matching clinic flag only for the approved testing clinic,
    Pavani Dental Clinic, after confirming its exact clinic UUID. Do not match
    or update by display name alone.
14. For payment push, enable `PAYMENT_PUSH_ENABLED=true` only after the webhook,
    FCM credentials, device registration, and disabled-state tests pass.
15. Complete the Internal Testing matrix before enabling the second feature.
16. Disable the clinic flag and server flag immediately after the controlled
    test until rollout approval.

## Exact isolated PowerShell AAB build

Build in a detached worktree so the protected version-code 20 output under the
current ignored `android` directory cannot be overwritten. Replace
`<v21-commit>` with the reviewed commit SHA.

```powershell
$BuildRoot = "C:\dms-v21-build"
$ArtifactRoot = "C:\dms-v21-artifacts"

Set-Location C:\dms
git worktree add --detach $BuildRoot <v21-commit>

Copy-Item -LiteralPath C:\dms\credentials.json -Destination $BuildRoot\credentials.json
Copy-Item -LiteralPath C:\dms\credentials -Destination $BuildRoot\credentials -Recurse

Set-Location $BuildRoot
npm ci
npm run check:v21
npm run verify:android-signing
npx expo prebuild --platform android --clean
npm run sync:v21-version

Set-Location "$BuildRoot\android"
.\gradlew.bat clean bundleRelease

New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null
Copy-Item -LiteralPath "$BuildRoot\android\app\build\outputs\bundle\release\app-release.aab" `
  -Destination "$ArtifactRoot\CapDent-1.2.1-versionCode21-internal.aab"
```

After verifying the AAB version, package, signing certificate, and hashes,
remove the detached worktree with `git worktree remove C:\dms-v21-build`.
Upload only to Google Play Internal Testing. Do not promote it.

## Stop conditions

Stop immediately if any of these occur:

- migration dry run contains destructive SQL or touches existing patient rows;
- either clinic feature flag defaults to true;
- payment insertion fails while notification processing is unavailable;
- an unauthorized role can read tooth-level chart entries;
- a mobile role can insert/update/delete chart history outside the RPC;
- notification payload contains patient name, diagnosis, or chart details;
- signing SHA-1 differs;
- the artifact reports any version code other than 21;
- the target track is not Internal Testing.
