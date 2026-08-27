import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import QRCode from "https://esm.sh/qrcode@1.5.4";

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

    const [{ data: profile, error: profileError }, { data: requestRow, error: requestError }] = await Promise.all([
      adminClient.from("profiles").select("clinic_id,role,active").eq("id", userData.user.id).single(),
      adminClient
        .from("patient_payment_requests")
        .select("id,clinic_id,request_mode,payment_category,amount,currency_code,status,checkout_url,expires_at")
        .eq("id", paymentRequestId)
        .single(),
    ]);

    if (profileError || !profile || profile.active !== true) return json({ error: "Active clinic profile not found" }, 403);
    if (requestError || !requestRow) return json({ error: "Counter payment request not found" }, 404);
    if (profile.clinic_id !== requestRow.clinic_id) return json({ error: "Payment request does not belong to your clinic" }, 403);
    if (!new Set(["owner", "head_doctor", "receptionist"]).has(String(profile.role || ""))) {
      return json({ error: "Your role cannot view counter payment QR codes" }, 403);
    }
    if (requestRow.request_mode !== "counter_qr") return json({ error: "Payment request is not a counter QR request" }, 409);
    if (!new Set(["pending", "provider_pending"]).has(String(requestRow.status || ""))) {
      return json({ error: "Counter payment QR is not currently payable" }, 409);
    }

    const checkoutUrl = String(requestRow.checkout_url || "").trim();
    if (!/^https:\/\//i.test(checkoutUrl)) return json({ error: "Provider checkout URL is not ready" }, 409);
    if (requestRow.expires_at && new Date(requestRow.expires_at).getTime() <= Date.now()) {
      return json({ error: "Counter payment QR has expired" }, 410);
    }

    const qrSvg = await QRCode.toString(checkoutUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    });

    return json({
      paymentRequestId: requestRow.id,
      status: requestRow.status,
      paymentCategory: requestRow.payment_category,
      amount: Number(requestRow.amount || 0),
      currencyCode: String(requestRow.currency_code || "INR").toUpperCase(),
      expiresAt: requestRow.expires_at || null,
      checkoutUrl,
      qrSvg,
    });
  } catch (error) {
    console.error("Counter payment QR error", error instanceof Error ? error.message : error);
    return json({ error: "Counter payment QR could not be generated" }, 500);
  }
});
