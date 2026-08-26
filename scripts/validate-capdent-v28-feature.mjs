import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");

const app = readJson("app.json");
const pkg = readJson("package.json");
const eas = readJson("eas.json");
const quota = readText("src/lib/v25Limits.ts");
const pricing = readText("src/lib/pricingV25.ts");
const billing = readText("src/lib/googlePlayBilling.ts");
const restore = readText("src/lib/googlePlayRestore.ts");
const push = readText("src/lib/paymentNotifications.ts");
const patientPayments = readText("src/lib/patientPayments.ts");
const consolidatedBilling = readText("src/lib/consolidatedBilling.ts");
const finalizedInvoiceShare = readText("src/lib/finalizedInvoiceShare.ts");
const whatsapp = readText("src/lib/whatsapp.ts");
const finalizedInvoiceViewer = readText("src/app/reception/finalized-invoice.tsx");
const patientPaymentMigration = readText(
  "supabase/migrations/20260826173000_capdent_v28_clinic_payment_accounts.sql"
);
const consolidatedBillingMigration = readText(
  "supabase/migrations/20260826163000_capdent_v28_consolidated_billing_foundation.sql"
);
const invoiceShareMigration = readText(
  "supabase/migrations/20260826180000_capdent_v28_invoice_share_tokens.sql"
);

expect(app.expo?.name === "CapDent", "V28 must remain the CapDent application.");
expect(app.expo?.android?.package === "com.dms.clinic", "Android package must remain com.dms.clinic.");

const buildProperties = app.expo?.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties"
);
expect(buildProperties?.[1]?.android?.compileSdkVersion === 36, "V28 development must compile with Android API 36.");
expect(buildProperties?.[1]?.android?.targetSdkVersion === 36, "V28 development must target Android API 36.");
expect(app.expo?.android?.blockedPermissions?.includes("com.google.android.gms.permission.AD_ID"), "Advertising ID permission must remain blocked.");
expect(app.expo?.android?.blockedPermissions?.includes("android.permission.RECORD_AUDIO"), "Microphone permission must remain blocked unless separately reviewed.");

expect(pkg.dependencies?.["react-native-iap"], "Google Play Billing must remain installed.");
expect(pkg.dependencies?.["@react-native-firebase/app"], "Firebase app dependency must remain installed.");
expect(pkg.dependencies?.["@react-native-firebase/analytics"], "Firebase Analytics dependency must remain installed.");
expect(!pkg.dependencies?.openai && !pkg.dependencies?.["@anthropic-ai/sdk"] && !pkg.dependencies?.["@google/generative-ai"], "Android V28 must not add LLM SDK dependencies.");

expect(quota.includes("patientLimit: 100"), "Free patient limit must remain 100.");
expect(quota.includes("uploadLimit: 150"), "Free upload limit must remain 150.");
expect(quota.includes("uploadWarningAt: 120"), "Free upload warning must remain 120.");
expect(quota.includes("storageLimitBytes: 1024 * 1024 * 1024"), "Free storage limit must remain 1 GiB.");

expect(pricing.includes('supabase.rpc("get_capdent_entitlements_v25")'), "V28 quota UI must keep server entitlement authority.");
expect(billing.includes('supabase.functions.invoke("verify-google-play-subscription"'), "Paid access must continue through the server Google Play verifier.");
expect(restore.includes("recordGooglePlaySubscriptionPurchase"), "V28 restore must reuse server purchase verification.");
expect(restore.includes("getAvailablePurchases"), "V28 restore must query owned Google Play purchases.");
expect(push.includes("getPaymentPushHealth"), "V28 must expose payment push health diagnostics.");
expect(push.includes('record.type === "payment_received"'), "Payment notification payload safety check must remain present.");
expect(push.includes('record.route === "/reports/payments"'), "Payment notifications must retain the safe payments route.");

expect(patientPayments.includes('code === "IN" ? "phonepe" : "card"'), "Patient payment routing must use PhonePe only for explicitly Indian clinics and card for other configured countries.");
expect(patientPayments.includes('supabase.rpc("get_clinic_patient_payment_status")'), "Patient payment status must come from the server-safe RPC.");
expect(patientPaymentMigration.includes("create table if not exists public.clinic_payment_accounts"), "V28 clinic payment account migration is required.");
expect(patientPaymentMigration.includes("revoke all on table public.clinic_payment_accounts from anon, authenticated"), "Android users must not directly mutate clinic payment account metadata.");
expect(patientPaymentMigration.includes("case when v_country_code = 'IN' then 'phonepe' else 'card' end"), "Server payment routing must keep India on PhonePe and other configured countries on card.");
expect(patientPaymentMigration.includes("Never infer India from phone, IP, SIM, device locale, or a missing country"), "Server payment routing must not infer clinic country from device/user signals.");

