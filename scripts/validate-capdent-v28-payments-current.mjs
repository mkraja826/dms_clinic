import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFileSync(path, "utf8");

const paths = {
  manualQrMigration: "supabase/migrations/20260829232000_capdent_v28_manual_qr_accounts.sql",
  manualQrClient: "src/lib/manualPaymentQr.ts",
  ownerScreen: "src/app/settings/patient-payments.tsx",
  qrAccountsScreen: "src/app/settings/payment-qr-accounts.tsx",
};

for (const path of Object.values(paths)) {
  expect(existsSync(path), `Required V28 manual QR path is missing: ${path}`);
}

if (!failures.length) {
  const migration = read(paths.manualQrMigration);
  const client = read(paths.manualQrClient);
  const ownerScreen = read(paths.ownerScreen);
  const qrAccountsScreen = read(paths.qrAccountsScreen);

  expect(
    migration.includes("create table if not exists public.clinic_payment_qr_accounts"),
    "V28 must define clinic-managed payment QR accounts."
  );
  expect(
    migration.includes("clinic_payment_qr_accounts_one_default_idx") &&
      migration.includes("where is_default = true and is_active = true"),
    "V28 must allow only one active default QR per clinic."
  );
  expect(
    migration.includes("clinic_payment_qr_accounts_select_clinic") &&
      migration.includes("p.clinic_id = clinic_payment_qr_accounts.clinic_id"),
    "QR account reads must remain clinic-scoped."
  );
  expect(
    migration.includes("clinic_payment_qr_accounts_insert_owner") &&
      migration.includes("clinic_payment_qr_accounts_update_owner") &&
      migration.includes("clinic_payment_qr_accounts_delete_owner") &&
      migration.includes("('owner', 'head_doctor')"),
    "Only owner/head doctor may manage clinic QR accounts."
  );
  expect(
    migration.includes("'clinic-payment-qr'") &&
      migration.includes("false") &&
      migration.includes("5242880") &&
      migration.includes("image/png") &&
      migration.includes("image/jpeg") &&
      migration.includes("image/webp"),
    "V28 QR images must use the private clinic-payment-qr bucket with bounded image types and size."
  );
  expect(
    migration.includes("storage.foldername(name)") &&
      migration.includes("p.clinic_id::text"),
    "QR storage access must remain within the authenticated clinic folder."
  );
  expect(
    migration.includes("Displaying a QR never proves or records payment"),
    "The manual QR foundation must explicitly keep display separate from payment confirmation."
  );

  expect(
    client.includes("clinic_payment_qr_accounts") && client.includes("clinic-payment-qr"),
    "Manual QR client must use the dedicated table and private storage bucket."
  );
  expect(
    client.includes("createSignedUrl") || client.includes("createSignedUrls"),
    "Manual QR images must be displayed with signed private-storage URLs."
  );
  expect(
    client.includes("is_default") && client.includes("is_active"),
    "Manual QR client must support default and active state."
  );

  expect(
    qrAccountsScreen.includes("Payment QR") &&
      qrAccountsScreen.includes("Set as Default") &&
      (qrAccountsScreen.includes("Disable") || qrAccountsScreen.includes("Deactivate")) &&
      (qrAccountsScreen.includes("Delete") || qrAccountsScreen.includes("Remove")),
    "Owner QR settings must expose multiple QR management actions."
  );
  expect(
    qrAccountsScreen.includes("owner") && qrAccountsScreen.includes("head_doctor"),
    "QR management UI must remain owner/head-doctor only."
  );
  expect(
    ownerScreen.includes("Payment QR") &&
      ownerScreen.toLowerCase().includes("manual") &&
      !ownerScreen.includes("Connect Card Receiving Account") &&
      !ownerScreen.includes("Add PhonePe Merchant Account"),
    "V28 Patient Payments settings must expose manual QR mode rather than unfinished provider onboarding."
  );
}

if (failures.length) {
  console.error(`CapDent V28 current payment validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 manual clinic QR payment architecture validation passed.");
