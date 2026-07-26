import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VERSION_NAME = "1.2.1";
const VERSION_CODE = 21;
const STAGED_FLAGS = {
  EXPO_PUBLIC_ENABLE_PAYMENT_PUSH: "false",
  EXPO_PUBLIC_ENABLE_TOOTH_CHART: "false",
};

function updateJson(path, transform) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  const current = JSON.parse(readFileSync(path, "utf8"));
  transform(current);
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  console.log(`${path}: prepared for CapDent ${VERSION_NAME} (${VERSION_CODE})`);
}

updateJson("app.json", (config) => {
  config.expo ??= {};
  config.expo.version = VERSION_NAME;
  config.expo.android ??= {};
  config.expo.android.package = "com.dms.clinic";
  config.expo.android.versionCode = VERSION_CODE;
});

updateJson("eas.json", (config) => {
  config.cli ??= {};
  config.cli.appVersionSource = "local";
  config.build ??= {};

  for (const profileName of [
    "development",
    "preview",
    "production",
    "play-internal",
  ]) {
    const profile = (config.build[profileName] ??= {});
    profile.credentialsSource = "local";
    profile.autoIncrement = false;
    profile.env ??= {};
    Object.assign(profile.env, STAGED_FLAGS);
  }

  config.build["play-internal"].android ??= {};
  config.build["play-internal"].android.buildType = "app-bundle";
  config.submit ??= {};
  config.submit["play-internal"] = { android: { track: "internal" } };
});

updateJson("package.json", (config) => {
  config.version = VERSION_NAME;
});

if (existsSync("package-lock.json")) {
  updateJson("package-lock.json", (config) => {
    config.version = VERSION_NAME;
    if (config.packages?.[""]) config.packages[""].version = VERSION_NAME;
  });
}

console.log(
  "CapDent v21 is staged for Internal Testing with payment push and tooth chart globally disabled."
);
