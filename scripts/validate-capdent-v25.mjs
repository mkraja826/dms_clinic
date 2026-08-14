import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const isGitTracked = (path) => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V25_RC === "true";
const app = readJson("app.json");
const pkg = readJson("package.json");
const eas = readJson("eas.json");
const firebaseConfig = readJson("firebase.json");
const appConfig = readText("app.config.js");
const environmentExample = readText(".env.example");
const manifestPath =
  "docs/database/production-baseline-2026-08-13/manifest.json";
const replayEvidencePath =
  "docs/database/production-baseline-2026-08-13/replay/reconciliation-result.md";
const backupEvidencePath =
  "docs/database/production-baseline-2026-08-13/backup-pitr-evidence.md";
const manifest = readJson(manifestPath);
const backupEvidence = existsSync(backupEvidencePath)
  ? readText(backupEvidencePath)
  : "";
const backupEvidenceStatuses = [
  ...backupEvidence.matchAll(/^Status:\s*([A-Z_]+)\s*$/gm),
].map((match) => match[1]);
const limits = readText("src/lib/v25Limits.ts");
const pricing = readText("src/lib/pricingV2.ts");
const subscriptionScreen = readText("src/app/settings/subscription.tsx");
const billing = readText("src/lib/googlePlayBilling.ts");
const supabaseClient = readText("src/lib/supabase.ts");
const featureFlags = readText("src/lib/featureFlags.ts");
const addVisit = readText("src/app/patient/visit.tsx");
const auth = readText("src/lib/auth.tsx");
const paymentClient = readText("src/lib/paymentNotifications.ts");
const chart = readText("src/lib/toothChart.ts");
const visitDraft = readText("src/lib/visitDraft.tsx");
const paymentMigration = readText(
  "supabase/migrations/20260726204205_capdent_v21_payment_notifications.sql"
);
const chartMigration = readText(
  "supabase/migrations/20260726205851_capdent_v21_dental_chart_atomic_visit.sql"
);
const dispatchMigration = readText(
  "supabase/migrations/20260726220338_capdent_v21_payment_notification_dispatch.sql"
);
const googlePlaySyncMigration = readText(
  "supabase/migrations/20260726221134_capdent_v21_google_play_subscription_sync.sql"
);
const v22ActivationMigration = readText(
  "supabase/migrations/20260727012628_activate_capdent_v22_features.sql"
);
const paymentFunction = readText(
  "supabase/functions/send-payment-notification/index.ts"
);
const googlePlayVerifier = readText(
  "supabase/functions/verify-google-play-subscription/index.ts"
);
const googlePlaySync = readText(
  "supabase/functions/sync-google-play-subscriptions/index.ts"
);
const paymentFunctionHelpers = readText(
  "supabase/functions/send-payment-notification/helpers.ts"
);
const supabaseConfig = readText("supabase/config.toml");
const analytics = readText("src/lib/firebaseAnalytics.ts");
const nativeAnalyticsAdapter = readText(
  "src/lib/firebaseAnalyticsAdapter.native.ts"
);
const analyticsCoordinator = readText(
  "src/components/FirebaseAnalyticsCoordinator.tsx"
);
const paymentCoordinator = readText(
  "src/components/PaymentNotificationCoordinator.tsx"
);
const accountScreen = readText("src/app/settings/account.tsx");
const accountSettings = readText("src/lib/clinicAccountSettings.ts");

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(
  app.expo?.android?.versionCode === 25,
  "V25 requires Android versionCode 25."
);
expect(app.expo?.version === "1.2.3", "Expo version must remain 1.2.3.");
expect(pkg.version === "1.2.3", "package.json version must remain 1.2.3.");
expect(
  eas.cli?.appVersionSource === "local",
  "EAS local app versioning must remain authoritative."
);
expect(
  pkg.dependencies?.["@supabase/supabase-js"],
  "Supabase client dependency must remain present."
);
expect(
  pkg.dependencies?.["@react-native-firebase/app"] === "26.2.0" &&
    pkg.dependencies?.["@react-native-firebase/analytics"] === "26.2.0",
  "React Native Firebase app and analytics must remain pinned to matching V25-approved versions."
);
expect(
  pkg.scripts?.["build:android:apk"]?.includes("check:v25:rc") &&
    pkg.scripts?.["build:android:play-internal"]?.includes("check:v25:rc") &&
    pkg.scripts?.["build:android:production"]?.includes("check:v25:rc"),
  "All Android build commands must run the strict V25 RC gate."
);

