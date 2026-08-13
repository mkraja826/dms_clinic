import { existsSync, readFileSync, readdirSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V25_RC === "true";
const app = readJson("app.json");
const pkg = readJson("package.json");
const firebaseConfig = readJson("firebase.json");
const environmentExample = readText(".env.example");
const manifestPath =
  "docs/database/production-baseline-2026-08-13/manifest.json";
const manifest = readJson(manifestPath);
const limits = readText("src/lib/v25Limits.ts");
const pricing = readText("src/lib/pricingV2.ts");
const subscriptionScreen = readText("src/app/settings/subscription.tsx");
const billing = readText("src/lib/googlePlayBilling.ts");
const supabaseClient = readText("src/lib/supabase.ts");
const analytics = readText("src/lib/firebaseAnalytics.ts");
const analyticsCoordinator = readText(
  "src/components/FirebaseAnalyticsCoordinator.tsx"
);
const paymentCoordinator = readText(
  "src/components/PaymentNotificationCoordinator.tsx"
);

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(
  pkg.dependencies?.["@supabase/supabase-js"],
  "Supabase client dependency must remain present."
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
  analytics.includes("SAFE_ANALYTICS_ROLES") &&
    analytics.includes("SAFE_ANALYTICS_SCREENS") &&
    analytics.includes("SAFE_ANALYTICS_EVENTS") &&
    analytics.includes("sanitizeParams(eventName, params)"),
  "Analytics events must retain runtime role, screen, and parameter allowlists."
);
expect(
  analyticsCoordinator.includes('"capdent_app_ready"') &&
    analyticsCoordinator.includes('"capdent_screen_view"') &&
    paymentCoordinator.includes("FirebaseAnalyticsCoordinator"),
  "Privacy-safe analytics coordinator must be mounted in the app runtime."
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
    existsSync("docs/database/production-baseline-2026-08-13/replay-evidence.md"),
    "RC mode requires committed replay evidence."
  );
  expect(
    existsSync("docs/database/production-baseline-2026-08-13/backup-pitr-evidence.md"),
    "RC mode requires independent backup/PITR evidence."
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
  const analyticsPlugin = app.expo?.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@react-native-firebase/analytics"
  );
  expect(
    analyticsPlugin?.[1]?.ios?.withoutAdIdSupport === true,
    "RC mode requires the Firebase Analytics Expo plugin with iOS Ad ID support disabled."
  );
} else {
  expect(
    !analytics.match(/(?:import\s+.*from\s+|require\()["']@react-native-firebase\//),
    "Pre-RC analytics must not statically import uninstalled React Native Firebase packages; use the injected adapter until the native install step."
  );
  notes.push(
    `Pre-RC mode: Android versionCode is ${app.expo?.android?.versionCode ?? "unknown"}; no native version bump is required yet.`
  );
  notes.push(
    "Firebase Analytics application instrumentation is staged; native packages/plugin remain an RC-gated local install."
  );
}

if (failures.length) {
  console.error("CapDent V25 validation FAILED:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V25 validation PASS (${rcMode ? "RC" : "pre-RC"} mode).`);
for (const note of notes) console.log(`- ${note}`);
