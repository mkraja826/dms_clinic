import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const notes = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const rcMode =
  process.argv.includes("--rc") || process.env.CAPDENT_V27_RC === "true";

try {
  execFileSync(process.execPath, ["scripts/validate-capdent-v26.mjs"], {
    stdio: "inherit",
  });
} catch {
  failures.push("V26 production baseline validation must continue to pass before V27 changes can ship.");
}

const patientsScreen = readText("src/app/(tabs)/patients.tsx");
const addPatientScreen = readText("src/app/patient/add.tsx");
const uploadScreen = readText("src/app/patient/upload.tsx");
const limits = readText("src/lib/v25Limits.ts");

expect(
  patientsScreen.includes("Plan & Patient Capacity"),
  "V27 Patients must expose the clinic plan and patient-capacity status."
);
expect(
  patientsScreen.includes("getCapDentEntitlementsV25") &&
    patientsScreen.includes("Patient Limit Reached"),
  "V27 Patients must use the existing server-authoritative entitlement service and show a blocked state."
);
expect(
  !addPatientScreen.includes("V25 Pricing Observation"),
  "V27 must not expose V25 pricing diagnostics in patient registration."
);
expect(
  addPatientScreen.includes("getCapDentEntitlementsV25") &&
    addPatientScreen.includes("patientQuotaMessage"),
  "V27 patient registration must preserve the server-authoritative patient quota check."
);
expect(
  uploadScreen.includes("getCapDentEntitlementsV25") &&
    uploadScreen.includes("uploadQuotaMessage"),
  "V27 clinical uploads must preserve the server-authoritative upload/storage quota check."
);
expect(
  uploadScreen.includes("Plan & Upload Capacity") &&
    uploadScreen.includes("formatStorageBytes"),
  "V27 clinical uploads must show proactive upload and storage usage before file selection."
);
expect(
  uploadScreen.includes("CAPDENT_V25_LIMITS.free.uploadWarningAt") &&
    uploadScreen.includes("Upload capacity is running low"),
  "V27 Free upload UX must warn from the finalized upload-warning threshold."
);
expect(
  uploadScreen.includes("uploadBlocked || uploading || done") &&
    uploadScreen.includes("View Plans"),
  "V27 upload UX must disable new upload submission when live entitlements block uploads and provide a plan action."
);
expect(
  limits.includes("patientLimit: 100") &&
    limits.includes("uploadLimit: 150") &&
    limits.includes("uploadWarningAt: 120") &&
    limits.includes("storageLimitBytes: 1024 * 1024 * 1024"),
  "V27 must preserve the finalized Free limits: 100 patients, warning at 120 uploads, 150 uploads, and 1 GB storage."
);
expect(
  existsSync("scripts/validate-capdent-v26.mjs"),
  "V26 baseline validator must remain present and unchanged in responsibility."
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
  const githubHeadRef = process.env.GITHUB_HEAD_REF?.trim() || "";
  const branchMatches =
    localBranch === "release/capdent-v27" ||
    githubRefName === "release/capdent-v27" ||
    githubHeadRef === "release/capdent-v27";

  expect(
    branchMatches,
    `V27 RC validation must run from release/capdent-v27 (local: ${localBranch || "detached"}, GitHub ref: ${githubRefName || "none"}, GitHub head: ${githubHeadRef || "none"}).`
  );
}

if (failures.length > 0) {
  console.error(`CapDent V27 validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CapDent V27 feature validation passed${rcMode ? " (RC mode)" : ""}.`);
for (const note of notes) console.log(`Note: ${note}`);