const notificationPlugin = app.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications"
);
expect(
  notificationPlugin?.[1]?.defaultChannel === "payments",
  "Expo notifications must configure the payments Android channel."
);
expect(
  pkg.dependencies?.["expo-notifications"]?.startsWith("~57."),
  "Use the Expo SDK 57-compatible notifications package."
);
expect(
  pkg.dependencies?.["expo-device"]?.startsWith("~57."),
  "Use the Expo SDK 57-compatible device package."
);
expect(
  Boolean(pkg.dependencies?.["react-native-svg"]),
  "react-native-svg must remain installed for the dental chart."
);

for (const profileName of [
  "development",
  "preview",
  "production",
  "play-internal",
]) {
  const profile = eas.build?.[profileName];
  expect(
    profile?.credentialsSource === "local",
    `${profileName} must use the approved local signing credential.`
  );
  expect(
    profile?.autoIncrement === false,
    `${profileName} must keep deterministic local versioning.`
  );
  expect(
    profile?.environment ===
      (profileName === "play-internal" ? "production" : profileName),
    `${profileName} must resolve the intended EAS environment.`
  );
  for (const flag of [
    "EXPO_PUBLIC_ENABLE_PAYMENT_PUSH",
    "EXPO_PUBLIC_ENABLE_TOOTH_CHART",
  ]) {
    const expectedValue =
      profileName === "production" || profileName === "play-internal"
        ? "true"
        : "false";
    expect(
      profile?.env?.[flag] === expectedValue,
      `${flag} must be ${expectedValue} in ${profileName}.`
    );
  }
}

expect(
  eas.build?.development?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false" &&
    eas.build?.preview?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false",
  "Development and preview builds must not expose paid checkout."
);
expect(
  eas.build?.production?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true" &&
    eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS ===
      "true",
  "Play Internal and Production profiles must enable server-verified Google Play billing."
);
expect(
  eas.build?.["play-internal"]?.android?.buildType === "app-bundle" &&
    eas.build?.production?.android?.buildType === "app-bundle",
  "Play Internal and Production profiles must remain configured for Android App Bundles."
);
expect(
  eas.submit?.["play-internal"]?.android?.track === "internal" &&
    eas.submit?.production?.android?.track === "production",
  "Android submission profiles must retain their approved Play tracks."
);
expect(
  environmentExample.includes("EXPO_PUBLIC_ENABLE_PAYMENT_PUSH=false") &&
    environmentExample.includes("EXPO_PUBLIC_ENABLE_TOOTH_CHART=false"),
  "Example environment must keep payment push and tooth chart features disabled."
);
expect(
  featureFlags.includes("PAYMENT_PUSH_GLOBALLY_ENABLED") &&
    featureFlags.includes("TOOTH_CHART_GLOBALLY_ENABLED"),
  "Central payment-push and tooth-chart kill switches must remain present."
);
expect(
  existsSync("scripts/verify-android-signing.mjs"),
  "Android signing verification must remain present."
);
expect(
  existsSync("scripts/validate-capdent-v18.mjs") &&
    existsSync("scripts/prepare-capdent-v18-build.mjs"),
  "Protected V18 validation helpers must remain present."
);
expect(
  pkg.scripts?.["build:android:play-internal"]?.includes(
    "--profile play-internal"
  ) &&
    pkg.scripts?.["build:android:production"]?.includes(
      "--profile production"
    ) &&
    pkg.scripts?.["submit:android:production"]?.includes(
      "--profile production"
    ) &&
    pkg.scripts?.["build:android"] === "npm run build:android:play-internal",
  "Production build/submit commands must remain configured while Internal Testing stays the safe default."
);

