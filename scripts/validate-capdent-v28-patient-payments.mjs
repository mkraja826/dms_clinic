import { existsSync, readFileSync } from "node:fs";

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const read = (path) => readFileSync(path, "utf8");

const paths = {
  requestMigration: "supabase/migrations/20260826183000_capdent_v28_patient_payment_requests.sql",
  rowCountFix: "supabase/migrations/20260826183100_capdent_v28_fix_provider_event_rowcount.sql",
  reconciliation: "supabase/migrations/20260826183200_capdent_v28_verified_payment_reconciliation.sql",
  checkout: "supabase/functions/create-patient-payment-checkout/index.ts",
  phonePeWebhook: "supabase/functions/phonepe-patient-payment-webhook/index.ts",
  cardOnboarding: "supabase/functions/connect-card-payment-account/index.ts",
  cardStatus: "supabase/functions/sync-card-payment-account/index.ts",
  stripeWebhook: "supabase/functions/stripe-patient-payment-webhook/index.ts",
  config: "supabase/config.toml",
  helper: "src/lib/patientPaymentRequests.ts",
  cardClient: "src/lib/cardPaymentAccount.ts",
  ownerScreen: "src/app/settings/patient-payments.tsx",
  viewer: "src/app/reception/finalized-invoice.tsx",
};

for (const path of Object.values(paths)) {
  expect(existsSync(path), `Required V28 patient-payment path is missing: ${path}`);
}

