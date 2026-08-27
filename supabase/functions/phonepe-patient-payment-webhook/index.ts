import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

function phonePeEnvironment() {
  return Deno.env.get("PHONEPE_ENVIRONMENT")?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function phonePeUrls() {
  if (phonePeEnvironment() === "production") {
    return {
      oauth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
      pgBase: "https://api.phonepe.com/apis/pg",
    };
  }

  return {
    oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    pgBase: "https://api-preprod.phonepe.com/apis/pg-sandbox",
  };
}

async function phonePeAccessToken() {
  const clientId = requiredEnv("PHONEPE_PARTNER_CLIENT_ID");
  const clientVersion = requiredEnv("PHONEPE_PARTNER_CLIENT_VERSION");
  const clientSecret = requiredEnv("PHONEPE_PARTNER_CLIENT_SECRET");
  const { oauth } = phonePeUrls();

  const response = await fetch(oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_version: clientVersion,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    console.error("PhonePe OAuth failed during status verification", response.status);
    throw new Error("PhonePe authentication failed during payment verification");
  }

  return accessToken;
}

async function getPhonePeOrderStatus(input: { merchantOrderId: string; merchantId: string }) {
  const token = await phonePeAccessToken();
  const { pgBase } = phonePeUrls();
  const statusUrl = `${pgBase}/checkout/v2/order/${encodeURIComponent(input.merchantOrderId)}/status`;
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
      "X-MERCHANT-ID": input.merchantId,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload || typeof payload !== "object") {
    console.error("PhonePe order-status verification failed", response.status);
    throw new Error("PhonePe order status could not be verified");
  }

  return payload as any;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function normalizeShaAuthorization(value: string | null) {
  return String(value || "").trim().replace(/^sha256\s+/i, "").toLowerCase();
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function firstTransactionId(payload: any) {
  const details = Array.isArray(payload?.paymentDetails) ? payload.paymentDetails : [];
  const value = details.find((item: any) => typeof item?.transactionId === "string")?.transactionId;
  return typeof value === "string" ? value.trim() : "";
}

const TERMINAL_ORDER_EVENTS = new Set([
  "CHECKOUT_ORDER_COMPLETED",
  "CHECKOUT_ORDER_FAILED",
  "PG_ORDER_COMPLETED",
  "PG_ORDER_FAILED",
]);

const WEBHOOK_VERIFIABLE_REQUEST_STATES = new Set([
  "pending",
  "provider_verified",
  "reconciled",
  "reconciliation_required",
  "partially_reconciled_excess",
  "failed",
  "expired",
  "cancelled",
  "superseded",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const username = requiredEnv("PHONEPE_WEBHOOK_USERNAME");
    const password = requiredEnv("PHONEPE_WEBHOOK_PASSWORD");
    const expectedAuth = await sha256(`${username}:${password}`);
    const receivedAuth = normalizeShaAuthorization(req.headers.get("Authorization"));

    if (!/^[a-f0-9]{64}$/.test(receivedAuth) || !constantTimeEqual(receivedAuth, expectedAuth)) {
      return json({ error: "Invalid PhonePe webhook authorization" }, 401);
    }

    const rawBody = await req.text();
    const callbackDigest = await sha256(rawBody);
    const body = JSON.parse(rawBody || "{}") as any;
    const event = String(body?.type || "").trim().toUpperCase();

    if (!TERMINAL_ORDER_EVENTS.has(event)) {
      return json({ received: true, ignored: true });
    }

    const callbackPayload = body?.payload || {};
    const callbackOrderId = String(callbackPayload?.orderId || "").trim();
    const merchantOrderId = String(callbackPayload?.merchantOrderId || "").trim();
    const callbackMerchantId = String(callbackPayload?.merchantId || "").trim();
    const callbackAmountPaise = Number(callbackPayload?.amount);

    if (!merchantOrderId) return json({ error: "PhonePe callback is missing merchant order ID" }, 400);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: requestRow, error: requestError } = await adminClient
      .from("patient_payment_requests")
      .select("id,clinic_id,payment_account_id,provider,provider_request_id,status,amount,currency_code")
      .eq("provider", "phonepe")
      .eq("provider_request_id", merchantOrderId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!requestRow) return json({ error: "PhonePe order is not linked to a CapDent payment request" }, 404);
    if (!requestRow.payment_account_id) return json({ error: "CapDent payment request has no locked receiving account" }, 409);
    if (!WEBHOOK_VERIFIABLE_REQUEST_STATES.has(String(requestRow.status))) {
      return json({ error: "CapDent payment request is not in a webhook-verifiable state" }, 409);
    }
    if (String(requestRow.currency_code || "").trim().toUpperCase() !== "INR") {
      return json({ error: "PhonePe payment request currency is invalid" }, 409);
    }

    const { data: account, error: accountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("id,provider,provider_merchant_id,status,verification_status,payments_enabled,settlements_enabled")
      .eq("id", requestRow.payment_account_id)
      .eq("clinic_id", requestRow.clinic_id)
      .eq("provider", "phonepe")
      .single();
    if (accountError || !account) throw accountError || new Error("Clinic PhonePe account not found");

    // New checkout creation requires a currently verified/enabled account. A webhook is
    // different: it verifies money for an order that was already created and locked to
    // this account. Disabling the account later must not make real received money vanish.
    if (account.id !== requestRow.payment_account_id || account.provider !== "phonepe") {
      return json({ error: "Locked clinic PhonePe account does not match the payment request" }, 409);
    }

    const clinicMerchantId = String(account.provider_merchant_id || "").trim();
    if (!clinicMerchantId) return json({ error: "Clinic PhonePe merchant is not configured" }, 409);
    if (callbackMerchantId && callbackMerchantId !== clinicMerchantId) {
      return json({ error: "PhonePe callback merchant does not match the locked clinic receiving account" }, 409);
    }

    const statusPayload = await getPhonePeOrderStatus({ merchantOrderId, merchantId: clinicMerchantId });

    const verifiedMerchantOrderId = String(statusPayload?.merchantOrderId || "").trim();
    const verifiedOrderId = String(statusPayload?.orderId || "").trim();
    const verifiedMerchantId = String(statusPayload?.merchantId || "").trim();
    const verifiedState = String(statusPayload?.state || "").trim().toUpperCase();
    const verifiedAmountPaise = Number(statusPayload?.amount);
    const expectedAmountPaise = Math.round(Number(requestRow.amount || 0) * 100);

    if (verifiedMerchantOrderId && verifiedMerchantOrderId !== merchantOrderId) {
      return json({ error: "PhonePe order-status merchant order does not match" }, 409);
    }
    if (callbackOrderId && verifiedOrderId && callbackOrderId !== verifiedOrderId) {
      return json({ error: "PhonePe callback order does not match verified order status" }, 409);
    }
    if (!verifiedMerchantId || verifiedMerchantId !== clinicMerchantId) {
      return json({ error: "PhonePe verified merchant does not match the locked clinic receiving account" }, 409);
    }
    if (!Number.isSafeInteger(expectedAmountPaise) || expectedAmountPaise <= 0) {
      return json({ error: "CapDent payment request amount is invalid" }, 409);
    }
    if (!Number.isSafeInteger(verifiedAmountPaise) || verifiedAmountPaise !== expectedAmountPaise) {
      return json({ error: "PhonePe verified amount does not match the CapDent payment request" }, 409);
    }
    if (Number.isSafeInteger(callbackAmountPaise) && callbackAmountPaise > 0 && callbackAmountPaise !== verifiedAmountPaise) {
      return json({ error: "PhonePe callback amount does not match verified order status" }, 409);
    }

    if (verifiedState === "PENDING") return json({ error: "PhonePe order status is not terminal yet" }, 503);

    const success = verifiedState === "COMPLETED";
    const failed = verifiedState === "FAILED" || verifiedState === "EXPIRED";
    if (!success && !failed) return json({ error: "PhonePe order status is not a supported terminal state" }, 503);

    const transactionId = firstTransactionId(statusPayload);
    const verificationEvidence = JSON.stringify({
      paymentAccountId: account.id,
      merchantOrderId,
      orderId: verifiedOrderId,
      merchantId: verifiedMerchantId,
      state: verifiedState,
      amount: verifiedAmountPaise,
      transactionId,
    });
    const verificationDigest = await sha256(`${callbackDigest}|${verificationEvidence}`);
    const eventFingerprint = [
      account.id,
      event,
      merchantOrderId,
      verifiedOrderId,
      verifiedMerchantId,
      transactionId,
      verifiedState,
      verifiedAmountPaise,
    ].join("|");
    const providerEventId = await sha256(eventFingerprint);

    const { data: inserted, error: eventError } = await adminClient.rpc("record_v28_verified_provider_event", {
      p_payment_request_id: requestRow.id,
      p_provider_event_id: providerEventId,
      p_provider_request_id: merchantOrderId,
      p_event_type: `${event}:${verifiedState}`,
      p_amount: verifiedAmountPaise / 100,
      p_currency_code: "INR",
      p_payload_digest: verificationDigest,
      p_success: success,
    });
    if (eventError) throw eventError;

    let reconciliation: unknown = null;
    if (success) {
      const { data: refreshedRequest, error: refreshError } = await adminClient
        .from("patient_payment_requests")
        .select("status")
        .eq("id", requestRow.id)
        .single();
      if (refreshError || !refreshedRequest) throw refreshError || new Error("Payment request status could not be refreshed");

      const refreshedStatus = String(refreshedRequest.status || "");
      if (refreshedStatus === "provider_verified" || refreshedStatus === "reconciliation_required") {
        const { data, error } = await adminClient.rpc("reconcile_v28_verified_patient_payment", {
          p_payment_request_id: requestRow.id,
        });
        if (error) throw error;
        reconciliation = data;
      }
    }

    return json({
      received: true,
      duplicate: inserted === false,
      state: success ? "completed" : verifiedState === "EXPIRED" ? "expired" : "failed",
      reconciliation,
    });
  } catch (error) {
    console.error("PhonePe patient payment webhook error", error instanceof Error ? error.message : error);
    return json({ error: "PhonePe webhook processing failed" }, 500);
  }
});
