import { readFileSync } from "node:fs";

const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const helper = readText("supabase/functions/_shared/phonepeV27.ts");
const createPayment = readText("supabase/functions/phonepe-create-payment/index.ts");
const checkPayment = readText("supabase/functions/phonepe-check-payment/index.ts");
const callback = readText("supabase/functions/phonepe-callback/index.ts");
const returnPage = readText("supabase/functions/phonepe-return/index.ts");
const migration = readText("supabase/migrations/20260826184500_capdent_v27_phonepe_invoice_payments.sql");
const environmentMigration = readText("supabase/migrations/20260827022000_capdent_v27_phonepe_environment_guard.sql");
const client = readText("src/lib/phonePePayments.ts");
const invoiceScreen = readText("src/app/reports/invoices.tsx");
const envExample = readText(".env.example");
const eas = JSON.parse(readText("eas.json"));

expect(
  helper.includes("https://api.phonepe.com/apis/pg") &&
    helper.includes("https://api.phonepe.com/apis/identity-manager") &&
    helper.includes("https://api-preprod.phonepe.com/apis/pg-sandbox") &&
    helper.includes("/v1/oauth/token") &&
    helper.includes("/checkout/v2/pay") &&
    helper.includes("/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true"),
  "V27 PhonePe server helper must use the current Standard Checkout OAuth, pay, and order-status endpoints for sandbox and production."
);
expect(
  helper.includes('requiredEnv("PHONEPE_CLIENT_ID")') &&
    helper.includes('requiredEnv("PHONEPE_CLIENT_SECRET")') &&
    helper.includes('requiredEnv("PHONEPE_CLIENT_VERSION")') &&
    helper.includes("PHONEPE_CALLBACK_USERNAME") &&
    helper.includes("PHONEPE_CALLBACK_PASSWORD"),
  "V27 PhonePe credentials and callback authentication must remain server-side Edge Function secrets."
);
expect(
  helper.includes("export function currentPhonePeEnvironment") &&
    /Deno\.env\.get\("PHONEPE_ENV"\)[\s\S]*===\s*"production"[\s\S]*\?\s*"production"[\s\S]*:\s*"sandbox"/.test(helper),
  "V27 PhonePe server integration must expose a shared environment resolver and default to sandbox unless production is explicitly selected."
);
expect(
  helper.includes("safePhonePeCheckoutSnapshot") &&
    helper.includes("safePhonePeOrderStatusSnapshot") &&
    helper.includes("paymentMode: safeString(item.paymentMode)") &&
    !helper.includes("instrument:") &&
    !helper.includes("rail:"),
  "V27 PhonePe persistence must allowlist reconciliation metadata and exclude payment instrument details."
);
expect(
  createPayment.includes('Deno.env.get("PHONEPE_PAYMENTS_ENABLED") !== "true"') &&
    createPayment.includes('.select("id,clinic_id,patient_id,total_amount,paid_amount,due_amount,status")') &&
    createPayment.includes("const dueAmount = Number(invoice.due_amount || 0)") &&
    createPayment.includes("const amountPaise = Math.round(dueAmount * 100)") &&
    !createPayment.includes("body?.amount") &&
    createPayment.includes('.eq("clinic_id", profile.clinic_id)'),
  "V27 PhonePe checkout creation must be kill-switched and derive the payable amount only from the authenticated clinic invoice."
);
expect(
  createPayment.includes("const environment = currentPhonePeEnvironment()") &&
    createPayment.includes("environment,") &&
    createPayment.includes('.eq("environment", environment)'),
  "V27 PhonePe checkout creation must stamp merchant orders with the active sandbox/production environment."
);
expect(
  createPayment.includes("last_status_payload: safePhonePeCheckoutSnapshot(checkout)") &&
    !createPayment.includes("last_status_payload: checkout"),
  "V27 PhonePe checkout creation must not persist the ephemeral checkout redirect URL."
);
expect(
  checkPayment.includes('new Set(["owner", "head_doctor", "receptionist"])') &&
    checkPayment.includes("This role cannot verify PhonePe invoice payments"),
  "V27 authenticated PhonePe rechecks must use the same authorized clinic collection roles as checkout creation."
);
expect(
  checkPayment.includes("currentPhonePeEnvironment()") &&
    checkPayment.includes("order.environment") &&
    checkPayment.indexOf("order.environment") < checkPayment.indexOf("getPhonePeOrderStatus(merchantOrderId)"),
  "V27 PhonePe rechecks must reject cross-environment merchant orders before calling PhonePe."
);
expect(
  checkPayment.includes("getPhonePeOrderStatus(merchantOrderId)") &&
    checkPayment.includes("amountMatches") &&
    checkPayment.includes('state === "COMPLETED" && !amountMatches ? "AMOUNT_MISMATCH"') &&
    checkPayment.includes('"settle_phonepe_invoice_payment_v27"') &&
    checkPayment.includes("p_status_payload: safePhonePeOrderStatusSnapshot(status)") &&
    !checkPayment.includes("p_status_payload: status"),
  "V27 PhonePe status checks must verify PhonePe server-to-server, match the amount, persist only safe metadata, and settle through the idempotent database RPC."
);
expect(
  callback.includes("currentPhonePeEnvironment()") &&
    callback.includes('.eq("environment", environment)') &&
    callback.includes("storedOrder.environment") &&
    callback.includes('reason: "environment_mismatch"') &&
    callback.indexOf("storedOrder.environment") < callback.indexOf("getPhonePeOrderStatus(merchantOrderId)"),
  "V27 PhonePe callbacks must resolve and reject cross-environment orders before querying PhonePe or settling an invoice."
);
expect(
  callback.includes("isValidPhonePeCallbackAuthorization") &&
    callback.includes("getPhonePeOrderStatus(merchantOrderId)") &&
    callback.includes("Never trust callback state/amount as payment proof") &&
    !callback.includes("callback?.payload?.state") &&
    callback.includes('"settle_phonepe_invoice_payment_v27"') &&
    callback.includes("p_status_payload: safePhonePeOrderStatusSnapshot(status)") &&
    !callback.includes("p_status_payload: status"),
  "V27 PhonePe webhook must authenticate the callback but independently re-query PhonePe and persist only safe status metadata before settlement."
);
expect(
  returnPage.includes('href="dms://reports/invoices"') &&
    returnPage.includes("does not indicate that a payment succeeded") &&
    returnPage.includes('"Cache-Control": "no-store, max-age=0"') &&
    returnPage.includes('"Referrer-Policy": "no-referrer"') &&
    !returnPage.includes("merchantOrderId") &&
    !returnPage.includes("patient"),
  "V27 PhonePe return page must contain no patient/order data and must direct users back to CapDent without claiming payment success."
);
expect(
  migration.includes("create table if not exists public.phonepe_payment_orders") &&
    migration.includes("alter table public.phonepe_payment_orders enable row level security") &&
    migration.includes("grant all on table public.phonepe_payment_orders to service_role") &&
    migration.includes("settled_payment_id is not null") &&
    migration.includes("round(coalesce(v_invoice.due_amount, 0)::numeric * 100) <> v_order.amount_paise") &&
    migration.includes("'REVIEW_REQUIRED'") &&
    migration.includes("'PhonePe'") &&
    migration.includes("grant execute on function public.settle_phonepe_invoice_payment_v27") &&
    migration.includes("to service_role"),
  "V27 PhonePe settlement must be service-role-only, idempotent, invoice-bound, and fail closed if the invoice balance changed."
);
expect(
  environmentMigration.includes("add column if not exists environment text") &&
    environmentMigration.includes("set environment = 'sandbox'") &&
    environmentMigration.includes("alter column environment set default 'sandbox'") &&
    environmentMigration.includes("alter column environment set not null") &&
    environmentMigration.includes("check (environment in ('sandbox', 'production'))"),
  "V27 PhonePe ledger must isolate sandbox and production merchant orders at the database level."
);
expect(
  client.includes("EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS") &&
    client.includes('supabase.functions.invoke("phonepe-create-payment"') &&
    client.includes('supabase.functions.invoke("phonepe-check-payment"') &&
    !client.includes("PHONEPE_CLIENT_SECRET") &&
    !client.includes("PHONEPE_CLIENT_ID") &&
    !client.includes("PHONEPE_CALLBACK_PASSWORD") &&
    !client.includes("PHONEPE_CALLBACK_USERNAME"),
  "V27 React Native PhonePe code must contain no merchant or callback credentials and may call only authenticated server functions."
);
expect(
  invoiceScreen.includes("PHONEPE_PAYMENTS_ENABLED && invoice.dueAmount > 0") &&
    invoiceScreen.includes("Pay with PhonePe") &&
    invoiceScreen.includes("Check PhonePe Status") &&
    invoiceScreen.includes("server independently verifies the PhonePe order status and amount"),
  "V27 Invoice Center must keep PhonePe collection gated and explain that settlement is server verified."
);

for (const profileName of ["development", "preview", "production", "play-internal"]) {
  expect(
    eas.build?.[profileName]?.env?.EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS === "false",
    `${profileName} must keep PhonePe client collection disabled until merchant deployment and sandbox reconciliation are approved.`
  );
}

expect(
  /^EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS=false$/m.test(envExample),
  "Example environment must default PhonePe payments off."
);
expect(
  !/^EXPO_PUBLIC_PHONEPE_CLIENT_ID=/m.test(envExample) &&
    !/^EXPO_PUBLIC_PHONEPE_CLIENT_SECRET=/m.test(envExample) &&
    !/^EXPO_PUBLIC_PHONEPE_CALLBACK_/m.test(envExample),
  "PhonePe merchant and callback credentials must never be defined as EXPO_PUBLIC variables."
);

if (failures.length > 0) {
  console.error(`CapDent V27 PhonePe validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CapDent V27 PhonePe validation passed.");
