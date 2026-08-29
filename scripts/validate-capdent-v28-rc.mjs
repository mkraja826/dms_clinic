import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const read = (path) => readFileSync(path, "utf8");

const app = readJson("app.json");
const pkg = readJson("package.json");
const config = read("supabase/config.toml");

expect(app.expo?.version === "1.2.8", "V28 RC must use Expo version 1.2.8.");
expect(app.expo?.android?.versionCode === 28, "V28 RC must use Android versionCode 28.");
expect(app.expo?.android?.package === "com.dms.clinic", "V28 RC must keep Android package com.dms.clinic.");
expect(pkg.version === "1.2.8", "V28 RC package.json version must be 1.2.8.");

for (const path of [
  "src/app/reception/counter-payment.tsx",
  "src/lib/counterPayments.ts",
  "src/app/settings/phonepe-accounts.tsx",
  "src/app/reports/online-payments.tsx",
  "src/app/reports/reconciliation-required.tsx",
  "supabase/functions/create-counter-payment-checkout/index.ts",
  "supabase/functions/get-counter-payment-qr/index.ts",
  "supabase/functions/phonepe-patient-payment-webhook/index.ts",
  "supabase/functions/manage-phonepe-payment-accounts/index.ts",
  "supabase/migrations/20260827190000_capdent_v28_multiple_payment_accounts.sql",
  "supabase/migrations/20260827211500_capdent_v28_phonepe_account_verification_lifecycle.sql",
  "supabase/migrations/20260827224500_capdent_v28_counter_qr_payments.sql",
  "supabase/migrations/20260827233000_capdent_v28_counter_qr_lifecycle_hardening.sql",
  "supabase/migrations/20260827201500_capdent_v28_cancel_counter_qr.sql",
]) {
  expect(existsSync(path), `V28 RC required path is missing: ${path}`);
}

for (const section of [
  "[functions.create-patient-payment-checkout]",
  "[functions.phonepe-patient-payment-webhook]",
  "[functions.manage-phonepe-payment-accounts]",
  "[functions.create-counter-payment-checkout]",
  "[functions.get-counter-payment-qr]",
]) {
  expect(config.includes(section), `Supabase config is missing ${section}`);
}

const counterClient = existsSync("src/lib/counterPayments.ts") ? read("src/lib/counterPayments.ts") : "";
const counterScreen = existsSync("src/app/reception/counter-payment.tsx") ? read("src/app/reception/counter-payment.tsx") : "";
const webhook = existsSync("supabase/functions/phonepe-patient-payment-webhook/index.ts") ? read("supabase/functions/phonepe-patient-payment-webhook/index.ts") : "";

expect(counterClient.includes('supabase.functions.invoke("create-counter-payment-checkout"'), "Counter QR must use the isolated checkout Edge Function.");
expect(counterClient.includes('supabase.rpc("cancel_v28_counter_payment_request"'), "Counter QR replacement must retire the previous request server-side.");
expect(counterScreen.includes("Payment needs review") && counterScreen.includes("QR expired"), "Reception counter screen must expose review and expiry states.");
expect(webhook.includes("WEBHOOK_VERIFIABLE_REQUEST_STATES"), "PhonePe webhook must retain late-payment verification states.");
expect(webhook.includes("record_v28_verified_provider_event") && webhook.includes("reconcile_v28_verified_patient_payment"), "PhonePe webhook must pass through trusted verification and reconciliation gates.");

if (failures.length) {
  console.error(`CapDent V28 RC validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 release-candidate validation passed.");