expect(
  limits.includes("patientLimit: 100"),
  "V25 Free patient limit must remain 100."
);
expect(
  limits.includes("uploadLimit: 150"),
  "V25 Free upload limit must remain 150."
);
expect(
  limits.includes("uploadWarningAt: 120"),
  "V25 upload warning threshold must remain 120."
);
expect(
  limits.includes("storageLimitBytes: 1024 * 1024 * 1024"),
  "V25 Free storage limit must remain 1 GB."
);
expect(
  pricing.includes('import { CAPDENT_V25_LIMITS } from "@/lib/v25Limits"'),
  "Pricing fallback must use the shared V25 limits source."
);
expect(
  pricing.includes("patientLimitEnforced: false"),
  "Pre-reconciliation pricing fallback must remain non-enforcing."
);
expect(
  subscriptionScreen.includes("FREE_PATIENT_LIMIT") &&
    !subscriptionScreen.includes("300 patients") &&
    !subscriptionScreen.includes("Cloud: ₹800"),
  "Subscription UI must use V25 patient/pricing sources without stale 300-patient or ₹800 copy."
);
expect(
  billing.includes("monthlyAmount: 799") && billing.includes("monthlyAmount: 1499"),
  "Google Play fallback prices must remain ₹799 and ₹1,499."
);
expect(
  billing.includes("googlePlayPurchaseLaunchInFlight") &&
    billing.includes("unrecognized CapDent subscription product"),
  "Google Play purchase launch and product validation guards must remain present."
);
expect(
  paymentClient.includes("getExpoPushTokenAsync({ projectId })") &&
    paymentClient.includes("PAYMENT_NOTIFICATION_CHANNEL_ID") &&
    paymentClient.includes("permission-denied"),
  "Payment push registration must remain project-scoped, channel-first, and non-fatal."
);
expect(
  paymentClient.includes('profile?.role === "owner"') &&
    paymentClient.includes('profile?.role === "head_doctor"'),
  "Only owner/head-doctor devices may register for payment push."
);
expect(
  auth.includes("deactivateCurrentDevicePushToken(session?.user.id)") &&
    auth.indexOf("deactivateCurrentDevicePushToken(session?.user.id)") <
      auth.indexOf('supabase.auth.signOut({ scope: "local" })'),
  "Logout must deactivate the current installation before local sign-out."
);
expect(
  paymentCoordinator.includes("isSafePaymentNotificationData") &&
    paymentCoordinator.includes('router.push("/reports/payments"'),
  "Notification taps must accept only the safe payment-report route."
);
expect(
  paymentMigration.includes(
    "add column if not exists payment_push_enabled boolean not null default false"
  ) &&
    paymentMigration.includes("exception") &&
    paymentMigration.includes("return new;"),
  "Payment migration must remain disabled by default and isolate enqueue errors from payment writes."
);
expect(
  paymentMigration.includes("enable row level security") &&
    paymentMigration.includes("revoke all on table") &&
    paymentMigration.includes("grant select on table"),
  "Payment-notification tables must retain RLS and explicit Data API grants."
);
expect(
  paymentFunction.includes(
    'requiredEnv("PAYMENT_NOTIFICATION_WEBHOOK_SECRET")'
  ) &&
    paymentFunction.includes('Deno.env.get("PAYMENT_PUSH_ENABLED")') &&
    paymentFunction.includes("SUPABASE_SERVICE_ROLE_KEY"),
  "Payment delivery must retain its custom secret, server kill switch, and server-only service role."
);
expect(
  dispatchMigration.includes("create extension if not exists pg_net") &&
    dispatchMigration.includes("create extension if not exists pg_cron") &&
    dispatchMigration.includes("capdent_payment_notification_webhook_secret") &&
    dispatchMigration.includes("payment_notification_jobs_dispatch_after_insert") &&
    dispatchMigration.includes("capdent-payment-notification-maintenance"),
  "Payment dispatch must remain post-commit, Vault-authenticated, and scheduled for retries."
);
expect(
  dispatchMigration.includes("dental_chart_entries_patient_id_idx") &&
    dispatchMigration.includes(
      "payment_notification_deliveries_recipient_user_id_idx"
    ) &&
    dispatchMigration.includes(
      "payment_notification_deliveries_device_token_id_idx"
    ),
  "Production-advisor foreign keys must retain their covering indexes."
);
expect(
  googlePlaySyncMigration.includes("capdent_google_play_sync_secret") &&
    googlePlaySyncMigration.includes("capdent-google-play-subscription-sync") &&
    googlePlaySyncMigration.includes("'17 * * * *'"),
  "Google Play lifecycle reconciliation must remain Vault-authenticated and hourly."
);
expect(
  googlePlaySync.includes('requiredEnv("GOOGLE_PLAY_SYNC_SECRET")') &&
    googlePlaySync.includes('Deno.env.get("GOOGLE_PLAY_SYNC_ENABLED")') &&
    googlePlaySync.includes("/purchases/subscriptionsv2/tokens/") &&
    googlePlaySync.includes("capdent-health-check-invalid-token") &&
    googlePlaySync.includes("urn:ietf:params:oauth:grant-type:jwt-bearer") &&
    googlePlaySync.includes("google_play_last_verified_at"),
  "Billing lifecycle sync must stay server-authenticated, health-checkable, and Google-verified."
);
expect(
  googlePlayVerifier.includes("/purchases/subscriptionsv2/tokens/") &&
    googlePlayVerifier.includes("urn:ietf:params:oauth:grant-type:jwt-bearer") &&
    googlePlayVerifier.includes("google_play_last_verified_at"),
  "Initial Google Play verification must remain server-authenticated and persist verification time."
);
expect(
  billing.includes("iap.fetchProducts") &&
    billing.includes('type: "subs"') &&
    billing.includes("iap.getSubscriptions"),
  "Google Play subscription loading must support current and legacy native billing APIs."
);
expect(
  paymentFunction.includes('.neq("id", collectorId') &&
    !paymentFunction.includes("DeviceNotRegistered") &&
    paymentFunctionHelpers.includes("DeviceNotRegistered"),
  "Payment delivery must exclude the collector and retire unregistered devices."
);
expect(
  supabaseConfig.includes("[functions.send-payment-notification]") &&
    supabaseConfig.includes("[functions.sync-google-play-subscriptions]") &&
    supabaseConfig.match(/verify_jwt = false/g)?.length >= 2,
  "Server-dispatched Edge Functions must retain documented custom-secret authentication."
);

