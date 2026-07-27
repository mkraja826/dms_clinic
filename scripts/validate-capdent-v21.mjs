import { existsSync, readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const app = readJson("app.json");
const dynamicAppConfig = readText("app.config.js");
const eas = readJson("eas.json");
const pkg = readJson("package.json");
const environmentExample = readText(".env.example");
const featureFlags = readText("src/lib/featureFlags.ts");
const addVisit = readText("src/app/patient/visit.tsx");
const auth = readText("src/lib/auth.tsx");
const paymentClient = readText("src/lib/paymentNotifications.ts");
const paymentCoordinator = readText(
  "src/components/PaymentNotificationCoordinator.tsx"
);
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
const paymentFunction = readText(
  "supabase/functions/send-payment-notification/index.ts"
);
const googlePlayVerifier = readText(
  "supabase/functions/verify-google-play-subscription/index.ts"
);
const googlePlaySync = readText(
  "supabase/functions/sync-google-play-subscriptions/index.ts"
);
const supabaseConfig = readText("supabase/config.toml");

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(app.expo?.version === "1.2.1", "Expo version must be 1.2.1.");
expect(app.expo?.android?.versionCode === 21, "Android versionCode must be 21.");
expect(pkg.version === "1.2.1", "package.json version must be 1.2.1.");
expect(
  eas.cli?.appVersionSource === "local",
  "EAS local app versioning must remain authoritative."
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
  "react-native-svg must be installed for the dental chart."
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
    `${profileName} must keep deterministic version code 21.`
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
    expect(
      profile?.env?.[flag] === "false",
      `${flag} must be false in ${profileName}.`
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
  eas.build?.["play-internal"]?.android?.buildType === "app-bundle",
  "Play Internal must produce an Android App Bundle."
);
expect(
  eas.build?.production?.android?.buildType === "app-bundle",
  "Play Production must produce an Android App Bundle."
);
expect(
  eas.submit?.["play-internal"]?.android?.track === "internal",
  "Submissions must target the internal testing track."
);
expect(
  eas.submit?.production?.android?.track === "production",
  "The production submission profile must target Google Play Production."
);
expect(
  environmentExample.includes("EXPO_PUBLIC_ENABLE_PAYMENT_PUSH=false") &&
    environmentExample.includes("EXPO_PUBLIC_ENABLE_TOOTH_CHART=false"),
  "Example environment must keep both v21 features disabled."
);
expect(
  featureFlags.includes("PAYMENT_PUSH_GLOBALLY_ENABLED") &&
    featureFlags.includes("TOOTH_CHART_GLOBALLY_ENABLED"),
  "Central v21 kill switches must exist."
);
expect(
  existsSync("scripts/verify-android-signing.mjs"),
  "Android signing verification must remain present."
);
expect(
  existsSync("scripts/validate-capdent-v18.mjs") &&
    existsSync("scripts/prepare-capdent-v18-build.mjs"),
  "Protected v18 validation helpers must remain present."
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
  "Production build/submit commands must exist while the safe default remains Internal Testing."
);
expect(
  paymentClient.includes("getExpoPushTokenAsync({ projectId })") &&
    paymentClient.includes("PAYMENT_NOTIFICATION_CHANNEL_ID") &&
    paymentClient.includes("permission-denied"),
  "Payment push registration must be project-scoped, channel-first, and non-fatal."
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
  "Payment migration must be disabled by default and keep enqueue errors from failing payments."
);
expect(
  paymentMigration.includes("enable row level security") &&
    paymentMigration.includes("revoke all on table") &&
    paymentMigration.includes("grant select on table"),
  "New notification tables require RLS and explicit Data API grants."
);
expect(
  paymentFunction.includes('requiredEnv("PAYMENT_NOTIFICATION_WEBHOOK_SECRET")') &&
    paymentFunction.includes('Deno.env.get("PAYMENT_PUSH_ENABLED")') &&
    paymentFunction.includes("SUPABASE_SERVICE_ROLE_KEY"),
  "The Edge Function must use a custom secret, server kill switch, and server-only service role."
);
expect(
  dispatchMigration.includes("create extension if not exists pg_net") &&
    dispatchMigration.includes("create extension if not exists pg_cron") &&
    dispatchMigration.includes(
      "capdent_payment_notification_webhook_secret"
    ) &&
    dispatchMigration.includes(
      "payment_notification_jobs_dispatch_after_insert"
    ) &&
    dispatchMigration.includes(
      "capdent-payment-notification-maintenance"
    ),
  "Production notification dispatch must be post-commit, Vault-authenticated, and scheduled for retries."
);
expect(
  dispatchMigration.includes("dental_chart_entries_patient_id_idx") &&
    dispatchMigration.includes(
      "payment_notification_deliveries_recipient_user_id_idx"
    ) &&
    dispatchMigration.includes(
      "payment_notification_deliveries_device_token_id_idx"
    ),
  "All v21 foreign keys identified by the production advisor need covering indexes."
);
expect(
  googlePlaySyncMigration.includes(
    "capdent_google_play_sync_secret"
  ) &&
    googlePlaySyncMigration.includes(
      "capdent-google-play-subscription-sync"
    ) &&
    googlePlaySyncMigration.includes("'17 * * * *'"),
  "Google Play lifecycle reconciliation must use Vault and run hourly."
);
expect(
  googlePlaySync.includes('requiredEnv("GOOGLE_PLAY_SYNC_SECRET")') &&
    googlePlaySync.includes('Deno.env.get("GOOGLE_PLAY_SYNC_ENABLED")') &&
    googlePlaySync.includes("/purchases/subscriptionsv2/tokens/") &&
    googlePlaySync.includes("capdent-health-check-invalid-token") &&
    googlePlaySync.includes(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    ) &&
    googlePlaySync.includes("google_play_last_verified_at"),
  "Billing lifecycle sync must be server-authenticated, health-checkable, and refresh subscription state from Google."
);
expect(
  googlePlayVerifier.includes("monthlyPrice: 800") &&
    readText("src/lib/googlePlayBilling.ts").includes("monthlyAmount: 800"),
  "CapDent Cloud fallback and verified billing metadata must match the live India price."
);
expect(
  paymentFunction.includes('.neq("id", collectorId') &&
    paymentFunction.includes("DeviceNotRegistered") === false &&
    readText(
      "supabase/functions/send-payment-notification/helpers.ts"
    ).includes("DeviceNotRegistered"),
  "Delivery must exclude the collector and retire unregistered devices."
);
expect(
  supabaseConfig.includes("[functions.send-payment-notification]") &&
    supabaseConfig.includes("[functions.sync-google-play-subscriptions]") &&
    supabaseConfig.match(/verify_jwt = false/g)?.length >= 2,
  "Server-dispatched Edge Functions must use their documented custom-secret authentication."
);
expect(
  chart.includes("FDI_ARCHES") &&
    chart.includes("PERMANENT_UPPER") &&
    chart.includes("PRIMARY_UPPER"),
  "The chart must define permanent and primary FDI arches."
);
expect(
  visitDraft.includes("AsyncStorage") &&
    visitDraft.includes("Preserve the other dentition"),
  "Visit chart drafts must persist safely and support mixed dentition."
);
expect(
  addVisit.includes(
    "toothChartEnabled && visitDraft.findings.length > 0"
  ) &&
    addVisit.includes("saveVisitWithToothChart") &&
    addVisit.includes("await visitDraft.clear()") &&
    addVisit.indexOf("await visitDraft.clear()") >
      addVisit.indexOf("await saveVisitWithToothChart"),
  "Only non-empty enabled charts may use the atomic RPC, and drafts clear only after success."
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
  "Chart migration must default disabled, preserve append-only history, and add the atomic RPC."
);
expect(
  chartMigration.includes("p_treatments jsonb") &&
    chartMigration.includes("Every treatment requires an explicit valid status") &&
    !chartMigration.includes("p_next_appointment_date is null then 'completed'"),
  "The atomic RPC must support multiple explicitly-statused treatments without follow-up inference."
);
expect(
  existsSync("docs/capdent-v21-release-checklist.md") &&
    existsSync("docs/capdent-v21-rollback-plan.md") &&
    existsSync("docs/capdent-v21-supabase-runbook.md"),
  "Release, rollback, and Supabase approval-gate documentation must exist."
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
  "A guarded disposable local Supabase test harness must exist."
);
expect(
  dynamicAppConfig.includes("process.env.GOOGLE_SERVICES_JSON") &&
    dynamicAppConfig.includes("./google-services.json"),
  "Android FCM config must use the EAS secret file with a local ignored fallback."
);
expect(
  !existsSync("android/app/google-services.json"),
  "Generated native Firebase config must not be committed."
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
  "Firebase client and Admin SDK files must remain outside version control."
);

if (failures.length > 0) {
  console.error("CapDent v21 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "CapDent v21 version, dependencies, signing policy, and disabled staged-feature checks passed."
);
