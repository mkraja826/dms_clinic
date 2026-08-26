import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CheckoutBody = {
  bill_id?: string;
};

type PreparedRequest = {
  payment_request_id: string;
  provider: "phonepe" | "card";
  amount: number;
  currency_code: string;
  request_status: string;
  checkout_url?: string | null;
  expires_at?: string | null;
};

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

// Stripe documents UGX as a backwards-compatibility special case for charges:
// represent it using two-decimal API amounts even though it transitioned to a
// zero-decimal currency. ISK is also represented with two decimal zeroes.
const STRIPE_FORCE_TWO_DECIMAL = new Set(["ISK", "UGX"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requireHttpsEnv(name: string) {
  const value = requiredEnv(name);
  if (!/^https:\/\//i.test(value)) throw new Error(`${name} must be an HTTPS URL`);
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
      paymentLink: "https://api.phonepe.com/apis/pg/paylinks/v1/pay",
    };
  }

  return {
    oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    paymentLink: "https://api-preprod.phonepe.com/apis/pg-sandbox/paylinks/v1/pay",
  };
}

function normalizeIndianPhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new Error("Patient must have a valid Indian mobile number before a PhonePe payment link can be created");
  }
  return `+91${national}`;
}

function asPreparedRequest(data: unknown): PreparedRequest | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Record<string, unknown>;
  const id = String(candidate.payment_request_id || "").trim();
  if (!id) return null;

  return {
    payment_request_id: id,
    provider: String(candidate.provider || "") === "phonepe" ? "phonepe" : "card",
    amount: Number(candidate.amount || 0),
    currency_code: String(candidate.currency_code || "").trim().toUpperCase(),
    request_status: String(candidate.request_status || "prepared"),
    checkout_url: candidate.checkout_url ? String(candidate.checkout_url) : null,
    expires_at: candidate.expires_at ? String(candidate.expires_at) : null,
  };
}

function stripeMinorAmount(amount: number, currencyCode: string) {
  const currency = currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid card payment currency");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid card payment amount");

  if (STRIPE_ZERO_DECIMAL.has(currency) && !STRIPE_FORCE_TWO_DECIMAL.has(currency)) {
    if (Math.abs(amount - Math.round(amount)) > 0.000001) {
      throw new Error(`${currency} card payments cannot contain fractional minor units`);
    }
    return Math.round(amount);
  }

  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Card payment amount is outside the supported range");
  return minor;
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
    console.error("PhonePe OAuth failed", response.status, payload?.code || payload?.message || "unknown");
    throw new Error("PhonePe authentication failed");
  }

  return accessToken;
}

