import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_SHA1 =
  "EC:7F:C4:82:FA:0B:AA:0F:8F:06:12:6D:D3:75:9B:99:2C:6D:1E:E6";

function fail(message) {
  console.error(`Android signing validation failed: ${message}`);
  process.exit(1);
}

function keytoolCandidates() {
  const executable = process.platform === "win32" ? "keytool.exe" : "keytool";
  const candidates = [];

  if (process.env.JAVA_HOME) {
    candidates.push(join(process.env.JAVA_HOME, "bin", executable));
  }

  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe",
      "C:\\Program Files\\Android\\Android Studio\\jre\\bin\\keytool.exe"
    );
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory) candidates.push(join(directory, executable));
  }

  return [...new Set(candidates)];
}

if (!existsSync("credentials.json")) {
  fail("credentials.json is missing; refusing to start an Android release build.");
}

const credentials = JSON.parse(readFileSync("credentials.json", "utf8"));
const keystore = credentials.android?.keystore;

if (
  !keystore?.keystorePath ||
  !keystore?.keystorePassword ||
  !keystore?.keyAlias ||
  !keystore?.keyPassword
) {
  fail("credentials.json does not contain a complete Android keystore entry.");
}

const keystorePath = resolve(keystore.keystorePath);
if (!existsSync(keystorePath)) {
  fail(`the configured keystore does not exist at ${keystore.keystorePath}.`);
}

const keytool = keytoolCandidates().find(existsSync);
if (!keytool) {
  fail("Java keytool was not found. Set JAVA_HOME or install Android Studio.");
}

const storePasswordVariable = "CAPDENT_VERIFY_STORE_PASSWORD";
const keyPasswordVariable = "CAPDENT_VERIFY_KEY_PASSWORD";
const result = spawnSync(
  keytool,
  [
    "-list",
    "-v",
    "-keystore",
    keystorePath,
    "-alias",
    keystore.keyAlias,
    "-storepass:env",
    storePasswordVariable,
    "-keypass:env",
    keyPasswordVariable,
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      [storePasswordVariable]: keystore.keystorePassword,
      [keyPasswordVariable]: keystore.keyPassword,
    },
  }
);

if (result.status !== 0) {
  fail("keytool could not read the configured Android signing credential.");
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const sha1 = output.match(/SHA1:\s*([0-9A-F:]+)/i)?.[1]?.toUpperCase();

if (!sha1) {
  fail("keytool did not return a SHA-1 certificate fingerprint.");
}

if (sha1 !== EXPECTED_SHA1) {
  fail(`expected ${EXPECTED_SHA1}, received ${sha1}.`);
}

console.log(`Android release signing SHA-1 verified: ${sha1}`);
