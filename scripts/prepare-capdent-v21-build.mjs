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

  config.build.development.environment = "development";
  config.build.preview.environment = "preview";
  config.build.production.environment = "production";
  config.build["play-internal"].environment = "production";

  config.build.development.env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "false";
  config.build.preview.env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "false";
  config.build.production.env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "true";
  config.build["play-internal"].env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "true";

  config.build.production.android ??= {};
  config.build.production.android.buildType = "app-bundle";
  config.build["play-internal"].android ??= {};
  config.build["play-internal"].android.buildType = "app-bundle";
  config.submit ??= {};
  config.submit.production = { android: { track: "production" } };
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
  "CapDent v21 production profile enables verified Google Play billing; payment push and tooth chart remain globally disabled."
);