expect(
  chart.includes("FDI_ARCHES") &&
    chart.includes("PERMANENT_UPPER") &&
    chart.includes("PRIMARY_UPPER"),
  "The chart must retain permanent and primary FDI arches."
);
expect(
  visitDraft.includes("AsyncStorage") &&
    visitDraft.includes("Preserve the other dentition"),
  "Visit chart drafts must persist safely and retain mixed-dentition support."
);
expect(
  addVisit.includes("toothChartEnabled && visitDraft.findings.length > 0") &&
    addVisit.includes("saveVisitWithToothChart") &&
    addVisit.includes("await visitDraft.clear()") &&
    addVisit.indexOf("await visitDraft.clear()") >
      addVisit.indexOf("await saveVisitWithToothChart"),
  "Only non-empty enabled charts may use the atomic RPC, and drafts may clear only after success."
);
expect(
  addVisit.includes("const visit = await createVisit({"),
  "The legacy Add Visit fallback must remain available."
);
expect(
  chartMigration.includes(
    "add column if not exists tooth_chart_enabled boolean not null default false"
  ) &&
    chartMigration.includes("Dental chart history is append-only") &&
    chartMigration.includes("save_visit_with_tooth_chart"),
  "Chart migration must default disabled, retain append-only history, and use its atomic RPC."
);
expect(
  v22ActivationMigration.includes(
    "alter column payment_push_enabled set default true"
  ) &&
    v22ActivationMigration.includes(
      "alter column tooth_chart_enabled set default true"
    ) &&
    v22ActivationMigration.includes("payment_push_enabled = true") &&
    v22ActivationMigration.includes("tooth_chart_enabled = true"),
  "Existing V22 activation semantics must remain intact for existing and future clinics."
);
expect(
  chartMigration.includes("p_treatments jsonb") &&
    chartMigration.includes(
      "Every treatment requires an explicit valid status"
    ) &&
    !chartMigration.includes(
      "p_next_appointment_date is null then 'completed'"
    ),
  "The atomic visit RPC must preserve explicit treatment statuses without follow-up inference."
);
expect(
  existsSync("docs/capdent-v21-release-checklist.md") &&
    existsSync("docs/capdent-v21-rollback-plan.md") &&
    existsSync("docs/capdent-v21-supabase-runbook.md"),
  "Release, rollback, and Supabase approval-gate documentation must remain present."
);
expect(
  existsSync("scripts/test-capdent-v21-supabase.ps1") &&
    existsSync("supabase/tests/fixtures/capdent_v21_minimal_schema.sql") &&
    existsSync(
      "supabase/tests/database/capdent_v21_payment_dispatch_test.sql"
    ) &&
    existsSync(
      "supabase/tests/database/capdent_v21_google_play_sync_test.sql"
    ),
  "The guarded disposable local Supabase regression harness must remain present."
);

