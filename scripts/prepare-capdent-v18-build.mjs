import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VERSION_NAME = "1.2.0";
const VERSION_CODE = 20;

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
  config.build.production ??= {};
  config.build.production.autoIncrement = false;

  for (const profileName of ["development", "preview"]) {
    config.build[profileName] ??= {};
    config.build[profileName].credentialsSource = "local";
    config.build[profileName].env ??= {};
    config.build[profileName].env.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION = "true";
    config.build[profileName].env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "false";
  }

  config.build.production.env ??= {};
  config.build.production.credentialsSource = "local";
  config.build.production.env.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION = "false";
  config.build.production.env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "false";

  // Build a Play-distributed AAB using the same trusted production environment,
  // but enable paid plans only for internal testers. This profile is generated
  // locally so credentials are inherited rather than duplicated in source.
  config.build["play-internal"] = JSON.parse(JSON.stringify(config.build.production));
  config.build["play-internal"].autoIncrement = false;
  config.build["play-internal"].android ??= {};
  config.build["play-internal"].android.buildType = "app-bundle";
  config.build["play-internal"].env ??= {};
  config.build["play-internal"].env.EXPO_PUBLIC_ENABLE_PRICING_V2_OBSERVATION = "true";
  config.build["play-internal"].env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "true";

  config.submit ??= {};
  config.submit["play-internal"] = {
    android: {
      track: "internal",
    },
  };
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

console.log("CapDent v18 build configuration is ready with Android code 20.");
