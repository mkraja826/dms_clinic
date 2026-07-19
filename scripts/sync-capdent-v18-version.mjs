import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VERSION_NAME = "1.2.0";
const VERSION_CODE = 18;

function updateJson(path, transform) {
  if (!existsSync(path)) return;
  const value = JSON.parse(readFileSync(path, "utf8"));
  transform(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`${path}: synced`);
}

updateJson("app.json", (config) => {
  config.expo ??= {};
  config.expo.version = VERSION_NAME;
  config.expo.android ??= {};
  config.expo.android.versionCode = VERSION_CODE;
});

updateJson("package.json", (config) => {
  config.version = VERSION_NAME;
});

updateJson("package-lock.json", (config) => {
  config.version = VERSION_NAME;
  if (config.packages?.[""]) {
    config.packages[""].version = VERSION_NAME;
  }
});

const nativeGradlePath = "android/app/build.gradle";
if (existsSync(nativeGradlePath)) {
  const original = readFileSync(nativeGradlePath, "utf8");
  const updated = original
    .replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
    .replace(/versionName\s+["'][^"']+["']/, `versionName "${VERSION_NAME}"`);

  if (updated === original) {
    throw new Error("Native Android version fields were not found.");
  }

  writeFileSync(nativeGradlePath, updated, "utf8");
  console.log(`${nativeGradlePath}: synced`);
}

console.log(`CapDent version ${VERSION_NAME} (${VERSION_CODE}) is ready.`);