expect(
  firebaseConfig?.["react-native"]?.analytics_auto_collection_enabled === false,
  "Firebase Analytics automatic collection must default off."
);
expect(
  firebaseConfig?.["react-native"]
    ?.google_analytics_automatic_screen_reporting_enabled === false,
  "Firebase automatic screen reporting must remain disabled; CapDent uses sanitized screen categories."
);
expect(
  firebaseConfig?.["react-native"]?.google_analytics_adid_collection_enabled === false &&
    firebaseConfig?.["react-native"]
      ?.google_analytics_default_allow_ad_personalization_signals === false,
  "Firebase advertising ID collection and ad-personalization signals must remain disabled."
);
expect(
  environmentExample.includes("EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS=false"),
  "Example environment must keep Firebase Analytics disabled by default."
);
const firebaseAppPlugin = app.expo?.plugins?.find(
  (plugin) => plugin === "@react-native-firebase/app"
);
const analyticsPlugin = app.expo?.plugins?.find(
  (plugin) =>
    Array.isArray(plugin) && plugin[0] === "@react-native-firebase/analytics"
);
expect(
  Boolean(firebaseAppPlugin) &&
    analyticsPlugin?.[1]?.ios?.withoutAdIdSupport === true,
  "Expo config must install native Firebase with iOS Ad ID support disabled."
);
expect(
  app.expo?.android?.blockedPermissions?.includes(
    "com.google.android.gms.permission.AD_ID"
  ),
  "Android must remove the advertising ID permission contributed by dependencies."
);
expect(
  appConfig.includes("process.env.GOOGLE_SERVICES_JSON") &&
    appConfig.includes("./google-services.json") &&
    appConfig.includes("googleServicesFile"),
  "Expo config must accept a local or EAS Firebase Android service file."
);
expect(
  !isGitTracked("google-services.json") &&
    !isGitTracked("android/app/google-services.json"),
  "Firebase Android service files must remain outside version control."
);
if (existsSync("google-services.json")) {
  const googleServices = readJson("google-services.json");
  const androidPackages = (googleServices.client ?? []).map(
    (client) => client?.client_info?.android_client_info?.package_name
  );
  expect(
    googleServices?.project_info?.project_id === "mi-dms" &&
      androidPackages.includes("com.dms.clinic"),
    "Local Firebase client config must be project mi-dms for com.dms.clinic."
  );
}
expect(
  readText(".gitignore").includes("google-services.json") &&
    readText(".gitignore").includes("*-firebase-adminsdk-*.json"),
  "Firebase client and Admin SDK files must remain ignored."
);
const buildProfiles = Object.values(eas.build || {});
expect(
  buildProfiles.length > 0 &&
    buildProfiles.every(
      (profile) =>
        profile?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "false"
    ),
  "Every EAS build profile must keep Firebase Analytics disabled by default."
);
expect(
  analytics.includes("EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS") &&
    analytics.includes("ad_storage: false") &&
    analytics.includes("ad_user_data: false") &&
    analytics.includes("ad_personalization: false"),
  "Firebase Analytics must stay build-flagged with advertising consent disabled."
);
expect(
  !analytics.includes("setUserId(") &&
    !analytics.includes("patient_id") &&
    !analytics.includes("clinic_id") &&
    !analytics.includes("payment_reference"),
  "Analytics wrapper must not transmit user, patient, clinic, or payment identifiers."
);
expect(
  nativeAnalyticsAdapter.includes(
    'from "@react-native-firebase/analytics"'
  ) &&
    nativeAnalyticsAdapter.includes("configureFirebaseAnalyticsAdapter({") &&
    !nativeAnalyticsAdapter.includes("setUserId") &&
    !nativeAnalyticsAdapter.includes("setUserPropert") &&
    !nativeAnalyticsAdapter.includes("initiateOnDeviceConversion"),
  "Native Firebase adapter must be installed without identity, user-property, or conversion APIs."
);
expect(
  analytics.includes("SAFE_ANALYTICS_ROLES") &&
    analytics.includes("SAFE_ANALYTICS_SCREENS") &&
    analytics.includes("SAFE_ANALYTICS_EVENTS") &&
    analytics.includes("sanitizeParams(eventName, params)"),
  "Analytics events must retain runtime role, screen, and parameter allowlists."
);
expect(
  analyticsCoordinator.includes('"capdent_app_ready"') &&
    analyticsCoordinator.includes('"capdent_screen_view"') &&
    analyticsCoordinator.includes("installFirebaseAnalyticsAdapter();") &&
    paymentCoordinator.includes("FirebaseAnalyticsCoordinator"),
  "Privacy-safe analytics coordinator must be mounted in the app runtime."
);

