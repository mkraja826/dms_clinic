import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

const app = readJson("app.json");
const eas = readJson("eas.json");
const pkg = readJson("package.json");
const pricing = readText("src/lib/pricingV2.ts");
const billing = readText("src/lib/googlePlayBilling.ts");
const subscription = readText("src/lib/subscription.ts");
const addPatient = readText("src/app/patient/add.tsx");
const migration = readText(
  "supabase/migrations/20260719173000_capdent_pricing_v2_foundation.sql"
);
const billingSecurityMigration = readText(
  "supabase/migrations/20260720102000_secure_google_play_subscription_authority.sql"
);
const playVerifier = readText(
  "supabase/functions/verify-google-play-subscription/index.ts"
);
const databaseTest = readText(
  "supabase/tests/database/capdent_pricing_v2_foundation_test.sql"
);

const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(app.expo?.version === "1.2.0", "Expo version must be 1.2.0.");
expect(
  app.expo?.android?.versionCode === 18,
  "Android versionCode must be 18."
);
expect(pkg.version === "1.2.0", "package.json version must be 1.2.0.");
expect(
  eas.cli?.appVersionSource === "local",
  "EAS must use local versioning so app.json versionCode 18 is authoritative."
);
expect(
  eas.build?.production?.autoIncrement === false,
  "Production autoIncrement must be disabled for deterministic version code 18."
);

expect(
  eas.build?.development?.env?.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION ===
    "true",
  "Development pricing observation must be enabled."
);
expect(
  eas.build?.preview?.env?.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION ===
    "true",
  "Preview pricing observation must be enabled."
);
expect(
  eas.build?.production?.env?.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION ===
    "false",
  "Production pricing observation must remain disabled."
);
expect(
  eas.build?.production?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false",
  "Production paid plans must remain disabled."
);

expect(
  pricing.includes("canAddPatient: true"),
  "Pricing V2 fallback must always allow patient creation."
);
expect(
  pricing.includes('status: "fallback"'),
  "Pricing V2 must expose an explicit fail-open fallback state."
);
expect(
  pricing.includes("EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION"),
  "Pricing observation must remain controlled by a build flag."
);

expect(
  addPatient.includes("observeCapDentPricingV2"),
  "Add Patient must load the internal pricing observer."
);
expect(
  addPatient.includes("createPatient({"),
  "Add Patient must preserve the existing createPatient workflow."
);
expect(
  !addPatient.includes("observedEntitlements?.canAddPatient"),
  "Observed entitlements must not decide whether a patient is saved."
);

expect(
  migration.includes("('free', 'Free', 0, 300, 1073741824"),
  "Free pricing must remain 300 patients and 1 GiB."
);
expect(
  migration.includes("('cloud', 'CapDent Cloud', 799"),
  "Cloud pricing must remain INR 799."
);
expect(
  migration.includes("('intelligence', 'CapDent Intelligence', 1499"),
  "Intelligence pricing must remain INR 1499."
);
expect(
  migration.includes("and not coalesce(v_settings.grandfathered, true)"),
  "Grandfathered clinics must never be effectively enforced."
);
expect(
  !/create\s+trigger[\s\S]{0,180}\bon\s+public\.patients\b/i.test(migration),
  "Pricing migration must not create a trigger on public.patients."
);
expect(
  !/alter\s+table\s+public\.patients/i.test(migration),
  "Pricing migration must not alter public.patients."
);

expect(
  billing.includes('"midms_monthly_799"'),
  "Cloud must use the existing Google Play product ID midms_monthly_799."
);
expect(
  billing.includes('"midms_clinic_intelligence_monthly"'),
  "Intelligence must use its existing Google Play product ID."
);
expect(
  billing.includes("monthlyAmount: 1499"),
  "Google Play Intelligence fallback price must be INR 1499."
);
expect(
  !billing.includes("monthlyAmount: 1500"),
  "Google Play billing must not restore the obsolete INR 1500 fallback."
);
expect(
  billing.includes('supabase.functions.invoke("verify-google-play-subscription"'),
  "Purchases must be sent to the verified Google Play Edge Function."
);
expect(
  !billing.includes('supabase.rpc("record_google_play_subscription_purchase"'),
  "The Android client must not call the legacy purchase activation RPC."
);
expect(
  billing.includes("!data?.verified || !data?.activated"),
  "The Android client must reject unverified or non-active purchases."
);
expect(
  subscription.includes("SUBSCRIPTION_INTELLIGENCE_AMOUNT = 1499"),
  "Subscription Intelligence price must remain INR 1499."
);
expect(
  !subscription.includes("SUBSCRIPTION_INTELLIGENCE_AMOUNT = 1500"),
  "Subscription code must not restore the obsolete INR 1500 amount."
);

expect(
  playVerifier.includes("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64"),
  "The verifier must authenticate with the protected service-account secret."
);
expect(
  playVerifier.includes("GOOGLE_PLAY_PACKAGE_NAME"),
  "The verifier must use the configured Android package name."
);
expect(
  playVerifier.includes("purchases/subscriptionsv2/tokens"),
  "The verifier must use Google Play subscriptionsv2.get."
);
expect(
  playVerifier.includes("matchingItems.length === 0"),
  "The verifier must reject tokens that do not match the selected product."
);
expect(
  playVerifier.includes('state === "SUBSCRIPTION_STATE_ACTIVE"'),
  "The verifier must explicitly require a Google entitlement state."
);
expect(
  playVerifier.includes("monthlyPrice: 1499"),
  "The server verifier must activate Intelligence at INR 1499."
);
expect(
  playVerifier.includes("already linked to another clinic"),
  "The verifier must prevent purchase-token reuse across clinics."
);

expect(
  billingSecurityMigration.includes(
    "from public, anon, authenticated"
  ),
  "The legacy activation RPC must be revoked from mobile clients."
);
expect(
  billingSecurityMigration.includes(
    "revoke insert, update, delete, truncate, references, trigger"
  ),
  "Authenticated clients must not write subscription authority tables."
);
expect(
  billingSecurityMigration.includes(
    "clinic_subscriptions_google_play_token_unique"
  ),
  "The database must enforce one clinic per Google purchase token."
);

expect(
  databaseTest.includes("select extensions.plan(29);"),
  "Pricing database test must keep all 29 assertions."
);
expect(
  databaseTest.trimEnd().endsWith("rollback;"),
  "Pricing database test must roll back all test changes."
);

if (failures.length > 0) {
  console.error("CapDent v18 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CapDent v18 configuration, pricing, and secure Play billing checks passed.");
