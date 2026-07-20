import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const RC_VERSION = "1.1.1";
const RC_VERSION_CODE = 17;
const FREE_MESSAGE = "CapDent is currently free for all clinics.";

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function replaceExact(text, from, to, label) {
  if (to && text.includes(to)) {
    console.log(`${label}: already applied`);
    return text;
  }

  const count = countOccurrences(text, from);
  if (count === 0 && !to) {
    console.log(`${label}: already applied`);
    return text;
  }
  if (count !== 1) {
    throw new Error(`${label}: expected one source block, found ${count}`);
  }

  console.log(`${label}: applied`);
  return text.replace(from, to);
}

function replaceRegex(text, pattern, replacement, label, alreadyApplied) {
  if (alreadyApplied && text.includes(alreadyApplied)) {
    console.log(`${label}: already applied`);
    return text;
  }

  const matches = text.match(pattern);
  if (!matches) {
    throw new Error(`${label}: source block not found`);
  }

  console.log(`${label}: applied`);
  return text.replace(pattern, replacement);
}

function updateTextFile(path, transform) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  const original = readFileSync(path, "utf8");
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const normalized = original.replace(/\r\n/g, "\n");
  const updated = transform(normalized);

  if (updated === normalized) {
    console.log(`${path}: no changes needed`);
    return;
  }

  writeFileSync(path, updated.replace(/\n/g, lineEnding), "utf8");
  console.log(`${path}: updated`);
}

function updateJsonFile(path, transform) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  transform(parsed);
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  console.log(`${path}: updated`);
}

function patchSupabase() {
  updateTextFile("src/lib/supabase.ts", (text) => {
    text = replaceExact(
      text,
      `export const FREE_PATIENT_WARNING_REMAINING = 10;`,
      `export const FREE_PATIENT_WARNING_REMAINING = 10;\nexport const CAPDENT_CURRENTLY_FREE_MESSAGE = "${FREE_MESSAGE}";`,
      "Free-access message"
    );

    text = replaceRegex(
      text,
      /function paidSubscriptionAllowsUnlimitedPatients\(subscription: any\) \{[\s\S]*?\n\}\n\nfunction patientLimitMessage\(remaining: number\) \{[\s\S]*?\n\}\n\nasync function getClinicPatientLimitStatusForClinic\(clinicId: string\): Promise<ClinicPatientLimitStatus> \{[\s\S]*?\n\}\n/,
      `async function getClinicPatientLimitStatusForClinic(\n  clinicId: string\n): Promise<ClinicPatientLimitStatus> {\n  const { count, error } = await supabase\n    .from("patients")\n    .select("id", { count: "exact", head: true })\n    .eq("clinic_id", clinicId);\n\n  if (error) throw error;\n\n  return {\n    count: count ?? 0,\n    limit: FREE_PATIENT_LIMIT,\n    remaining: null,\n    unlimited: true,\n    level: "none",\n    message: CAPDENT_CURRENTLY_FREE_MESSAGE,\n  };\n}\n`,
      "Remove 100-patient enforcement",
      "message: CAPDENT_CURRENTLY_FREE_MESSAGE"
    );

    return text;
  });
}

function patchRootLayout() {
  updateTextFile("src/app/_layout.tsx", (text) => {
    text = replaceExact(
      text,
      `import { Stack, router, usePathname } from "expo-router";`,
      `import { Stack } from "expo-router";`,
      "Root layout router import"
    );

    text = replaceExact(
      text,
      `import { useEffect, type ReactNode } from "react";\n`,
      ``,
      "Remove subscription-gate React import"
    );

    text = replaceExact(
      text,
      `import { getClinicSubscription, getSubscriptionAccess } from "@/lib/subscription";\n`,
      ``,
      "Remove subscription-gate data import"
    );

    if (text.includes("function SubscriptionGate")) {
      text = replaceRegex(
        text,
        /function isSubscriptionOpenPath\(pathname: string\) \{[\s\S]*?\n\}\n\nfunction SubscriptionGate\(\{ children \}: \{ children: ReactNode \}\) \{[\s\S]*?\n\}\n\nfunction RootStack/,
        `function RootStack`,
        "Remove runtime subscription gate"
      );
    } else {
      console.log("Remove runtime subscription gate: already applied");
    }

    text = replaceExact(text, `    <SubscriptionGate>`, `    <>`, "Root wrapper open");
    text = replaceExact(text, `    </SubscriptionGate>`, `    </>`, "Root wrapper close");
    return text;
  });
}

