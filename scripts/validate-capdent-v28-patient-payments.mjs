import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const read = (path) => readFileSync(path, "utf8");

const requestMigrationPath =
  "supabase/migrations/20260826183000_capdent_v28_patient_payment_requests.sql";
const rowCountFixPath =
  "supabase/migrations/20260826183100_capdent_v28_fix_provider_event_rowcount.sql";
const reconciliationPath =
  "supabase/migrations/20260826183200_capdent_v28_verified_payment_reconciliation.sql";
const helperPath = "src/lib/patientPaymentRequests.ts";
const viewerPath = "src/app/reception/finalized-invoice.tsx";

for (const path of [
  requestMigrationPath,
  rowCountFixPath,
  reconciliationPath,
  helperPath,
  viewerPath,
]) {
  expect(existsSync(path), `Required V28 patient-payment path is missing: ${path}`);
}

if (!failures.length) {
  const migration = read(requestMigrationPath);
  const fix = read(rowCountFixPath);
  const reconciliation = read(reconciliationPath);
  const helper = read(helperPath);
  const viewer = read(viewerPath);

  expect(
    migration.includes("create table if not exists public.patient_payment_requests"),
    "Patient payment request table is required."
  );
  expect(
    migration.includes("create table if not exists public.patient_payment_provider_events"),
    "Provider event idempotency table is required."
  );
  expect(
    migration.includes("case when v_country = 'IN' then 'phonepe' else 'card' end"),
    "Server provider routing must keep explicit India on PhonePe and other configured countries on card."
  );
  expect(
    migration.includes("sum(greatest(coalesce(i.due_amount, 0), 0))"),
    "Payment requests must use the current legacy invoice due balance."
  );
  expect(
    migration.includes("a.status = 'connected'") &&
      migration.includes("a.payments_enabled = true") &&
      migration.includes("a.settlements_enabled = true"),
    "Payment requests must require a connected, payment-enabled, settlement-enabled clinic receiving account."
  );
  expect(
    migration.includes("patient_payment_requests_one_live_bill_idx"),
    "Only one live online payment request may exist per finalized bill."
  );
  expect(
    migration.includes("grant execute on function public.attach_v28_provider_checkout") &&
      migration.includes("to service_role"),
    "Only trusted service-role code may attach hosted provider checkout URLs."
  );
  expect(
    migration.includes("lower(trim(p_checkout_url)) !~ '^https://'"),
    "Provider checkout URLs must require HTTPS."
  );
  expect(
    migration.includes("Raw webhook payloads, credentials, secrets, patient notes, and other PHI must not be stored here"),
    "Provider event storage must explicitly prohibit raw webhook payloads/secrets/PHI."
  );
  expect(
    migration.includes("status = 'provider_verified'") &&
      migration.includes("does not") &&
      migration.includes("legacy CapDent payments ledger"),
    "Provider success must stop at provider_verified until trusted ledger reconciliation runs."
  );
  expect(
    !migration.includes("insert into public.payments") &&
      !migration.includes("update public.payments") &&
      !migration.includes("delete from public.payments"),
    "The payment-request/provider-event foundation must not mutate the existing payments table."
  );
  expect(
    !migration.includes("update public.invoices") && !migration.includes("delete from public.invoices"),
    "The payment-request/provider-event foundation must not mutate legacy invoices."
  );
  expect(
    fix.includes("v_row_count integer") && fix.includes("v_inserted := v_row_count > 0"),
    "Provider event duplicate handling must convert ROW_COUNT safely before returning a boolean."
  );

  expect(
    reconciliation.includes("create table if not exists public.patient_payment_reconciliation_entries"),
    "Verified online payments must keep an audit mapping to the CapDent payment rows they create."
  );
  expect(
    reconciliation.includes("status <> 'provider_verified'") &&
      reconciliation.includes("provider_verified_at is null"),
    "Ledger reconciliation must require a provider-verified request."
  );
  expect(
    reconciliation.includes("round(v_current_due, 2) <> round(v_request.amount, 2)") &&
      reconciliation.includes("status = 'reconciliation_required'"),
    "A balance change after checkout must stop automatic reconciliation instead of over-crediting invoices."
  );
  expect(
    reconciliation.includes("insert into public.payments") &&
      reconciliation.includes("v_request.requested_by"),
    "Trusted reconciliation must write through the existing CapDent payment ledger and retain the receptionist/owner who prepared the request."
  );
  expect(
    reconciliation.includes("perform public.recalculate_invoice_financials(v_invoice.id)"),
    "Verified payment allocation must reuse the existing production invoice financial recalculation logic."
  );
  expect(
    reconciliation.includes("coalesce(nullif(trim(v_invoice.payment_category), ''), 'pending_collection')"),
    "Verified payment rows must preserve each legacy invoice payment category."
  );
  expect(
    reconciliation.includes("grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to service_role"),
    "Only trusted service-role code may reconcile a provider payment into the CapDent ledger."
  );
  expect(
    !reconciliation.includes("grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to authenticated"),
    "Android/authenticated clients must never execute provider ledger reconciliation."
  );

  expect(
    helper.includes('supabase.rpc("prepare_v28_patient_payment_request"'),
    "Android payment preparation must use the server-authoritative RPC."
  );
  expect(
    helper.includes("request.status !== \"pending\"") && helper.includes("/^https:\\/\\//i"),
    "Client shareability must require a pending HTTPS hosted checkout URL."
  );
  expect(
    viewer.includes("Pay Now is intentionally disabled") &&
      viewer.includes("No Pay Now URL is included"),
    "Final invoice UI must keep Pay Now disabled until trusted provider adapters are complete."
  );
}

if (failures.length) {
  console.error(`CapDent V28 patient-payment validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 patient-payment security validation passed.");
