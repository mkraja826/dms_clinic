// CI-only proof that V27 can advance beyond the frozen V26 release numbers.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const paths = ["app.json", "package.json", "package-lock.json"];
const originals = Object.fromEntries(
  paths.map((path) => [path, readFileSync(path, "utf8")])
);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  const app = JSON.parse(originals["app.json"]);
  const pkg = JSON.parse(originals["package.json"]);
  const lock = JSON.parse(originals["package-lock.json"]);

  app.expo.version = "1.2.7";
  app.expo.android.versionCode = 28;
  pkg.version = "1.2.7";
  lock.version = "1.2.7";
  if (lock.packages?.[""]) {
    lock.packages[""].version = "1.2.7";
  }

  writeJson("app.json", app);
  writeJson("package.json", pkg);
  writeJson("package-lock.json", lock);

  execFileSync(process.execPath, ["scripts/validate-capdent-v27.mjs"], {
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["scripts/validate-capdent-v27-release-path.mjs"], {
    stdio: "inherit",
  });

  console.log(
    "V27 version-transition simulation passed for versionName 1.2.7 and Android versionCode 28."
  );
} finally {
  for (const path of paths) {
    writeFileSync(path, originals[path]);
  }
}

execFileSync("git", ["diff", "--exit-code", "--", ...paths], {
  stdio: "inherit",
});