function patchVisitFlow() {
  updateTextFile("src/app/patient/visit.tsx", (text) => {
    text = replaceExact(
      text,
      `  const treatmentCostValue = toNumber(treatmentCost);\n  const paidNowValue = toNumber(paidAmount);\n  const balanceAfterVisit = Math.max(pendingBalance + treatmentCostValue - paidNowValue, 0);\n  const hasActiveTreatment = activeTreatments.length > 0;`,
      `  const treatmentCostValue = toNumber(treatmentCost);\n  const paidNowValue = toNumber(paidAmount);\n  const ongoingPaidValue = toNumber(ongoingPaidAmount);\n  const hasActiveTreatment = activeTreatments.length > 0;\n  const balanceAfterVisit =\n    hasActiveTreatment && treatmentFlow === "ongoing"\n      ? Math.max(pendingBalance - ongoingPaidValue, 0)\n      : Math.max(pendingBalance + treatmentCostValue - paidNowValue, 0);`,
      "Ongoing-payment balance preview"
    );

    text = replaceExact(
      text,
      `      Alert.alert("Invalid appointment", "Follow-up must be within clinic hours and in the future.");`,
      `      Alert.alert("Invalid appointment", "Follow-up must be in the future.");`,
      "Follow-up validation message"
    );

    text = replaceExact(
      text,
      `    const shouldCreateTreatment = !continuingExistingTreatment && Boolean(treatmentName.trim() || cost > 0);\n    const newTreatmentDueAfterVisit = shouldCreateTreatment ? Math.max(cost - paid, 0) : 0;\n    const existingTreatmentDueAfterVisit = continuingExistingTreatment\n      ? Math.max(activeTreatmentDue - ongoingCollected, 0)\n      : 0;\n    const shouldCompleteNewTreatment = shouldCreateTreatment && !followupDateTime && newTreatmentDueAfterVisit <= 0;\n    const shouldCompleteExistingTreatment = continuingExistingTreatment && !followupDateTime && existingTreatmentDueAfterVisit <= 0;`,
      `    const shouldCreateTreatment = !continuingExistingTreatment && Boolean(treatmentName.trim() || cost > 0);\n    const shouldCompleteNewTreatment = shouldCreateTreatment && !followupDateTime;\n    const shouldCompleteExistingTreatment = continuingExistingTreatment && !followupDateTime;`,
      "Separate treatment status from payment status"
    );

    text = replaceExact(
      text,
      `        doctor_notes: continuingExistingTreatment\n          ? \`Ongoing treatment visit: \${primaryActiveTreatment?.treatment_name || "existing treatment"}. \${\n              followupDateTime\n                ? "Follow-up planned; treatment remains ongoing."\n                : shouldCompleteExistingTreatment\n                  ? "No due and no follow-up; treatment marked completed."\n                  : "Pending due remains; treatment stays ongoing."\n            }\`\n          : undefined,`,
      `        doctor_notes: continuingExistingTreatment\n          ? \`Ongoing treatment visit: \${primaryActiveTreatment?.treatment_name || "existing treatment"}. \${\n              followupDateTime\n                ? "Follow-up planned; treatment remains ongoing."\n                : "No follow-up; treatment marked completed. Any pending payment remains separate."\n            }\`\n          : undefined,`,
      "Ongoing-treatment clinical note"
    );

    text = replaceExact(
      text,
      `        treatment_status: shouldCompleteNewTreatment ? "completed" : undefined,`,
      `        treatment_status: shouldCreateTreatment\n          ? shouldCompleteNewTreatment\n            ? "completed"\n            : "ongoing"\n          : undefined,`,
      "New-treatment status"
    );

    text = replaceExact(
      text,
      `        continuingExistingTreatment\n          ? followupDateTime\n            ? "Visit saved under the existing treatment. Follow-up added, so treatment remains ongoing."\n            : shouldCompleteExistingTreatment\n              ? "Visit saved under the existing treatment. No due and no follow-up, so treatment is marked completed."\n              : "Visit saved under the existing treatment. Pending due remains, so treatment stays ongoing."\n          : \`Visit saved under \${selectedDoctor?.name || "selected doctor"} and patient removed from waiting queue.\`,`,
      `        continuingExistingTreatment\n          ? followupDateTime\n            ? "Visit saved under the existing treatment. Follow-up added, so treatment remains ongoing."\n            : "Visit saved under the existing treatment. No follow-up, so treatment is marked completed. Any pending payment remains separate."\n          : \`Visit saved under \${selectedDoctor?.name || "selected doctor"} and patient removed from waiting queue.\`,`,
      "Visit success message"
    );

    text = replaceExact(
      text,
      `                  Ongoing + no due + no follow-up = completed. Pending due or follow-up keeps it ongoing.`,
      `                  Follow-up keeps treatment ongoing. No follow-up marks treatment completed; any pending payment remains separate.`,
      "Ongoing-treatment helper"
    );

    text = replaceExact(
      text,
      `      <SectionCard title="Follow-up Appointment" subtitle="Optional. Allowed timings: 11:00 AM-1:30 PM and 5:00 PM-7:30 PM only.">`,
      `      <SectionCard title="Follow-up Appointment" subtitle="Optional. Choose a future date and one of the suggested time slots.">`,
      "Follow-up section wording"
    );

    return text;
  });
}