async function createPhonePePaymentLink(input: {
  requestId: string;
  amount: number;
  currencyCode: string;
  merchantId: string;
  patientPhone: string;
  invoiceNumber: string;
}) {
  if (input.currencyCode !== "INR") {
    throw new Error("PhonePe patient payment links require an INR clinic invoice");
  }

  const amountPaise = Math.round(input.amount * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Invalid PhonePe payment amount");
  }

  const merchantOrderId = `CDP_${input.requestId.replace(/-/g, "")}`;
  if (merchantOrderId.length > 63) throw new Error("PhonePe merchant order ID is too long");

  const expireAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = await phonePeAccessToken();
  const { paymentLink } = phonePeUrls();

  const response = await fetch(paymentLink, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
      "X-MERCHANT-ID": input.merchantId,
    },
    body: JSON.stringify({
      merchantOrderId,
      description: `CapDent invoice ${input.invoiceNumber}`.slice(0, 150),
      amount: amountPaise,
      paymentFlow: {
        type: "PAYLINK",
        customerDetails: {
          phoneNumber: input.patientPhone,
        },
        notificationChannels: {
          SMS: false,
          EMAIL: false,
        },
        expireAt,
      },
      metaInfo: {
        udf1: input.requestId,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const orderId = typeof payload?.orderId === "string" ? payload.orderId.trim() : "";
  const paylinkUrl = typeof payload?.paylinkUrl === "string" ? payload.paylinkUrl.trim() : "";
  const responseExpiry = Number(payload?.expireAt || expireAt);

  if (!response.ok || !orderId || !/^https:\/\//i.test(paylinkUrl)) {
    console.error(
      "PhonePe payment link creation failed",
      response.status,
      payload?.code || payload?.message || "unknown"
    );
    throw new Error("PhonePe could not create the patient payment link");
  }

  return {
    providerRequestId: orderId,
    checkoutUrl: paylinkUrl,
    expiresAt: new Date(Number.isFinite(responseExpiry) ? responseExpiry : expireAt).toISOString(),
    environment: phonePeEnvironment(),
  };
}

async function createStripeCardCheckout(input: {
  requestId: string;
  amount: number;
  currencyCode: string;
  connectedAccountId: string;
  invoiceNumber: string;
}) {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.connectedAccountId)) {
    throw new Error("Clinic card receiving account is invalid");
  }

  const currency = input.currencyCode.trim().toLowerCase();
  const unitAmount = stripeMinorAmount(input.amount, input.currencyCode);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("payment_method_types[0]", "card");
  body.set("line_items[0][price_data][currency]", currency);
  body.set("line_items[0][price_data][unit_amount]", String(unitAmount));
  body.set("line_items[0][price_data][product_data][name]", `CapDent invoice ${input.invoiceNumber}`.slice(0, 120));
  body.set("line_items[0][quantity]", "1");
  body.set("client_reference_id", input.requestId);
  body.set("metadata[capdent_payment_request_id]", input.requestId);
  body.set("payment_intent_data[metadata][capdent_payment_request_id]", input.requestId);
  body.set("success_url", requireHttpsEnv("STRIPE_PATIENT_CHECKOUT_SUCCESS_URL"));
  body.set("cancel_url", requireHttpsEnv("STRIPE_PATIENT_CHECKOUT_CANCEL_URL"));

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Account": input.connectedAccountId,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  const sessionId = typeof payload?.id === "string" ? payload.id.trim() : "";
  const checkoutUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
  const expiresAtSeconds = Number(payload?.expires_at || 0);

  if (!response.ok || !/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !/^https:\/\//i.test(checkoutUrl)) {
    console.error("Stripe Checkout creation failed", response.status, payload?.error?.type || "unknown");
    throw new Error(payload?.error?.message || "Card checkout could not be created");
  }

  return {
    providerRequestId: sessionId,
    checkoutUrl,
    expiresAt: Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? new Date(expiresAtSeconds * 1000).toISOString()
      : null,
    environment: requiredEnv("STRIPE_SECRET_KEY").startsWith("sk_live_") ? "production" : "test",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

    const body = (await req.json().catch(() => ({}))) as CheckoutBody;
    const billId = String(body.bill_id || "").trim();
    if (!billId) return json({ error: "Final invoice ID is required" }, 400);

    const { data: preparedData, error: preparedError } = await userClient.rpc(
      "prepare_v28_patient_payment_request",
      { p_bill_id: billId }
    );
    if (preparedError) return json({ error: preparedError.message }, 400);

    const prepared = asPreparedRequest(preparedData);
    if (!prepared) return json({ error: "Payment request was not returned by the server" }, 500);

    if (prepared.request_status === "pending" && /^https:\/\//i.test(prepared.checkout_url || "")) {
      return json({
        paymentRequestId: prepared.payment_request_id,
        provider: prepared.provider,
        amount: prepared.amount,
        currencyCode: prepared.currency_code,
        checkoutUrl: prepared.checkout_url,
        expiresAt: prepared.expires_at || null,
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: requestRow, error: requestError } = await adminClient
      .from("patient_payment_requests")
      .select("id,clinic_id,patient_id,consolidated_bill_id,payment_account_id,provider,amount,currency_code,status")
      .eq("id", prepared.payment_request_id)
      .single();
    if (requestError || !requestRow) throw requestError || new Error("Prepared request not found");

    const [{ data: account, error: accountError }, { data: patient, error: patientError }, { data: bill, error: billError }] =
      await Promise.all([
        adminClient
          .from("clinic_payment_accounts")
          .select("id,provider,provider_account_id,provider_merchant_id,status,payments_enabled,settlements_enabled")
          .eq("id", requestRow.payment_account_id)
          .eq("clinic_id", requestRow.clinic_id)
          .single(),
        adminClient
          .from("patients")
          .select("id,phone")
          .eq("id", requestRow.patient_id)
          .eq("clinic_id", requestRow.clinic_id)
          .single(),
        adminClient
          .from("consolidated_bills")
          .select("id,invoice_number,country_code,currency_code,status")
          .eq("id", requestRow.consolidated_bill_id)
          .eq("clinic_id", requestRow.clinic_id)
          .single(),
      ]);

    if (accountError || !account) throw accountError || new Error("Clinic payment account not found");
    if (patientError || !patient) throw patientError || new Error("Patient not found");
    if (billError || !bill) throw billError || new Error("Final invoice not found");

    if (
      account.provider !== requestRow.provider ||
      account.status !== "connected" ||
      account.payments_enabled !== true ||
      account.settlements_enabled !== true
    ) {
      return json({ error: "Clinic receiving account is not fully connected" }, 409);
    }

    await adminClient
      .from("patient_payment_requests")
      .update({ status: "provider_pending", provider_status: "creating_checkout" })
      .eq("id", requestRow.id)
      .eq("status", "prepared");

    let created: {
      providerRequestId: string;
      checkoutUrl: string;
      expiresAt: string | null;
      environment: string;
    };

    try {
      if (requestRow.provider === "phonepe") {
        if (String(bill.country_code).toUpperCase() !== "IN" || String(bill.currency_code).toUpperCase() !== "INR") {
          return json({ error: "PhonePe is enabled only for Indian INR clinics" }, 409);
        }
        if (!String(account.provider_merchant_id || "").trim()) {
          return json({ error: "Clinic PhonePe merchant ID is not configured" }, 409);
        }

        created = await createPhonePePaymentLink({
          requestId: requestRow.id,
          amount: Number(requestRow.amount || 0),
          currencyCode: String(requestRow.currency_code || "").toUpperCase(),
          merchantId: String(account.provider_merchant_id).trim(),
          patientPhone: normalizeIndianPhone(patient.phone),
          invoiceNumber: String(bill.invoice_number || requestRow.id),
        });
      } else {
        if (String(bill.country_code).toUpperCase() === "IN") {
          return json({ error: "Indian clinics must use PhonePe for V28 patient invoice payments" }, 409);
        }
        const connectedAccountId = String(account.provider_account_id || "").trim();
        if (!connectedAccountId) return json({ error: "Clinic card receiving account is not configured" }, 409);

        created = await createStripeCardCheckout({
          requestId: requestRow.id,
          amount: Number(requestRow.amount || 0),
          currencyCode: String(requestRow.currency_code || "").toUpperCase(),
          connectedAccountId,
          invoiceNumber: String(bill.invoice_number || requestRow.id),
        });
      }
    } catch (error) {
      await adminClient
        .from("patient_payment_requests")
        .update({
          status: "failed",
          provider_status: "checkout_failed",
          failure_code: requestRow.provider === "phonepe" ? "phonepe_checkout_failed" : "card_checkout_failed",
          failure_message: "Provider checkout creation failed. No CapDent payment was recorded.",
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id)
        .in("status", ["prepared", "provider_pending"]);
      throw error;
    }

    const { error: attachError } = await adminClient.rpc("attach_v28_provider_checkout", {
      p_payment_request_id: requestRow.id,
      p_provider_request_id: created.providerRequestId,
      p_checkout_url: created.checkoutUrl,
      p_expires_at: created.expiresAt,
    });
    if (attachError) throw attachError;

    return json({
      paymentRequestId: requestRow.id,
      provider: requestRow.provider,
      amount: Number(requestRow.amount || 0),
      currencyCode: String(requestRow.currency_code || "").toUpperCase(),
      checkoutUrl: created.checkoutUrl,
      expiresAt: created.expiresAt,
      environment: created.environment,
    });
  } catch (error) {
    console.error("Patient payment checkout error", error instanceof Error ? error.message : error);
    return json(
      { error: error instanceof Error ? error.message : "Patient payment checkout failed" },
      500
    );
  }
});
