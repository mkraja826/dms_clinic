import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");

const app = readJson("app.json");
const pkg = readJson("package.json");
const eas = readJson("eas.json");
const quota = readText("src/lib/v25Limits.ts");
const pricing = readText("src/lib/pricingV25.ts");
const billing = readText("src/lib/googlePlayBilling.ts");
const restore = readText("src/lib/googlePlayRestore.ts");
const push = readText("src/lib/paymentNotifications.ts");

expect(app.expo?.name === "CapDent", "V28 must remain the CapDent application.");
expect(app.expo?.android?.package === "com.dms.clinic", "Android package must remain com.dms.clinic.");

const buildProperties = app.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties"
);
expect(buildProperties?.[1]?.android?.compileSdkVersion === 36, "V28 development must compile with Android API 36.");
expect(buildProperties?.[1]?.android?.targetSdkVersion === 36, "V28 development must target Android API 36.");
expect(app.expo?.android?.blockedPermissions?.includes("com.google.android.gms.permission.AD_ID"), "Advertising ID permission must remain blocked.");
expect(app.expo?.android?.blockedPermissions?.includes("android.permission.RECORD_AUDIO"), "Microphone permission must remain blocked unless separately reviewed.");

expect(pkg.dependencies?.["react-native-iap"], "Google Play Billing must remain installed.");
expect(pkg.dependencies?.["@react-native-firebase/app"], "Firebase app dependency must remain installed.");
expect(pkg.dependencies?.["@react-native-firebase/analytics"], "Firebase Analytics dependency must remain installed.");
expect(!pkg.dependencies?.openai && !pkg.dependencies?.["@anthropic-ai/sdk"] && !pkg.dependencies?.["@google/generative-ai"], "Android V28 must not add LLM SDK dependencies.");

expect(quota.includes("patientLimit: 100"), "Free patient limit must remain 100.");
expect(quota.includes("uploadLimit: 150"), "Free upload limit must remain 150.");
expect(quota.includes("uploadWarningAt: 120"), "Free upload warning must remain 120.");
expect(quota.includes("storageLimitBytes: GIB"), "Free storage limit must remain 1 GiB.");

expect(pricing.includes('supabase.rpc("get_capdent_entitlements_v25")'), "V28 quota UI must keep server entitlement authority.");
expect(billing.includes('supabase.functions.invoke("verify-google-play-subscription"'), "Paid access must continue through the server Google Play verifier.");
expect(restore.includes("recordGooglePlaySubscriptionPurchase"), "V28 restore must reuse server purchase verification.");
expect(restore.includes("getAvailablePurchases"), "V28 restore must query owned Google Play purchases.");
expect(push.includes("getPaymentPushHealth"), "V28 must expose payment push health diagnostics.");
expect(push.includes('record.type === "payment_received"'), "Payment notification payload safety check must remain present.");
expect(push.includes('record.route === "/reports/payments"'), "Payment notifications must retain the safe payments route.");

for (const requiredPath of [
  "src/app/settings/clinic-health.tsx",
  "src/app/settings/restore-subscription.tsx",
  "src/app/settings/guide.tsx",
  "src/app/settings/report-issue.tsx",
  "src/app/legal-consent.tsx",
  "src/lib/imageCompression.ts",
  "src/lib/invoiceDocument.ts",
  "src/lib/invoiceSnapshot.ts",
  "src/lib/storageUrls.ts",
  "src/lib/useImmediateMutationLock.ts",
  "docs/capdent-v28-feature-complete-scope.md",
  "docs/capdent-v28-implementation-status.md",
]) {
  expect(existsSync(requiredPath), `Required V28 path is missing: ${requiredPath}`);
}

for (const profileName of ["production", "play-internal"]) {
  const env = eas.build?.[profileName]?.env;
  expect(env?.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS === "true", `${profileName} must keep signed clinical storage URLs enabled.`);
  expect(env?.EXPO_PUBLIC_ENABLE_PAYMENT_PUSH === "true", `${profileName} must keep payment push enabled for release testing.`);
  expect(env?.EXPO_PUBLIC_ENABLE_TOOTH_CHART === "true", `${profileName} must keep the tooth chart enabled.`);
}

function sourceFiles(root) {
  const found = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) found.push(full);
  }
  return found;
}

const prohibitedAndroidAiImports = [
  /from\s+["']openai["']/,
  /require\(["']openai["']\)/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /from\s+["']@google\/generative-ai["']/,
];
for (const file of sourceFiles("src")) {
  const text = readText(file);
  if (prohibitedAndroidAiImports.some((pattern) => pattern.test(text))) {
    failures.push(`Android AI/LLM SDK import is prohibited in V28: ${relative(process.cwd(), file)}`);
  }
}

if (failures.length) {
  console.error(`CapDent V28 feature validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 feature validation passed.");
console.log(`Development identity remains ${app.expo?.version} / Android code ${app.expo?.android?.versionCode}; final 1.2.8 / 28 is cut only after feature completion.`);
