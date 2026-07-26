import { existsSync, readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const app = readJson("app.json");
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
const paymentFunction = readText(
  "supabase/functions/send-payment-notification/index.ts"
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
  eas.build?.["play-internal"]?.android?.buildType === "app-bundle",
  "Play Internal must produce an Android App Bundle."
);
expect(
  eas.submit?.["play-internal"]?.android?.track === "internal",
  "Submissions must target the internal testing track."
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
    pkg.scripts?.["build:android"] === "npm run build:android:play-internal",
  "Default v21 Android builds must target only Internal Testing."
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
  paymentFunction.includes('.neq("id", collectorId') &&
    paymentFunction.includes("DeviceNotRegistered") === false &&
    readText(
      "supabase/functions/send-payment-notification/helpers.ts"
    ).includes("DeviceNotRegistered"),
  "Delivery must exclude the collector and retire unregistered devices."
);
expect(
  supabaseConfig.includes("[functions.send-payment-notification]") &&
    supabaseConfig.includes("verify_jwt = false"),
  "The Database Webhook function must use its documented custom-secret authentication."
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
    existsSync("supabase/tests/fixtures/capdent_v21_minimal_schema.sql"),
  "A guarded disposable local Supabase test harness must exist."
);
expect(
  !existsSync("google-services.json") &&
    !existsSync("android/app/google-services.json"),
  "Firebase credential files must not be added before approval."
);

if (failures.length > 0) {
  console.error("CapDent v21 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "CapDent v21 version, dependencies, signing policy, and disabled staged-feature checks passed."
);