expect(consolidatedBilling.includes('supabase.rpc("get_v28_invoice_candidates"'), "Reception final invoice candidates must come from the server-scoped RPC.");
expect(consolidatedBilling.includes('supabase.rpc("finalize_v28_consolidated_bill"'), "Reception finalization must use the server-authoritative RPC.");
expect(consolidatedBillingMigration.includes("create table if not exists public.consolidated_bills"), "V28 consolidated bill header table is required.");
expect(consolidatedBillingMigration.includes("create table if not exists public.consolidated_bill_items"), "V28 consolidated bill item snapshots are required.");
expect(consolidatedBillingMigration.includes("create table if not exists public.clinic_invoice_sequences"), "V28 server invoice sequence is required.");
expect(consolidatedBillingMigration.includes("p_source_invoice_ids uuid[]"), "Finalization must require explicit source invoice selection.");
expect(consolidatedBillingMigration.includes("pg_advisory_xact_lock"), "Consolidated finalization must serialize same-patient races.");
expect(consolidatedBillingMigration.includes("Source invoices") || consolidatedBillingMigration.includes("source invoices"), "Consolidated billing migration must document source invoice preservation.");
expect(!consolidatedBillingMigration.includes("update public.invoices"), "V28 consolidated finalization must not mutate legacy invoices.");
expect(!consolidatedBillingMigration.includes("delete from public.invoices"), "V28 consolidated finalization must not delete legacy invoices.");
expect(!consolidatedBillingMigration.includes("insert into public.payments"), "V28 consolidated finalization must not create legacy payment entries.");

expect(invoiceShareMigration.includes("create table if not exists public.consolidated_bill_share_tokens"), "V28 secure invoice share-token table is required.");
expect(invoiceShareMigration.includes("encode(digest(v_token, 'sha256'), 'hex')"), "Invoice share tokens must be stored as SHA-256 hashes, not plaintext.");
expect(invoiceShareMigration.includes("revoke all on table public.consolidated_bill_share_tokens from anon, authenticated"), "Android clients must not directly read or write share-token rows.");
expect(invoiceShareMigration.includes("status = 'finalized'"), "Share tokens may only be created for finalized invoices.");
expect(finalizedInvoiceShare.includes('supabase.rpc("create_v28_invoice_share_token"'), "Share-token creation must use the server-authoritative RPC.");
expect(finalizedInvoiceShare.includes('supabase.rpc("revoke_v28_invoice_share_tokens"'), "Share-token revocation must use the server-authoritative RPC.");
expect(whatsapp.includes("finalizedInvoiceMessage"), "V28 must provide a dedicated finalized-invoice WhatsApp message.");
expect(finalizedInvoiceViewer.includes("Send Invoice on WhatsApp"), "Finalized invoice viewer must expose a manual WhatsApp action.");
expect(finalizedInvoiceViewer.includes("Nothing is sent automatically"), "Finalized invoice viewer must clearly preserve manual patient sending.");
expect(!finalizedInvoiceViewer.includes("paymentUrl:"), "V28 must not expose a patient Pay Now URL before provider reconciliation is implemented.");

for (const requiredPath of [
  "src/app/settings/clinic-health.tsx",
  "src/app/settings/restore-subscription.tsx",
  "src/app/settings/patient-payments.tsx",
  "src/app/reception/final-invoice.tsx",
  "src/app/reception/finalized-invoices.tsx",
  "src/app/reception/finalized-invoice.tsx",
  "src/app/settings/guide.tsx",
  "src/app/settings/report-issue.tsx",
  "src/app/legal-consent.tsx",
  "src/lib/imageCompression.ts",
  "src/lib/invoiceDocument.ts",
  "src/lib/invoiceSnapshot.ts",
  "src/lib/consolidatedBilling.ts",
  "src/lib/finalizedInvoiceShare.ts",
  "src/lib/patientPayments.ts",
  "src/lib/storageUrls.ts",
  "src/lib/useImmediateMutationLock.ts",
  "supabase/migrations/20260826163000_capdent_v28_consolidated_billing_foundation.sql",
  "supabase/migrations/20260826173000_capdent_v28_clinic_payment_accounts.sql",
  "supabase/migrations/20260826180000_capdent_v28_invoice_share_tokens.sql",
  "docs/capdent-v28-feature-complete-scope.md",
  "docs/capdent-v28-implementation-status.md",
]) {
  expect(existsSync(requiredPath), `Required V28 path is missing: ${requiredPath}`);
}

for (const profileName of ["production", "play-internal"]) {
  const env = eas.build?.[profileName]?.env;
  expect(env?.EXPO_PUBLIC_USE_SIGNED_STORAGE_URLS === "true", `${profileName} must keep signed clinical storage URLs enabled.`);
  expect(env?.EXPO_PUBLIC_ENABLE_PAYMENT_PUSH === "true", `${profileName} must keep payment push enabled for release testing.`);
  expect(env?.EXPO_PUBLIC_ENABLE_TOOTH_CHART === "true", `${profileName} must keep the tooth chart enabled.`);
}

function sourceFiles(root) {
  const found = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) found.push(full);
  }
  return found;
}

const prohibitedAndroidAiImports = [
  /from\s+["']openai["']/,
  /require\(["']openai["']\)/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /from\s+["']@google\/generative-ai["']/,
];
for (const file of sourceFiles("src")) {
  const text = readText(file);
  if (prohibitedAndroidAiImports.some((pattern) => pattern.test(text))) {
    failures.push(`Android AI/LLM SDK import is prohibited in V28: ${relative(process.cwd(), file)}`);
  }
}

if (failures.length) {
  console.error(`CapDent V28 feature validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 feature validation passed.");
console.log(`Development identity remains ${app.expo?.version} / Android code ${app.expo?.android?.versionCode}; final 1.2.8 / 28 is cut only after feature completion.`);
