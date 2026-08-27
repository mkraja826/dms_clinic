import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFileSync(path, "utf8");

const paths = {
  accountMigration: "supabase/migrations/20260826173000_capdent_v28_clinic_payment_accounts.sql",
  multiAccountMigration: "supabase/migrations/20260827190000_capdent_v28_multiple_payment_accounts.sql",
  verificationMigration: "supabase/migrations/20260827211500_capdent_v28_phonepe_account_verification_lifecycle.sql",
  counterMigration: "supabase/migrations/20260827224500_capdent_v28_counter_qr_payments.sql",
  lifecycleMigration: "supabase/migrations/20260827233000_capdent_v28_counter_qr_lifecycle_hardening.sql",
  cancelMigration: "supabase/migrations/20260827201500_capdent_v28_cancel_counter_qr.sql",
  checkout: "supabase/functions/create-patient-payment-checkout/index.ts",
  counterCheckout: "supabase/functions/create-counter-payment-checkout/index.ts",
  qrFunction: "supabase/functions/get-counter-payment-qr/index.ts",
  phonePeWebhook: "supabase/functions/phonepe-patient-payment-webhook/index.ts",
  managePhonePe: "supabase/functions/manage-phonepe-payment-accounts/index.ts",
  counterClient: "src/lib/counterPayments.ts",
  counterScreen: "src/app/reception/counter-payment.tsx",
  ownerScreen: "src/app/settings/patient-payments.tsx",
  phonePeAccounts: "src/app/settings/phonepe-accounts.tsx",
  config: "supabase/config.toml",
};

for (const path of Object.values(paths)) expect(existsSync(path), `Required V28 payment path is missing: ${path}`);