function patchUploadQuality() {
  updateTextFile("src/app/patient/upload.tsx", (text) => {
    text = replaceExact(
      text,
      `      quality: 0.78,`,
      `      quality: type === "xray" || type === "report" ? 0.76 : 0.64,`,
      "Camera upload compression"
    );
    text = replaceExact(
      text,
      `      quality: 0.82,`,
      `      quality: type === "xray" || type === "report" ? 0.76 : 0.64,`,
      "Gallery upload compression"
    );
    return text;
  });
}

function patchSubscriptionScreen() {
  updateTextFile("src/app/settings/subscription.tsx", (text) => {
    text = replaceExact(
      text,
      `const RUPEE = "\\u20B9";`,
      `const RUPEE = "\\u20B9";\nconst PAID_PLANS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true";`,
      "Paid-plan feature flag"
    );

    text = replaceExact(
      text,
      `  const [billingError, setBillingError] = useState<string | null>(googlePlayBillingUnavailableReason());`,
      `  const [billingError, setBillingError] = useState<string | null>(\n    PAID_PLANS_ENABLED ? googlePlayBillingUnavailableReason() : null\n  );`,
      "Billing error initialization"
    );

    text = replaceExact(
      text,
      `  const subscriptionInfo = getSubscriptionDisplay(subscription);\n  const access = getSubscriptionAccess(subscription);\n  const currentPlan = getClinicPlanName(subscription);\n  const googlePlayLinked = hasGooglePlayAutopay(subscription);`,
      `  const effectiveSubscription = PAID_PLANS_ENABLED ? subscription : null;\n  const subscriptionInfo = getSubscriptionDisplay(effectiveSubscription);\n  const access = getSubscriptionAccess(effectiveSubscription);\n  const currentPlan = getClinicPlanName(effectiveSubscription);\n  const googlePlayLinked = hasGooglePlayAutopay(effectiveSubscription);`,
      "Effective free subscription"
    );

    text = replaceExact(
      text,
      `  async function load() {\n    try {\n      setLoading(true);\n      const subscriptionData = await getClinicSubscription();\n      setSubscription(subscriptionData);`,
      `  async function load() {\n    try {\n      setLoading(true);\n      if (!PAID_PLANS_ENABLED) {\n        setSubscription(null);\n        return;\n      }\n      const subscriptionData = await getClinicSubscription();\n      setSubscription(subscriptionData);`,
      "Disable subscription loading"
    );

    text = replaceExact(
      text,
      `  async function loadBillingPlans() {\n    if (Platform.OS !== "android") {`,
      `  async function loadBillingPlans() {\n    if (!PAID_PLANS_ENABLED) {\n      setBillingPlans([]);\n      setBillingError(null);\n      return [] as GooglePlayBillingPlan[];\n    }\n\n    if (Platform.OS !== "android") {`,
      "Disable billing-plan loading"
    );

    text = replaceExact(
      text,
      `  useEffect(() => {\n    loadBillingPlans();\n\n    const cleanup = addGooglePlayPurchaseListeners({`,
      `  useEffect(() => {\n    if (!PAID_PLANS_ENABLED) {\n      setBillingPlans([]);\n      setBillingError(null);\n      return;\n    }\n\n    loadBillingPlans();\n\n    const cleanup = addGooglePlayPurchaseListeners({`,
      "Disable billing listeners"
    );

    text = replaceExact(
      text,
      `    <Screen refreshing={loading || loadingBilling} onRefresh={() => { load(); loadBillingPlans(); }}>`,
      `    <Screen\n      refreshing={loading || (PAID_PLANS_ENABLED && loadingBilling)}\n      onRefresh={() => {\n        load();\n        if (PAID_PLANS_ENABLED) loadBillingPlans();\n      }}\n    >`,
      "Subscription refresh behavior"
    );

    text = replaceExact(
      text,
      `          {paidPlanActive ? "Subscription" : "Plans"}`,
      `          {PAID_PLANS_ENABLED && paidPlanActive ? "Subscription" : "Free Access"}`,
      "Subscription title"
    );

    text = replaceExact(
      text,
      `          {paidPlanActive\n            ? "Your paid plan is active. Manage cancellation through Google Play only."\n            : "Start professionally on Free. Grow without limits on Professional. Understand the clinic deeply with Intelligence."}`,
      `          {!PAID_PLANS_ENABLED\n            ? "CapDent is currently free for all clinics. Paid plans will appear only after official store subscriptions are enabled."\n            : paidPlanActive\n              ? "Your paid plan is active. Manage cancellation through Google Play only."\n              : "Start professionally on Free. Grow without limits on Professional. Understand the clinic deeply with Intelligence."}`,
      "Subscription subtitle"
    );

    text = replaceExact(
      text,
      `      {paidPlanActive ? (`,
      `      {!PAID_PLANS_ENABLED ? (\n        <SectionCard title="Free Access" subtitle="No subscription is required for this release.">\n          <FreePlanCard currentPlan="free" />\n          <FeatureRow\n            icon="shield-checkmark-outline"\n            label="CapDent is currently free for all clinics, with core patient, visit, payment, appointment, report, and staff workflows available."\n          />\n          <FeatureRow\n            icon="cloud-outline"\n            label="Billing code and subscription records are preserved for a later store-enabled release, but they do not block clinic work now."\n          />\n        </SectionCard>\n      ) : paidPlanActive ? (`,
      "Free-access plan section"
    );

    text = replaceExact(
      text,
      `        {!paidPlanActive ? (`,
      `        {PAID_PLANS_ENABLED && !paidPlanActive ? (`,
      "Hide reload-billing action"
    );

    return text;
  });
}

