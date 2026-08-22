import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V26_RC === "true";

const app = readJson("app.json");
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const eas = readJson("eas.json");
const appConfig = readText("app.config.js");
const environmentExample = readText(".env.example");

expect(app.expo?.name === "CapDent", "App name must remain CapDent.");
expect(
  app.expo?.android?.package === "com.dms.clinic",
  "Android package must remain com.dms.clinic."
);
expect(
  app.expo?.android?.versionCode === 26,
  "V26 requires Android versionCode 26."
);
expect(app.expo?.version === "1.2.6", "V26 Expo version must be 1.2.6.");
expect(pkg.version === "1.2.6", "V26 package.json version must be 1.2.6.");
expect(
  lock?.name === pkg.name && lock?.packages?.[""]?.name === pkg.name,
  "package-lock.json root package identity must match package.json."
);

const buildPropertiesPlugin = app.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties"
);
expect(
  buildPropertiesPlugin?.[1]?.android?.compileSdkVersion === 36,
  "V26 must compile with Android API 36."
);
expect(
  buildPropertiesPlugin?.[1]?.android?.targetSdkVersion === 36,
  "V26 must target Android API 36."
);

const notificationPlugin = app.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications"
);
expect(
  notificationPlugin?.[1]?.defaultChannel === "payments_coin_drop_v1",
  "V26 payment notifications must use payments_coin_drop_v1."
);
expect(
  notificationPlugin?.[1]?.sounds?.includes("./assets/sounds/coin_drop.wav"),
  "V26 payment notification sound must remain coin_drop.wav."
);
expect(
  app.expo?.plugins?.includes("@react-native-firebase/app"),
  "Firebase app plugin must remain enabled."
);
expect(
  app.expo?.plugins?.some(
    (plugin) =>
      Array.isArray(plugin) && plugin[0] === "@react-native-firebase/analytics"
  ),
  "Firebase Analytics plugin must remain enabled."
);
expect(
  app.expo?.android?.blockedPermissions?.includes(
    "com.google.android.gms.permission.AD_ID"
  ),
  "Advertising ID permission must remain blocked."
);

expect(
  existsSync("package-lock.json"),
  "package-lock.json must remain tracked for deterministic npm ci installs."
);
expect(
  pkg.dependencies?.["@react-native-firebase/app"] === "26.2.0" &&
    pkg.dependencies?.["@react-native-firebase/analytics"] === "26.2.0",
  "Firebase app and analytics packages must remain pinned to 26.2.0."
);
expect(
  pkg.dependencies?.["expo-notifications"]?.startsWith("~57."),
  "Expo SDK 57 notifications dependency must remain installed."
);
expect(
  pkg.dependencies?.["expo-device"]?.startsWith("~57."),
  "Expo SDK 57 device dependency must remain installed."
);
expect(
  Boolean(pkg.dependencies?.["react-native-iap"]),
  "Google Play Billing dependency must remain installed."
);
expect(
  Boolean(pkg.dependencies?.["react-native-svg"]),
  "Dental chart SVG dependency must remain installed."
);
expect(
  existsSync("scripts/verify-android-signing.mjs"),
  "Android signing verification script must remain present."
);

for (const scriptName of [
  "build:android:apk",
  "build:android:play-internal",
  "build:android:production",
]) {
  expect(
    pkg.scripts?.[scriptName]?.includes("check:v26:rc") &&
      pkg.scripts?.[scriptName]?.includes("verify:android-signing"),
    `${scriptName} must run the V26 RC gate and signing verification.`
  );
}
expect(
  pkg.scripts?.["build:android"] === "npm run build:android:play-internal" &&
    pkg.scripts?.["build:android:aab"] === "npm run build:android:play-internal",
  "Play Internal must remain the default Android AAB build target."
);
expect(
  pkg.scripts?.["validate:v26"]?.includes("validate-capdent-v26.mjs") &&
    pkg.scripts?.["check:v26:rc"]?.includes("validate:v26:rc") &&
    pkg.scripts?.["check:v26:rc"]?.includes("typecheck"),
  "V26 validation and RC typecheck scripts must remain wired."
);

expect(
  eas.cli?.appVersionSource === "local",
  "EAS local app versioning must remain authoritative."
);
for (const profileName of [
  "development",
  "preview",
  "production",
  "play-internal",
]) {
  const profile = eas.build?.[profileName];
  expect(Boolean(profile), `${profileName} EAS build profile must exist.`);
  expect(
    profile?.credentialsSource === "local",
    `${profileName} must use the approved local signing credential.`
  );
  expect(
    profile?.autoIncrement === false,
    `${profileName} must keep deterministic local versioning.`
  );
}
expect(
  eas.build?.production?.android?.buildType === "app-bundle" &&
    eas.build?.["play-internal"]?.android?.buildType === "app-bundle",
  "Production and Play Internal must build Android App Bundles."
);
expect(
  eas.submit?.production?.android?.track === "production" &&
    eas.submit?.["play-internal"]?.android?.track === "internal",
  "EAS submit profiles must keep Production and Internal tracks separate."
);
for (const profileName of ["production", "play-internal"]) {
  const env = eas.build?.[profileName]?.env;
  expect(
    env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true",
    `${profileName} must enable server-verified paid plans.`
  );
  expect(
    env?.EXPO_PUBLIC_ENABLE_PAYMENT_PUSH === "true",
    `${profileName} must enable payment push.`
  );
  expect(
    env?.EXPO_PUBLIC_ENABLE_TOOTH_CHART === "true",
    `${profileName} must enable the dental chart.`
  );
  expect(
    env?.EXPO_PUBLIC_ENABLE_REALTIME === "true",
    `${profileName} must enable realtime.`
  );
  expect(
    env?.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS === "true",
    `${profileName} must use signed storage URLs.`
  );
  expect(
    env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "false" ||
      env?.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true",
    `${profileName} must explicitly declare the Firebase Analytics flag.`
  );
}
expect(
  eas.build?.development?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false" &&
    eas.build?.preview?.env?.EXPO_PUBLIC_ENABLE_PAID_PLANS === "false",
  "Development and Preview must not expose paid checkout."
);

expect(
  appConfig.includes("GOOGLE_SERVICES_JSON") &&
    appConfig.includes("./google-services.json"),
  "App config must support release Google Services configuration."
);
expect(
  environmentExample.includes("EXPO_PUBLIC_ENABLE_PAYMENT_PUSH=false") &&
    environmentExample.includes("EXPO_PUBLIC_ENABLE_TOOTH_CHART=false"),
  "Example environment must default sensitive release features off."
);

if (rcMode) {
  let localBranch = "";
  try {
    localBranch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
    }).trim();
  } catch {
    notes.push("Could not determine the local Git branch.");
  }

  const githubRefName = process.env.GITHUB_REF_NAME?.trim() || "";
  const branchMatches =
    localBranch === "release/capdent-v26" ||
    githubRefName === "release/capdent-v26";
  expect(
    branchMatches,
    `V26 RC validation must run from release/capdent-v26 (local: ${localBranch || "detached"}, GitHub ref: ${githubRefName || "none"}).`
  );

  expect(
    existsSync("assets/sounds/coin_drop.wav") ||
      appConfig.includes("ensureCoinDropSound"),
    "V26 RC must contain or deterministically generate the coin-drop notification sound."
  );
}

if (failures.length > 0) {
  console.error(`CapDent V26 validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V26 validation passed${rcMode ? " (RC mode)" : ""}.`);
for (const note of notes) console.log(`Note: ${note}`);
