import { existsSync, readFileSync, readdirSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode = process.env.CAPDENT_V25_RC === "true";
const app = readJson("app.json");
const pkg = readJson("package.json");
const manifestPath =
  "docs/database/production-baseline-2026-08-13/manifest.json";
const manifest = readJson(manifestPath);
const limits = readText("src/lib/v25Limits.ts");
const pricing = readText("src/lib/pricingV2.ts");
const subscriptionScreen = readText("src/app/settings/subscription.tsx");
const billing = readText("src/lib/googlePlayBilling.ts");

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(
  pkg.dependencies?.["@Supabase/supabase-js"] || pkg.dependencies?.["@supabase/supabase-js"],
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
} else {
  notes.push(
    `Pre-RC mode: Android versionCode is ${app.expo?.android?.versionCode ?? "unknown"}; no native version bump is required yet.`
  );
}

if (failures.length) {
  console.error("CapDent V25 validation FAILED:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V25 validation PASS (${rcMode ? "RC" : "pre-RC"} mode).`);
for (const note of notes) console.log(`- ${note}`);