function patchEnvExample() {
  updateTextFile(".env.example", (text) => {
    if (text.includes("EXPO_PUBLIC_ENABLE_PAID_PLANS=")) {
      console.log("Environment feature flags: already applied");
      return text;
    }

    console.log("Environment feature flags: applied");
    return `${text.trimEnd()}\n\n# Release feature flags. Keep disabled until separately tested and approved.\nEXPO_PUBLIC_ENABLE_PAID_PLANS=false\nEXPO_PUBLIC_ENABLE_REALTIME=false\n\n# Clinical uploads use Supabase Storage.\n`;
  });
}

function patchManagedConfig() {
  updateJsonFile("app.json", (config) => {
    const expo = config.expo ?? (config.expo = {});
    expo.version = RC_VERSION;
    const android = expo.android ?? (expo.android = {});
    android.versionCode = RC_VERSION_CODE;

    const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
    for (const plugin of plugins) {
      if (Array.isArray(plugin) && plugin[0] === "expo-build-properties") {
        plugin[1] ??= {};
        plugin[1].android ??= {};
        plugin[1].android.compileSdkVersion = 36;
        plugin[1].android.targetSdkVersion = 36;
        delete plugin[1].android.buildToolsVersion;
      }
    }
  });

  updateJsonFile("eas.json", (config) => {
    for (const profile of Object.values(config.build ?? {})) {
      profile.env ??= {};
      profile.env.EXPO_PUBLIC_ENABLE_PAID_PLANS = "false";
      profile.env.EXPO_PUBLIC_ENABLE_REALTIME = "false";
    }
  });

  updateJsonFile("package.json", (config) => {
    config.version = RC_VERSION;
    config.scripts ??= {};
    config.scripts["apply:android-rc"] = "node scripts/apply-android-rc-2026-07-17.mjs";
    config.scripts["check:android-rc"] = "npm run typecheck";
  });
}

