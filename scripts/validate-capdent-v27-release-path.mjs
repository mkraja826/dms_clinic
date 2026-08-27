import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V27_RC === "true";
const pkg = readJson("package.json");
const app = readJson("app.json");
const eas = readJson("eas.json");

const v26Version = "1.2.6";
const v26AndroidVersionCode = 27;

function parseVersion(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function isVersionGreater(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return false;
}

const v27Preview = pkg.scripts?.["build:v27:android:preview"] || "";
const v27Internal = pkg.scripts?.["build:v27:android:play-internal"] || "";
const v27Production = pkg.scripts?.["build:v27:android:production"] || "";

expect(
  pkg.scripts?.["build:v27:android"] === "npm run build:v27:android:play-internal",
  "V27 default Android build must point to the V27 Play Internal build path."
);
expect(
  v27Preview.includes("check:v27") &&
    !v27Preview.includes("check:v26:rc") &&
    v27Preview.includes("--profile preview"),
  "V27 preview builds must run the V27 gate and use the preview EAS profile."
);
for (const [name, script, profile] of [
  ["Play Internal", v27Internal, "play-internal"],
  ["Production", v27Production, "production"],
]) {
  expect(
    script.includes("check:v27:rc") &&
      script.includes("verify:android-signing") &&
      script.includes(`--profile ${profile}`) &&
      !script.includes("check:v26:rc"),
    `V27 ${name} build must run the V27 RC gate, signing verification, and the ${profile} EAS profile without falling back to the V26 RC gate.`
  );
}

expect(
  pkg.scripts?.["validate:v27"]?.includes("validate-capdent-v27.mjs") &&
    pkg.scripts?.["validate:v27"]?.includes("validate-capdent-v27-release-path.mjs") &&
    pkg.scripts?.["validate:v27:rc"]?.includes("validate-capdent-v27.mjs --rc") &&
    pkg.scripts?.["validate:v27:rc"]?.includes("validate-capdent-v27-release-path.mjs --rc"),
  "V27 feature and RC validation must include the dedicated release-path guard."
);

expect(
  app.expo?.version === pkg.version,
  "Expo app version and package.json version must stay aligned for V27."
);
expect(
  parseVersion(app.expo?.version) !== null,
  "V27 app version must remain a three-part numeric release version."
);
expect(
  Number.isInteger(app.expo?.android?.versionCode) && app.expo.android.versionCode >= v26AndroidVersionCode,
  "V27 Android versionCode must remain a valid local integer at or above the frozen V26 baseline until the release bump is prepared."
);

if (rcMode) {
  expect(
    isVersionGreater(app.expo?.version, v26Version),
    `V27 RC versionName must advance beyond frozen V26 ${v26Version}; current value is ${app.expo?.version || "missing"}.`
  );
  expect(
    Number.isInteger(app.expo?.android?.versionCode) &&
      app.expo.android.versionCode > v26AndroidVersionCode,
    `V27 RC Android versionCode must be greater than frozen V26 code ${v26AndroidVersionCode}; current value is ${app.expo?.android?.versionCode ?? "missing"}.`
  );
}

expect(
  eas.cli?.appVersionSource === "local" &&
    eas.build?.production?.autoIncrement === false &&
    eas.build?.["play-internal"]?.autoIncrement === false,
  "V27 release builds must keep deterministic local app versioning."
);
expect(
  eas.submit?.production?.android?.track === "production" &&
    eas.submit?.["play-internal"]?.android?.track === "internal",
  "V27 submit profiles must preserve Production and Internal Play tracks."
);

if (failures.length > 0) {
  console.error(`CapDent V27 release-path validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V27 release-path validation passed${rcMode ? " (RC mode)" : ""}.`);