if (!failures.length) {
  const accountMigration = read(paths.accountMigration);
  const multi = read(paths.multiAccountMigration);
  const verification = read(paths.verificationMigration);
  const counter = read(paths.counterMigration);
  const lifecycle = read(paths.lifecycleMigration);
  const cancel = read(paths.cancelMigration);
  const checkout = read(paths.checkout);
  const counterCheckout = read(paths.counterCheckout);
  const qrFunction = read(paths.qrFunction);
  const webhook = read(paths.phonePeWebhook);
  const managePhonePe = read(paths.managePhonePe);
  const counterClient = read(paths.counterClient);
  const counterScreen = read(paths.counterScreen);
  const ownerScreen = read(paths.ownerScreen);
  const phonePeAccounts = read(paths.phonePeAccounts);
  const config = read(paths.config);

  expect(accountMigration.includes("create table if not exists public.clinic_payment_accounts"), "Clinic payment account table is required.");
  expect(accountMigration.includes("revoke all on table public.clinic_payment_accounts from anon, authenticated"), "Android must not directly mutate clinic payment accounts.");
  expect(multi.includes("account_label") && multi.includes("is_default"), "Multiple receiving accounts must have labels and a default flag.");
  expect(multi.includes("provider_merchant_id") && multi.toLowerCase().includes("unique"), "Duplicate clinic merchant identities must be constrained.");

  expect(verification.includes("verification_status") && verification.includes("verified"), "Merchant verification lifecycle is required.");
  expect(verification.includes("service_role"), "Merchant verification transition must be service-role gated.");

  expect(managePhonePe.includes('new Set(["owner", "head_doctor"])'), "Only owner/head doctor may manage PhonePe accounts.");
  expect(managePhonePe.includes("verification_status") && managePhonePe.includes("pending"), "New PhonePe accounts must remain pending until trusted verification.");
  expect(ownerScreen.includes("Manage PhonePe Accounts") || ownerScreen.includes("Add PhonePe Merchant Account"), "Owner payment settings must expose PhonePe account management.");
  expect(
    phonePeAccounts.includes("setDefaultPhonePePaymentAccount") && phonePeAccounts.includes("disablePhonePePaymentAccount") &&
      phonePeAccounts.includes("Set as Default") && phonePeAccounts.includes("Disable Account"),
    "PhonePe account screen must support default selection and disable actions."
  );

  expect(checkout.includes('String(requestRow.country_code).toUpperCase() === "IN"') && checkout.includes("Indian clinics must use PhonePe"), "Card checkout must refuse explicitly Indian clinic requests.");
  expect(checkout.includes("verification_status") && checkout.includes('account.verification_status !== "verified"'), "Checkout must require the locked receiving account to remain verified.");
  expect(checkout.includes("payment_account_id") && checkout.includes("Payment request was already claimed or changed"), "Checkout must use the exact locked account and atomically claim the request.");

  expect(counter.includes("request_mode") && counter.includes("counter_qr"), "Counter QR request mode is required.");
  for (const category of ["op_fee", "xray_fee", "medication_fee", "treatment_fee", "pending_collection", "other"]) {
    expect(counter.includes(`'${category}'`), `Counter QR must support category ${category}.`);
  }
  expect(counter.includes("Entered amount exceeds the outstanding amount for the selected category"), "Counter QR amount must not exceed selected-category due.");
  expect(counter.includes("reconcile_v28_verified_counter_payment"), "Counter QR must have a dedicated trusted reconciliation path.");
  expect(counter.includes("insert into public.payments") && counter.includes("v_request.payment_category"), "Verified counter payment must enter the existing category ledger.");

  expect(counterCheckout.includes("payment_request_id") && counterCheckout.includes("request_mode"), "Counter checkout must require a prepared counter payment request.");
  expect(counterCheckout.includes("provider_merchant_id") && counterCheckout.includes("X-MERCHANT-ID"), "Counter checkout must identify the clinic merchant account.");
  expect(qrFunction.includes("qrSvg") || qrFunction.toLowerCase().includes("svg"), "Counter payment QR function must render a server-authorized checkout URL.");
  expect(counterClient.includes('supabase.functions.invoke("create-counter-payment-checkout"'), "Android counter flow must use isolated server checkout.");
  expect(counterClient.includes('supabase.rpc("cancel_v28_counter_payment_request"'), "Android must retire an old counter QR server-side.");
  expect(counterScreen.includes("Waiting for payment") && counterScreen.includes("Paid & recorded") && counterScreen.includes("Needs review"), "Reception UI must expose clear payment states.");
  expect(counterScreen.includes("QR expired") && counterScreen.includes("QR replaced"), "Reception UI must hide unusable QR states.");

  expect(webhook.includes("PHONEPE_WEBHOOK_USERNAME") && webhook.includes("PHONEPE_WEBHOOK_PASSWORD"), "PhonePe webhook must use server-only webhook credentials.");
  expect(webhook.includes("getPhonePeOrderStatus") && webhook.includes("verifiedMerchantId !== clinicMerchantId"), "Webhook must independently verify the exact clinic merchant.");
  expect(webhook.includes("verifiedAmountPaise !== expectedAmountPaise"), "Webhook must independently verify exact amount.");
  expect(webhook.includes("record_v28_verified_provider_event") && webhook.includes("reconcile_v28_verified_patient_payment"), "Webhook must use trusted provider-event and reconciliation gates.");
  expect(webhook.includes("WEBHOOK_VERIFIABLE_REQUEST_STATES") && webhook.includes("superseded") && webhook.includes("expired"), "Late payment verification for replaced/expired QR requests must remain auditable.");
  expect(!webhook.includes("raw_payload"), "Raw provider payloads must not be persisted.");

  expect(lifecycle.includes("late") || lifecycle.includes("superseded") || lifecycle.includes("expired"), "Counter QR lifecycle hardening migration is required.");
  expect(cancel.includes("cancel_v28_counter_payment_request"), "Explicit server-side counter QR cancellation is required.");

  const requiredConfig = [
    ["connect-card-payment-account", true],
    ["sync-card-payment-account", true],
    ["create-patient-payment-checkout", true],
    ["manage-phonepe-payment-accounts", true],
    ["create-counter-payment-checkout", true],
    ["get-counter-payment-qr", true],
    ["phonepe-patient-payment-webhook", false],
    ["stripe-patient-payment-webhook", false],
  ];
  for (const [name, jwt] of requiredConfig) {
    const section = `[functions.${name}]`;
    expect(config.includes(section), `Supabase config is missing ${section}`);
    const start = config.indexOf(section);
    const next = config.indexOf("\n[functions.", start + section.length);
    const block = start >= 0 ? config.slice(start, next >= 0 ? next : undefined) : "";
    expect(block.includes(`verify_jwt = ${jwt}`), `${name} verify_jwt must be ${jwt}.`);
  }
}

if (failures.length) {
  console.error(`CapDent V28 current payment validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 current payment architecture validation passed.");