function patchNativeAndroidIfPresent() {
  const appGradle = "android/app/build.gradle";
  if (existsSync(appGradle)) {
    const backup = `${appGradle}.before-capdent-rc`;
    if (!existsSync(backup)) copyFileSync(appGradle, backup);

    updateTextFile(appGradle, (text) => {
      const versionCodePattern = /versionCode\s+\d+/;
      const versionNamePattern = /versionName\s+["'][^"']+["']/;
      if (!versionCodePattern.test(text)) throw new Error("Native versionCode was not found");
      if (!versionNamePattern.test(text)) throw new Error("Native versionName was not found");
      return text
        .replace(versionCodePattern, `versionCode ${RC_VERSION_CODE}`)
        .replace(versionNamePattern, `versionName "${RC_VERSION}"`);
    });
  } else {
    console.log("android/app/build.gradle: not present; managed/EAS config only");
  }

  const rootGradle = "android/build.gradle";
  if (existsSync(rootGradle)) {
    const backup = `${rootGradle}.before-capdent-rc`;
    if (!existsSync(backup)) copyFileSync(rootGradle, backup);

    updateTextFile(rootGradle, (text) => {
      let updated = text;
      updated = updated.replace(/compileSdkVersion\s*=\s*\d+/, "compileSdkVersion = 36");
      updated = updated.replace(/targetSdkVersion\s*=\s*\d+/, "targetSdkVersion = 36");
      return updated;
    });
  }
}

function verify() {
  const checks = [
    ["src/lib/supabase.ts", "CAPDENT_CURRENTLY_FREE_MESSAGE"],
    ["src/app/_layout.tsx", "<SubscriptionGate>"],
    ["src/app/patient/visit.tsx", "Any pending payment remains separate."],
    ["src/app/settings/subscription.tsx", "PAID_PLANS_ENABLED"],
    [".env.example", "EXPO_PUBLIC_ENABLE_PAID_PLANS=false"],
  ];

  for (const [path, marker] of checks) {
    const text = readFileSync(path, "utf8");
    if (path === "src/app/_layout.tsx") {
      if (text.includes(marker)) throw new Error("Subscription gate is still present");
    } else if (!text.includes(marker)) {
      throw new Error(`${path}: verification marker missing: ${marker}`);
    }
  }

  const appConfig = JSON.parse(readFileSync("app.json", "utf8"));
  if (appConfig.expo?.version !== RC_VERSION || appConfig.expo?.android?.versionCode !== RC_VERSION_CODE) {
    throw new Error("app.json version verification failed");
  }

  console.log("Android RC source verification passed.");
}

function runTypecheck() {
  console.log("Running TypeScript validation...");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "typecheck"], {
    stdio: "inherit",
  });
}

patchSupabase();
patchRootLayout();
patchVisitFlow();
patchUploadQuality();
patchSubscriptionScreen();
patchEnvExample();
patchManagedConfig();
patchNativeAndroidIfPresent();
verify();
runTypecheck();

console.log("\nCapDent Android release-candidate updates applied successfully.");
console.log(`Version: ${RC_VERSION} (${RC_VERSION_CODE})`);
console.log("Paid plans: disabled");
console.log("Realtime: disabled");
console.log("Clinic workflows: preserved for Android testing");
