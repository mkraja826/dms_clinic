import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const read = (path) => readFileSync(path, "utf8");

const app = readJson("app.json");
const pkg = readJson("package.json");
const eas = readJson("eas.json");

expect(app.expo?.version === "1.2.8", "V28 RC must use Expo version 1.2.8.");
expect(app.expo?.android?.versionCode === 28, "V28 RC must use Android versionCode 28.");
expect(app.expo?.android?.package === "com.dms.clinic", "V28 RC must keep Android package com.dms.clinic.");
expect(pkg.version === "1.2.8", "V28 RC package.json version must be 1.2.8.");
expect(app.expo?.android?.allowBackup === false, "V28 RC must keep Android backup disabled.");
expect(app.expo?.android?.blockedPermissions?.includes("com.google.android.gms.permission.AD_ID"), "V28 RC must keep advertising ID permission blocked.");

const productionEnv = eas.build?.production?.env || {};
expect(productionEnv.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true", "V28 production must enable paid plans.");
expect(productionEnv.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true", "V28 production must enable Firebase Analytics.");
expect(productionEnv.EXPO_PUBLIC_ENABLE_REALTIME === "true", "V28 production must enable realtime.");
expect(productionEnv.EXPO_PUBLIC_ENABLE_PAYMENT_PUSH === "true", "V28 production must enable payment push.");
expect(productionEnv.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS === "true", "V28 production must require signed storage URLs.");

for (const path of [
  "src/app/reception/counter-payment.tsx",
  "src/app/settings/patient-payments.tsx",
  "src/app/settings/payment-qr-accounts.tsx",
  "src/lib/manualPaymentQr.ts",
  "src/app/reports/online-payments.tsx",
  "src/app/reports/reconciliation-required.tsx",
  "supabase/migrations/20260829232000_capdent_v28_manual_qr_accounts.sql",
  "supabase/migrations/20260830002500_capdent_v28_manual_qr_collection_confirmation.sql",
]) {
  expect(existsSync(path), `V28 RC required path is missing: ${path}`);
}

const manualQrClient = existsSync("src/lib/manualPaymentQr.ts") ? read("src/lib/manualPaymentQr.ts") : "";
const counterScreen = existsSync("src/app/reception/counter-payment.tsx") ? read("src/app/reception/counter-payment.tsx") : "";
const qrSettings = existsSync("src/app/settings/payment-qr-accounts.tsx") ? read("src/app/settings/payment-qr-accounts.tsx") : "";
const qrAccountsMigration = existsSync("supabase/migrations/20260829232000_capdent_v28_manual_qr_accounts.sql")
  ? read("supabase/migrations/20260829232000_capdent_v28_manual_qr_accounts.sql")
  : "";
const qrConfirmationMigration = existsSync("supabase/migrations/20260830002500_capdent_v28_manual_qr_collection_confirmation.sql")
  ? read("supabase/migrations/20260830002500_capdent_v28_manual_qr_collection_confirmation.sql")
  : "";

expect(manualQrClient.includes('MANUAL_QR_BUCKET = "clinic-payment-qr"'), "Manual QR client must use the private clinic-payment-qr bucket.");
expect(manualQrClient.includes('.createSignedUrls(paths, 60 * 10)'), "Manual QR display must use short-lived signed URLs.");
expect(manualQrClient.includes('supabase.rpc("confirm_manual_qr_collection"'), "Manual QR receipt confirmation must call the audited confirmation RPC.");
expect(manualQrClient.includes('["owner", "head_doctor"].includes(profile.role)'), "Manual QR account management must remain restricted to owner/head doctor.");

expect(counterScreen.includes("Confirm payment received?"), "Reception must explicitly ask staff to confirm receipt before recording payment.");
expect(counterScreen.includes("Received & Record"), "Reception must expose an explicit receipt-confirmation action.");
expect(counterScreen.includes("Record payment only after reception verifies the money was received."), "Reception must warn that displaying a QR does not prove payment.");
expect(counterScreen.includes("confirmManualQrCollection"), "Reception must use the audited manual QR collection path.");
expect(!counterScreen.includes('supabase.functions.invoke("create-counter-payment-checkout"'), "Reception manual QR collection must not depend on provider checkout creation.");

expect(qrSettings.includes("uploadManualPaymentQrImage"), "Payment QR settings must support authenticated QR image upload.");
expect(qrSettings.includes("createManualPaymentQrAccount"), "Payment QR settings must support clinic QR account creation.");

expect(qrAccountsMigration.includes("create table if not exists public.clinic_payment_qr_accounts"), "Manual QR accounts migration must create clinic_payment_qr_accounts.");
expect(qrAccountsMigration.includes("'clinic-payment-qr'"), "Manual QR accounts migration must provision the clinic-payment-qr bucket.");
expect(qrAccountsMigration.includes("false,"), "Manual QR storage bucket must remain private.");
expect(qrAccountsMigration.includes("clinic_payment_qr_accounts_insert_owner"), "Manual QR account writes must retain owner/head-doctor RLS.");
expect(qrAccountsMigration.includes("clinic_payment_qr_read_clinic"), "Manual QR storage reads must retain clinic-scoped RLS.");

expect(qrConfirmationMigration.includes("create table if not exists public.manual_qr_collection_audit"), "Manual QR confirmation migration must create an audit trail.");
expect(qrConfirmationMigration.includes("security definer"), "Manual QR confirmation RPC must remain a security-definer function with explicit authorization checks.");
expect(qrConfirmationMigration.includes("collect_reception_fee"), "Manual QR confirmation must preserve collect_reception_fee as the financial ledger source of truth.");
expect(qrConfirmationMigration.includes("v_role not in ('owner', 'head_doctor', 'receptionist')"), "Manual QR confirmation must remain limited to authorized reception roles.");
expect(qrConfirmationMigration.includes("revoke all on function public.confirm_manual_qr_collection"), "Manual QR confirmation RPC must revoke broad execution before granting authenticated access.");

if (failures.length) {
  console.error(`CapDent V28 RC validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 release-candidate validation passed.");
