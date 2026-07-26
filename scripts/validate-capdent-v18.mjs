import { existsSync, readFileSync } from "node:fs";

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
const uploadPatient = readText("src/lib/supabase.ts");
const patientProfilePhoto = readText("src/lib/patientProfilePhoto.ts");
const clinicBranding = readText("src/lib/clinicBranding.ts");
const imageCompression = readText("src/lib/imageCompression.ts");
const storageUrls = readText("src/lib/storageUrls.ts");
const secureStorageImage = readText("src/components/SecureStorageImage.tsx");
const environmentExample = readText(".env.example");
const supabaseConfig = readText("supabase/config.toml");
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
  app.expo?.android?.versionCode === 20,
  "Android versionCode must be 20."
);
expect(pkg.version === "1.2.0", "package.json version must be 1.2.0.");
expect(
  eas.cli?.appVersionSource === "local",
  "EAS must use local versioning so app.json versionCode 20 is authoritative."
);
expect(
  eas.build?.production?.autoIncrement === false,
  "Production autoIncrement must be disabled for deterministic version code 20."
);
for (const profileName of [
  "development",
  "preview",
  "production",
  "play-internal",
]) {
  expect(
    eas.build?.[profileName]?.credentialsSource === "local",
    `${profileName} must use the verified local Android signing credential.`
  );
}

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
  eas.build?.development?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false",
  "Development paid plans must remain disabled."
);
expect(
  eas.build?.preview?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false",
  "Preview paid plans must remain disabled."
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
  eas.build?.["play-internal"]?.autoIncrement === false,
  "Play internal billing build must keep deterministic version code 20."
);
expect(
  eas.build?.["play-internal"]?.android?.buildType === "app-bundle",
  "Play internal billing build must produce an Android App Bundle."
);
expect(
  eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true",
  "Paid plans may be enabled only in the Play internal profile."
);
expect(
  eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION === "true",
  "Play internal billing observation must be enabled."
);
expect(
  eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_SUPABASE_URL ===
    eas.build?.production?.env?.EXPO_PUBLIC_SUPABASE_URL,
  "Play internal must inherit the trusted production Supabase URL."
);
expect(
  eas.build?.["play-internal"]?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ===
    eas.build?.production?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  "Play internal must inherit the trusted production Supabase key."
);
expect(
  Object.values(eas.build ?? {}).every(
    (profile) =>
      profile?.env?.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith(
        "sb_publishable_"
      ) && !profile?.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ),
  "Every v18 build profile must use the modern Supabase publishable key."
);
expect(
  eas.submit?.["play-internal"]?.android?.track === "internal",
  "Play internal submissions must target only the internal testing track."
);
const storageSecurityMigration = readText(
  "supabase/migrations/20260720105410_secure_storage_and_rls_consolidation_v18.sql"
);
const storageMetadataMigration = readText(
  "supabase/migrations/20260720105741_track_optimized_storage_metadata_v18.sql"
);
const profilePrivilegeMigration = readText(
  "supabase/migrations/20260720112030_restrict_profile_column_updates_v18.sql"
);
const privateStorageCutover = readText(
  "supabase/private-storage-cutover-v18.sql"
);

const releaseConfiguration = `${JSON.stringify(eas)}\n${environmentExample}\n${supabaseConfig}`;
expect(
  !/UPLOAD_PROVIDER|STRICT_R2|create-r2-upload-url|cloudflare\s+r2/i.test(
    releaseConfiguration
  ),
  "Release configuration must use Supabase Storage only."
);
expect(
  !existsSync("supabase/functions/create-r2-upload-url/index.ts"),
  "The retired R2 upload Edge Function source must stay removed."
);
expect(
  pkg.dependencies?.["expo-image-manipulator"]?.startsWith("~57."),
  "The Expo 57-compatible image optimizer must be installed."
);
expect(
  imageCompression.includes("ImageManipulator.SaveFormat.WEBP"),
  "Uploaded images must be encoded as WebP."
);
expect(
  imageCompression.includes("initialQuality: 0.99") &&
    imageCompression.includes("minimumQuality: 0.96") &&
    imageCompression.includes("targetRatio: 0.3") &&
    imageCompression.includes("minimumTargetBytes: 300 * 1024"),
  "Clinical compression must preserve detail while targeting about 30% of the source size."
);
expect(
  imageCompression.includes("originalSizeBytes") &&
    imageCompression.includes("storedSizeBytes"),
  "Image optimization must record before/after byte sizes."
);
expect(
  uploadPatient.includes("optimizeUploadImage(input.uri, input.file_type)"),
  "Patient images must be optimized before Supabase upload."
);
expect(
  uploadPatient.includes('provider: "supabase"'),
  "Patient uploads must use Supabase Storage."
);
expect(
  uploadPatient.includes('cacheControl: "31536000"'),
  "Immutable uploads must use a long browser cache lifetime."
);
expect(
  uploadPatient.includes("remove([storageResult.storagePath])") &&
    patientProfilePhoto.includes("previousPhoto.path") &&
    clinicBranding.includes("previousLogo.path"),
  "Failed and superseded Storage objects must be cleaned up."
);
expect(
  Object.values(eas.build ?? {}).every(
    (profile) => profile?.env?.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS === "true"
  ),
  "Every v18 build profile must resolve clinical files through signed URLs."
);
expect(
  storageUrls.includes("createSignedUrls") && storageUrls.includes("SIGNED_URL_REFRESH_MS"),
  "Storage URLs must be batch-signed and refreshed before expiry."
);
expect(
  secureStorageImage.includes('cachePolicy = "memory-disk"'),
  "Remote clinical images must use memory and disk caching."
);
expect(
  storageSecurityMigration.includes("to authenticated") &&
    storageSecurityMigration.includes("clinical_storage_select_same_clinic"),
  "Clinical Storage must use authenticated clinic-scoped policies."
);
expect(
  storageSecurityMigration.includes("file_size_limit") &&
    storageSecurityMigration.includes("allowed_mime_types"),
  "Clinical Storage buckets must enforce size and MIME limits."
);
expect(
  storageMetadataMigration.includes("storage_path") &&
    storageMetadataMigration.includes("stored_size_bytes"),
  "File records must retain Storage identity and compression metadata."
);
expect(
  profilePrivilegeMigration.includes("grant update (name, phone)") &&
    profilePrivilegeMigration.includes("revoke insert, delete, truncate, references, trigger, update"),
  "Direct profile writes must be limited to non-authority personal fields."
);
expect(
  privateStorageCutover.includes("set public = false") &&
    privateStorageCutover.includes("Older builds"),
  "The private clinical Storage cutover must remain an explicit post-v18 rollout step."
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

console.log(
  "CapDent v18 configuration, Supabase-only optimized uploads, pricing, and secure Play billing checks passed."
);
