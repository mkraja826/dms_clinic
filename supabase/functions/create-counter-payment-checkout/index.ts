import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function phonePeEnvironment() {
  return Deno.env.get("PHONEPE_ENVIRONMENT")?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function phonePeUrls() {
  if (phonePeEnvironment() === "production") {
    return {
      oauth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
      checkout: "https://api.phonepe.com/apis/pg/checkout/v2/pay",
    };
  }
  return {
    oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    checkout: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
  };
}

async function phonePeAccessToken() {
  const { oauth } = phonePeUrls();
  const response = await fetch(oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("PHONEPE_PARTNER_CLIENT_ID"),
      client_version: requiredEnv("PHONEPE_PARTNER_CLIENT_VERSION"),
      client_secret: requiredEnv("PHONEPE_PARTNER_CLIENT_SECRET"),
      grant_type: "client_credentials",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const token = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !token) throw new Error("PhonePe authentication failed");
  return token;
}

async function createPhonePeCheckout(input: {
  requestId: string;
  amount: number;
  currencyCode: string;
  merchantId: string;
  category: string;
}) {
  if (input.currencyCode !== "INR") throw new Error("PhonePe counter QR requires INR");
  const amountPaise = Math.round(input.amount * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error("Invalid PhonePe amount");

  const merchantOrderId = `CDP_${input.requestId.replace(/-/g, "")}`;
  const redirectUrl = requiredEnv("PHONEPE_PATIENT_PAYMENT_REDIRECT_URL");
  if (!/^https:\/\//i.test(redirectUrl)) throw new Error("PhonePe redirect URL must be HTTPS");
  const token = await phonePeAccessToken();
  const { checkout } = phonePeUrls();
  const expireAfterSeconds = 20 * 60;
  const fallbackExpireAt = Date.now() + expireAfterSeconds * 1000;

  const labels: Record<string, string> = {
    op_fee: "OP / Consultation",
    xray_fee: "X-ray",
    medication_fee: "Medication",
    treatment_fee: "Treatment",
    pending_collection: "Pending Collection",
    other: "Other",
  };

  const response = await fetch(checkout, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
      "X-MERCHANT-ID": input.merchantId,
    },
    body: JSON.stringify({
      merchantOrderId,
      amount: amountPaise,
      expireAfter: expireAfterSeconds,
      metaInfo: { udf1: input.requestId },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `CapDent ${labels[input.category] || "counter"} payment`.slice(0, 150),
        merchantUrls: { redirectUrl },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const checkoutUrl = typeof payload?.redirectUrl === "string" ? payload.redirectUrl.trim() : "";
  const orderId = typeof payload?.orderId === "string" ? payload.orderId.trim() : "";
  const expireAt = Number(payload?.expireAt || fallbackExpireAt);
  if (!response.ok || !orderId || !/^https:\/\//i.test(checkoutUrl)) {
    throw new Error("PhonePe could not create the counter checkout");
  }

  return {
    providerRequestId: merchantOrderId,
    checkoutUrl,
    expiresAt: new Date(Number.isFinite(expireAt) ? expireAt : fallbackExpireAt).toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

    const body = await req.json().catch(() => ({}));
    const paymentRequestId = String(body?.payment_request_id || "").trim();
    if (!paymentRequestId) return json({ error: "Payment request ID is required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [{ data: profile }, { data: requestRow, error: requestError }] = await Promise.all([
      adminClient.from("profiles").select("clinic_id,role,active").eq("id", userData.user.id).single(),
      adminClient
        .from("patient_payment_requests")
        .select("id,clinic_id,payment_account_id,provider,country_code,currency_code,amount,status,request_mode,payment_category,checkout_url,expires_at")
        .eq("id", paymentRequestId)
        .single(),
    ]);

    if (!profile || profile.active !== true || profile.clinic_id !== requestRow?.clinic_id) {
      return json({ error: "Counter payment request does not belong to your active clinic" }, 403);
    }
    if (!new Set(["owner", "head_doctor", "receptionist"]).has(String(profile.role || ""))) {
      return json({ error: "Your role cannot create counter payment QR codes" }, 403);
    }
    if (requestError || !requestRow) return json({ error: "Counter payment request not found" }, 404);
    if (requestRow.request_mode !== "counter_qr") return json({ error: "Payment request is not a counter QR request" }, 409);

    if (requestRow.status === "pending" && /^https:\/\//i.test(String(requestRow.checkout_url || ""))) {
      return json({
        paymentRequestId: requestRow.id,
        provider: requestRow.provider,
        amount: Number(requestRow.amount || 0),
        currencyCode: String(requestRow.currency_code || "INR").toUpperCase(),
        checkoutUrl: requestRow.checkout_url,
        expiresAt: requestRow.expires_at || null,
      });
    }
    if (requestRow.status !== "prepared") return json({ error: "Counter payment request is no longer available" }, 409);

    const { data: account, error: accountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("id,provider,provider_merchant_id,status,verification_status,payments_enabled,settlements_enabled")
      .eq("id", requestRow.payment_account_id)
      .eq("clinic_id", requestRow.clinic_id)
      .single();
    if (accountError || !account) return json({ error: "Receiving account not found" }, 409);
    if (
      account.provider !== requestRow.provider ||
      account.status !== "connected" ||
      account.verification_status !== "verified" ||
      account.payments_enabled !== true ||
      account.settlements_enabled !== true
    ) {
      return json({ error: "Receiving account is not verified and enabled" }, 409);
    }

    if (requestRow.provider !== "phonepe") {
      return json({ error: "Counter QR is currently enabled for PhonePe clinics only" }, 409);
    }
    if (String(requestRow.country_code || "").toUpperCase() !== "IN" || String(requestRow.currency_code || "").toUpperCase() !== "INR") {
      return json({ error: "PhonePe counter QR is enabled only for Indian INR clinics" }, 409);
    }
    const merchantId = String(account.provider_merchant_id || "").trim();
    if (!merchantId) return json({ error: "Clinic PhonePe Merchant ID is not configured" }, 409);

    const { data: claimed, error: claimError } = await adminClient
      .from("patient_payment_requests")
      .update({ status: "provider_pending", provider_status: "creating_checkout" })
      .eq("id", requestRow.id)
      .eq("status", "prepared")
      .eq("payment_account_id", account.id)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed || claimed.length !== 1) return json({ error: "Counter payment request was already claimed" }, 409);

    try {
      const created = await createPhonePeCheckout({
        requestId: requestRow.id,
        amount: Number(requestRow.amount || 0),
        currencyCode: String(requestRow.currency_code || "INR").toUpperCase(),
        merchantId,
        category: String(requestRow.payment_category || "other"),
      });

      const { error: attachError } = await adminClient.rpc("attach_v28_provider_checkout", {
        p_payment_request_id: requestRow.id,
        p_provider_request_id: created.providerRequestId,
        p_checkout_url: created.checkoutUrl,
        p_expires_at: created.expiresAt,
      });
      if (attachError) throw attachError;

      return json({
        paymentRequestId: requestRow.id,
        provider: "phonepe",
        amount: Number(requestRow.amount || 0),
        currencyCode: "INR",
        checkoutUrl: created.checkoutUrl,
        expiresAt: created.expiresAt,
        paymentCategory: requestRow.payment_category,
        environment: phonePeEnvironment(),
      });
    } catch (error) {
      await adminClient
        .from("patient_payment_requests")
        .update({
          status: "failed",
          provider_status: "checkout_failed",
          failure_code: "phonepe_counter_checkout_failed",
          failure_message: "PhonePe counter checkout creation failed. No CapDent payment was recorded.",
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id)
        .eq("status", "provider_pending");
      throw error;
    }
  } catch (error) {
    console.error("Counter payment checkout error", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Counter payment checkout failed" }, 500);
  }
});