if (!failures.length) {
  const migration = read(paths.requestMigration);
  const fix = read(paths.rowCountFix);
  const reconciliation = read(paths.reconciliation);
  const checkout = read(paths.checkout);
  const phonePeWebhook = read(paths.phonePeWebhook);
  const cardOnboarding = read(paths.cardOnboarding);
  const cardStatus = read(paths.cardStatus);
  const stripeWebhook = read(paths.stripeWebhook);
  const config = read(paths.config);
  const helper = read(paths.helper);
  const cardClient = read(paths.cardClient);
  const ownerScreen = read(paths.ownerScreen);
  const viewer = read(paths.viewer);

  expect(
    migration.includes("create table if not exists public.patient_payment_requests") &&
      migration.includes("create table if not exists public.patient_payment_provider_events"),
    "Patient payment request and provider event tables are required."
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
    !migration.includes("insert into public.payments") &&
      !migration.includes("update public.payments") &&
      !migration.includes("delete from public.payments"),
    "The request/provider-event foundation must not directly mutate the existing payments table."
  );
  expect(
    fix.includes("v_row_count integer") && fix.includes("v_inserted := v_row_count > 0"),
    "Provider event duplicate handling must convert ROW_COUNT safely before returning a boolean."
  );

  expect(
    reconciliation.includes("create table if not exists public.patient_payment_reconciliation_entries"),
    "Verified online payments must keep an audit mapping to CapDent payment rows."
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
    "Trusted reconciliation must write through the existing CapDent payment ledger and retain the staff member who prepared the request."
  );
  expect(
    reconciliation.includes("perform public.recalculate_invoice_financials(v_invoice.id)"),
    "Verified payment allocation must reuse the production invoice financial recalculation logic."
  );
  expect(
    reconciliation.includes("coalesce(nullif(trim(v_invoice.payment_category), ''), 'pending_collection')"),
    "Verified payment rows must preserve the source invoice payment category."
  );
  expect(
    reconciliation.includes("grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to service_role") &&
      !reconciliation.includes("grant execute on function public.reconcile_v28_verified_patient_payment(uuid) to authenticated"),
    "Only trusted service-role code may reconcile provider payments into the ledger."
  );

  expect(
    checkout.includes("PHONEPE_PARTNER_CLIENT_ID") &&
      checkout.includes("PHONEPE_PARTNER_CLIENT_SECRET") &&
      checkout.includes("PHONEPE_PARTNER_CLIENT_VERSION"),
    "PhonePe partner credentials must come from Edge Function environment secrets."
  );
  expect(
    checkout.includes('"X-MERCHANT-ID": input.merchantId'),
    "PhonePe partner checkout must identify the end clinic merchant."
  );
  expect(
    checkout.includes("amountPaise = Math.round(input.amount * 100)"),
    "PhonePe checkout amount must be converted from INR to paise server-side."
  );
  expect(
    checkout.includes('checkout: "https://api.phonepe.com/apis/pg/checkout/v2/pay"') &&
      checkout.includes('checkout: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay"') &&
      checkout.includes('type: "PG_CHECKOUT"'),
    "PhonePe patient collection must use the current Standard Checkout v2 API in both sandbox and production."
  );
  expect(
    !checkout.includes("/paylinks/v1/pay") && !checkout.includes('type: "PAYLINK"'),
    "V28 must not mix the PhonePe Paylinks product with Standard Checkout verification."
  );
  expect(
    checkout.includes('requireHttpsEnv("PHONEPE_PATIENT_PAYMENT_REDIRECT_URL")') &&
      checkout.includes("merchantUrls") && checkout.includes("redirectUrl"),
    "PhonePe Standard Checkout must use a server-configured HTTPS redirect URL."
  );
  expect(
    checkout.includes("providerRequestId: merchantOrderId"),
    "CapDent must persist the merchant order ID because PhonePe order status is queried by that identifier."
  );
  expect(
    !checkout.includes("patientPhone") && !checkout.includes("notificationChannels"),
    "PhonePe hosted checkout must not receive patient contact data or auto-message instructions from CapDent."
  );
  expect(
    checkout.includes('Deno.env.get("PHONEPE_ENVIRONMENT")') &&
      checkout.includes('? "production"') &&
      checkout.includes(': "sandbox"'),
    "PhonePe provider integration must default safely to sandbox."
  );
  expect(
    !checkout.includes("EXPO_PUBLIC_PHONEPE") && !checkout.includes("EXPO_PUBLIC_STRIPE"),
    "Provider credentials must never be embedded in Android/public configuration."
  );

  expect(
    checkout.includes("STRIPE_SECRET_KEY") && checkout.includes('"Stripe-Account": input.connectedAccountId'),
    "International card checkout must run server-side as a Stripe direct charge on the clinic connected account."
  );
  expect(
    checkout.includes('body.set("payment_method_types[0]", "card")'),
    "Non-India V28 checkout must expose card only."
  );
  expect(
    checkout.includes("stripeMinorAmount") && checkout.includes('"JPY"') && checkout.includes('"UGX"'),
    "Stripe amounts must account for documented minor-unit/zero-decimal currency rules."
  );
  expect(
    checkout.includes("STRIPE_PATIENT_CHECKOUT_SUCCESS_URL") && checkout.includes("STRIPE_PATIENT_CHECKOUT_CANCEL_URL"),
    "Stripe hosted Checkout must use server-configured HTTPS return URLs."
  );
  expect(
    checkout.includes('String(bill.country_code).toUpperCase() === "IN"') &&
      checkout.includes("Indian clinics must use PhonePe"),
    "International card adapter must refuse Indian clinic invoices."
  );

  expect(
    phonePeWebhook.includes("PHONEPE_WEBHOOK_USERNAME") && phonePeWebhook.includes("PHONEPE_WEBHOOK_PASSWORD"),
    "PhonePe webhook SHA credentials must come only from server-side secrets."
  );
  expect(
    phonePeWebhook.includes('sha256(`${username}:${password}`)') && phonePeWebhook.includes("constantTimeEqual"),
    "PhonePe SHA webhook authorization must be verified before provider processing."
  );
  expect(
    phonePeWebhook.includes('"CHECKOUT_ORDER_COMPLETED"') &&
      phonePeWebhook.includes('"CHECKOUT_ORDER_FAILED"') &&
      !phonePeWebhook.includes("paylink.order.completed"),
    "PhonePe webhook handling must use Standard Checkout order callback types rather than Paylink events."
  );
  expect(
    phonePeWebhook.includes("PHONEPE_PARTNER_CLIENT_ID") &&
      phonePeWebhook.includes("PHONEPE_PARTNER_CLIENT_SECRET") &&
      phonePeWebhook.includes("PHONEPE_PARTNER_CLIENT_VERSION") &&
      phonePeWebhook.includes("getPhonePeOrderStatus"),
    "PhonePe webhook processing must independently authenticate to PhonePe and fetch authoritative order status."
  );
  expect(
    phonePeWebhook.includes("/checkout/v2/order/${encodeURIComponent(input.merchantOrderId)}/status") &&
      phonePeWebhook.includes('Authorization: `O-Bearer ${token}`') &&
      phonePeWebhook.includes('"X-MERCHANT-ID": input.merchantId'),
    "PhonePe status verification must use the authenticated Standard Checkout order-status endpoint for the clinic merchant."
  );
  expect(
    phonePeWebhook.includes('.eq("provider_request_id", merchantOrderId)') &&
      phonePeWebhook.includes('verifiedState === "COMPLETED"') &&
      phonePeWebhook.includes("verifiedAmountPaise !== expectedAmountPaise") &&
      phonePeWebhook.includes("verifiedMerchantId !== clinicMerchantId"),
    "PhonePe verification must bind merchant order, terminal state, exact amount, and clinic merchant before recording success."
  );
  const statusCheckIndex = phonePeWebhook.indexOf("getPhonePeOrderStatus({");
  const reconcileIndex = phonePeWebhook.indexOf('adminClient.rpc("reconcile_v28_verified_patient_payment"');
  expect(
    statusCheckIndex >= 0 && reconcileIndex > statusCheckIndex,
    "PhonePe order-status verification must occur before any CapDent ledger reconciliation call."
  );
  expect(
    phonePeWebhook.includes('p_provider_request_id: merchantOrderId') &&
      phonePeWebhook.includes("record_v28_verified_provider_event") &&
      phonePeWebhook.includes("verificationDigest"),
    "Only independently verified PhonePe evidence may enter the provider-event gate."
  );
  expect(
    phonePeWebhook.includes("callbackDigest = await sha256(rawBody)") &&
      !phonePeWebhook.includes("raw_payload"),
    "PhonePe webhook must retain only cryptographic evidence, never the raw provider payload."
  );

  expect(
    cardOnboarding.includes("STRIPE_SECRET_KEY") &&
      cardOnboarding.includes('accountBody.set("type", "express")') &&
      cardOnboarding.includes('capabilities[card_payments][requested]') &&
      cardOnboarding.includes('capabilities[transfers][requested]'),
    "Card receiving-account onboarding must create a Stripe connected account with payment/settlement capabilities server-side."
  );
  expect(
    cardOnboarding.includes("/v1/account_links") &&
      cardOnboarding.includes("STRIPE_CONNECT_REFRESH_URL") &&
      cardOnboarding.includes("STRIPE_CONNECT_RETURN_URL") &&
      cardOnboarding.includes('linkBody.set("type", "account_onboarding")'),
    "Card onboarding must use a one-time Stripe-hosted Account Link."
  );
  expect(
    cardOnboarding.includes('countryCode === "IN"') && cardOnboarding.includes("Indian clinics use PhonePe"),
    "Stripe connected-account onboarding must be unavailable to Indian clinics in V28."
  );
  expect(
    cardStatus.includes("charges_enabled") && cardStatus.includes("payouts_enabled") &&
      cardStatus.includes('status = "connected"'),
    "Card receiving-account readiness must be synchronized from Stripe charge and payout capability state."
  );

  expect(
    stripeWebhook.includes("Stripe-Signature") && stripeWebhook.includes("STRIPE_PATIENT_WEBHOOK_SECRET") &&
      stripeWebhook.includes("hmacSha256Hex") && stripeWebhook.includes("> 300"),
    "Stripe webhook must verify a timestamped HMAC signature with replay tolerance."
  );
  expect(
    stripeWebhook.includes('checkout.session.completed') &&
      stripeWebhook.includes("event?.account") &&
      stripeWebhook.includes("capdent_payment_request_id"),
    "Stripe Connect webhook must require a paid connected-account Checkout Session mapped to a CapDent request."
  );
  expect(
    stripeWebhook.includes("record_v28_verified_provider_event") &&
      stripeWebhook.includes("reconcile_v28_verified_patient_payment") &&
      stripeWebhook.includes("payloadDigest = await sha256(rawBody)"),
    "Stripe completion must be verified, digest-only logged, and reconciled through the trusted ledger path."
  );

  for (const section of [
    "[functions.connect-card-payment-account]",
    "[functions.sync-card-payment-account]",
    "[functions.create-patient-payment-checkout]",
    "[functions.phonepe-patient-payment-webhook]",
    "[functions.stripe-patient-payment-webhook]",
  ]) {
    expect(config.includes(section), `Supabase config is missing ${section}`);
  }

  expect(
    helper.includes('supabase.rpc("prepare_v28_patient_payment_request"') &&
      helper.includes("request.status !== \"pending\"") &&
      helper.includes("/^https:\\/\\//i"),
    "Android payment request handling must remain server-authoritative and share only pending HTTPS checkout URLs."
  );
  expect(
    cardClient.includes('supabase.functions.invoke("connect-card-payment-account"') &&
      cardClient.includes('supabase.functions.invoke("sync-card-payment-account"'),
    "Owner card setup must use authenticated backend onboarding/status functions."
  );
  expect(
    ownerScreen.includes("Linking.openURL(result.onboardingUrl)") &&
      ownerScreen.includes("PhonePe patient-payment processing is implemented as a PG Partner flow") &&
      ownerScreen.includes("disabled"),
    "Owner UI must open Stripe onboarding in the system browser while keeping PhonePe merchant onboarding gated."
  );
  expect(
    viewer.includes("Pay Now is intentionally disabled") && viewer.includes("No Pay Now URL is included"),
    "Reception invoice UI must keep Pay Now disabled until provider release gates are explicitly opened."
  );
}

if (failures.length) {
  console.error(`CapDent V28 patient-payment validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 patient-payment security validation passed.");
