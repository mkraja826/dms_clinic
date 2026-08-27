import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const readText = (path) => readFileSync(path, "utf8");
const readJson = (path) => JSON.parse(readText(path));
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V27_RC === "true";

const pkg = readJson("package.json");
const app = readJson("app.json");
const legalLinks = readText("src/lib/legalLinks.ts");
const legalConsent = readText("src/app/legal-consent.tsx");
const legalAccount = readText("src/app/settings/legal.tsx");
const deleteAccount = readText("src/app/settings/delete-account.tsx");
const doctorMore = readText("src/app/(doctor)/more.tsx");
const headMore = readText("src/app/(head)/more.tsx");
const receptionMore = readText("src/app/(reception)/more.tsx");
const dataSafety = existsSync("PLAY_STORE_DATA_SAFETY_DMS.md")
  ? readText("PLAY_STORE_DATA_SAFETY_DMS.md")
  : "";

const android = app.expo?.android || {};
const permissions = new Set(android.permissions || []);
const blockedPermissions = new Set(android.blockedPermissions || []);

expect(
  android.allowBackup === false,
  "V27 Android backups must remain disabled because CapDent handles clinic and patient data."
);
expect(
  permissions.has("android.permission.CAMERA") &&
    permissions.has("com.android.vending.BILLING"),
  "V27 Android must retain only the explicit camera and Play Billing permissions required by current features."
);
for (const blocked of [
  "com.google.android.gms.permission.AD_ID",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
]) {
  expect(
    blockedPermissions.has(blocked),
    `V27 Android must continue blocking unnecessary permission ${blocked}.`
  );
}

expect(
  legalConsent.includes('accessibilityRole="checkbox"') &&
    legalConsent.includes("disabled={!accepted || saving}") &&
    legalConsent.includes("recordCapDentLegalConsent") &&
    legalConsent.includes("CAPDENT_APP_VERSION"),
  "V27 must require explicit Terms/Privacy acceptance and record the packaged app version server-side."
);
expect(
  legalAccount.includes('router.push("/settings/delete-account"') &&
    deleteAccount.includes("CAPDENT_DELETE_ACCOUNT_URL") &&
    deleteAccount.includes("CAPDENT_SUPPORT_EMAIL"),
  "V27 must expose account/data deletion inside Legal & Account with both public-page and support-email paths."
);
for (const [role, source] of [
  ["owner", headMore],
  ["working doctor", doctorMore],
  ["receptionist", receptionMore],
]) {
  expect(
    source.includes('target="/settings/legal"'),
    `V27 ${role} navigation must expose Legal & Account.`
  );
}
expect(
  !deleteAccount.includes("clinic_id") &&
    !deleteAccount.includes("user_id") &&
    !deleteAccount.includes("patient_id"),
  "V27 deletion-request UI must not place internal clinic, user, or patient identifiers into outbound requests."
);

const legalUrlMatches = [...legalLinks.matchAll(/https:\/\/[^"']+/g)].map((match) => match[0]);
expect(
  legalUrlMatches.length >= 3 && legalUrlMatches.every((url) => url.startsWith("https://")),
  "V27 Privacy, Terms, and Delete Account links must all use public HTTPS URLs."
);
expect(
  !legalUrlMatches.some((url) => /localhost|127\.0\.0\.1/i.test(url)),
  "V27 legal links must never point to local or development hosts."
);
for (const url of legalUrlMatches) {
  let capDentHosted = false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    capDentHosted = host === "capdent.in" || host.endsWith(".capdent.in");
  } catch {
    capDentHosted = false;
  }
  expect(
    capDentHosted,
    `V27 legal URL must be hosted under capdent.in: ${url}`
  );
}

const directDependencies = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};
const blockedAiPackages = [
  "openai",
  "@google/generative-ai",
  "@google/genai",
  "groq-sdk",
  "@anthropic-ai/sdk",
  "ollama",
];
for (const dependency of blockedAiPackages) {
  expect(
    !Object.prototype.hasOwnProperty.call(directDependencies, dependency),
    `V27 Android must not directly depend on AI provider SDK ${dependency}; CapDent AI belongs in the portal only.`
  );
}

function sourceFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(path);
  }
  return files;
}

const aiImportPatterns = [
  /from\s+["']openai["']/,
  /from\s+["']@google\/(?:generative-ai|genai)["']/,
  /from\s+["']groq-sdk["']/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /from\s+["']ollama["']/,
  /require\(["'](?:openai|@google\/(?:generative-ai|genai)|groq-sdk|@anthropic-ai\/sdk|ollama)["']\)/,
];
for (const file of sourceFiles("src")) {
  const source = readText(file);
  expect(
    !aiImportPatterns.some((pattern) => pattern.test(source)),
    `V27 Android source must not import an AI provider SDK (${file}).`
  );
}

const plugins = (app.expo?.plugins || []).map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin
);
const firebaseAppVersion = pkg.dependencies?.["@react-native-firebase/app"] || null;
const crashlyticsVersion = pkg.dependencies?.["@react-native-firebase/crashlytics"] || null;
const crashlyticsPluginPresent = plugins.includes("@react-native-firebase/crashlytics");

if (crashlyticsVersion) {
  expect(
    crashlyticsVersion === firebaseAppVersion,
    "V27 Crashlytics must use the same React Native Firebase version as @react-native-firebase/app."
  );
  expect(
    crashlyticsPluginPresent,
    "V27 Crashlytics dependency must also be configured as an Expo config plugin."
  );
  expect(
    /Crashlytics/i.test(dataSafety),
    "V27 Play Store data-safety documentation must be reviewed and explicitly mention Crashlytics when crash reporting is installed."
  );
} else {
  notes.push("Crashlytics is not installed yet; V27 RC mode will block release until it is configured and data-safety documentation is reviewed.");
}

if (rcMode) {
  expect(
    Boolean(crashlyticsVersion) && crashlyticsPluginPresent,
    "V27 RC requires Firebase Crashlytics to be installed and configured before release."
  );
}

if (failures.length > 0) {
  console.error(`CapDent V27 production-safety validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V27 production-safety validation passed${rcMode ? " (RC mode)" : ""}.`);
for (const note of notes) console.log(`Note: ${note}`);