expect(
  accountScreen.includes("updateClinicAccountSettings({") &&
    !accountScreen.includes("Promise.allSettled") &&
    !accountScreen.includes("Settings partially saved"),
  "Account Settings must save through one atomic client request without partial-save states."
);
expect(
  (accountSettings.match(/\.update\(updates\)/g) || []).length === 1 &&
    accountSettings.includes('.from("clinics")') &&
    accountSettings.includes("invalidateClinicFeatureSettingsCache();") &&
    accountSettings.includes("invalidateClinicPreferencesCache();") &&
    accountSettings.includes("The saved clinic settings response was malformed."),
  "Atomic Account Settings helper must use one validated clinics update and invalidate both caches."
);

expect(
  manifest.project_ref === "mzjtdcpbvoximdukpukd",
  "Production baseline must remain tied to the approved Supabase project."
);
expect(
  manifest.migration_count === 73,
  "Captured production baseline must still record 73 migrations."
);
expect(
  manifest.secret_scan?.credential_pattern_hits === 0,
  "Production baseline must remain free of credential-pattern hits."
);

const migrationDir = "supabase/migrations";
const lastCapturedMigration = String(manifest.last_migration || "20260807222138");
const newerMigrations = existsSync(migrationDir)
  ? readdirSync(migrationDir)
      .filter((name) => /^\d+.*\.sql$/i.test(name))
      .filter((name) => name.slice(0, 14) > lastCapturedMigration)
  : [];

if (manifest.replay_ready !== true) {
  expect(
    newerMigrations.length === 0,
    `No additive V25 migration may exist before replay_ready=true. Found: ${newerMigrations.join(", ")}`
  );
  expect(
    supabaseClient.includes("unlimited: true") &&
      supabaseClient.includes('level: "none"'),
    "Patient creation must remain fail-open before replay_ready=true; do not enforce the V25 quota client-side."
  );
  notes.push("Milestone 0 remains closed: production replay is not yet marked ready.");
}

if (rcMode) {
  expect(
    manifest.replay_ready === true,
    "RC mode requires manifest replay_ready=true after documented disposable replay."
  );
  expect(
    existsSync(replayEvidencePath),
    "RC mode requires committed replay evidence."
  );
  expect(
    existsSync(backupEvidencePath),
    "RC mode requires independent backup/PITR evidence."
  );
  expect(
    backupEvidenceStatuses.length === 1 &&
      backupEvidenceStatuses[0] === "VERIFIED",
    "RC mode requires backup/PITR evidence with an explicit `Status: VERIFIED` gate."
  );
  expect(
    app.expo?.android?.versionCode === 25,
    "RC mode requires Android versionCode 25."
  );
  expect(
    pkg.scripts?.["build:android:play-internal"]?.includes("check:v25:rc"),
    "RC mode requires Android build commands to run the strict V25 gate."
  );
  expect(
    pkg.dependencies?.["@react-native-firebase/app"] &&
      pkg.dependencies?.["@react-native-firebase/analytics"],
    "RC mode requires React Native Firebase app and analytics dependencies to be installed with the lockfile updated."
  );
  expect(
    analyticsPlugin?.[1]?.ios?.withoutAdIdSupport === true,
    "RC mode requires the Firebase Analytics Expo plugin with iOS Ad ID support disabled."
  );
} else {
  notes.push(
    `Pre-RC mode: Android versionCode is ${app.expo?.android?.versionCode ?? "unknown"}.`
  );
  notes.push(
    "Native Firebase Analytics is installed but collection remains explicitly disabled in every build profile."
  );
}

if (failures.length) {
  console.error("CapDent V25 validation FAILED:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V25 validation PASS (${rcMode ? "RC" : "pre-RC"} mode).`);
for (const note of notes) console.log(`- ${note}`);
