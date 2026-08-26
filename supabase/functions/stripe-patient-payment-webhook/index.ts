import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const STRIPE_ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function verifyStripeSignature(rawBody: string, header: string | null) {
  const secret = requiredEnv("STRIPE_PATIENT_WEBHOOK_SECRET");
  const parts = String(header || "").split(",").map((value) => value.trim());
  const timestamp = Number(parts.find((part) => part.startsWith("t="))?.slice(2));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).toLowerCase())
    .filter((value) => /^[a-f0-9]{64}$/.test(value));

  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((candidate) => constantTimeEqual(candidate, expected));
}

function majorAmount(amountMinor: number, currencyCode: string) {
  const currency = currencyCode.trim().toUpperCase();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Stripe payment amount is invalid");
  // ISK and UGX are intentionally treated as two-decimal API charge amounts
  // for Stripe backwards compatibility, so they are not included in this set.
  return STRIPE_ZERO_DECIMAL.has(currency) ? amountMinor : amountMinor / 100;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const rawBody = await req.text();
    if (!(await verifyStripeSignature(rawBody, req.headers.get("Stripe-Signature")))) {
      return json({ error: "Invalid Stripe webhook signature" }, 401);
    }

    const event = JSON.parse(rawBody || "{}") as any;
    if (String(event?.type || "") !== "checkout.session.completed") {
      return json({ received: true, ignored: true });
    }

    const session = event?.data?.object || {};
    if (String(session?.object || "") !== "checkout.session") {
      return json({ error: "Stripe event does not contain a Checkout Session" }, 400);
    }
    if (String(session?.payment_status || "") !== "paid") {
      return json({ received: true, ignored: true, reason: "checkout_not_paid" });
    }

    const paymentRequestId = String(session?.metadata?.capdent_payment_request_id || "").trim();
    const sessionId = String(session?.id || "").trim();
    const connectedAccountId = String(event?.account || "").trim();
    const currency = String(session?.currency || "").trim().toUpperCase();
    const amountTotal = Number(session?.amount_total);
    const eventId = String(event?.id || "").trim();

    if (!paymentRequestId || !sessionId || !connectedAccountId || !eventId) {
      return json({ error: "Stripe Connect event is missing CapDent identifiers" }, 400);
    }
    if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "Stripe currency is invalid" }, 400);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: requestRow, error: requestError } = await adminClient
      .from("patient_payment_requests")
      .select("id,clinic_id,payment_account_id,provider,provider_request_id,status")
      .eq("id", paymentRequestId)
      .eq("provider", "card")
      .maybeSingle();
    if (requestError) throw requestError;
    if (!requestRow) return json({ error: "Stripe session is not linked to a CapDent payment request" }, 404);

    const { data: account, error: accountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("provider_account_id")
      .eq("id", requestRow.payment_account_id)
      .eq("clinic_id", requestRow.clinic_id)
      .eq("provider", "card")
      .single();
    if (accountError || !account) throw accountError || new Error("Clinic card receiving account not found");
    if (String(account.provider_account_id || "").trim() !== connectedAccountId) {
      return json({ error: "Stripe connected account does not match the clinic receiving account" }, 409);
    }

    const providerAmount = majorAmount(amountTotal, currency);
    const payloadDigest = await sha256(rawBody);
    const { data: inserted, error: eventError } = await adminClient.rpc(
      "record_v28_verified_provider_event",
      {
        p_payment_request_id: requestRow.id,
        p_provider_event_id: eventId,
        p_provider_request_id: sessionId,
        p_event_type: "checkout.session.completed",
        p_amount: providerAmount,
        p_currency_code: currency,
        p_payload_digest: payloadDigest,
        p_success: true,
      }
    );
    if (eventError) throw eventError;

    const { data: reconciliation, error: reconciliationError } = await adminClient.rpc(
      "reconcile_v28_verified_patient_payment",
      { p_payment_request_id: requestRow.id }
    );
    if (reconciliationError) throw reconciliationError;

    return json({
      received: true,
      duplicate: inserted === false,
      state: "completed",
      reconciliation,
    });
  } catch (error) {
    console.error("Stripe patient payment webhook error", error instanceof Error ? error.message : error);
    return json({ error: "Stripe webhook processing failed" }, 500);
  }
});
