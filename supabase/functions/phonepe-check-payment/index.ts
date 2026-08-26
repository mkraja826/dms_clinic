import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  completedPhonePeTransactionId,
  getPhonePeOrderStatus,
  requiredEnv,
} from "../_shared/phonepeV27.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (Deno.env.get("PHONEPE_PAYMENTS_ENABLED") !== "true") {
      return json({ error: "PhonePe payments are not enabled" }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("clinic_id,role,active")
      .eq("id", userData.user.id)
      .eq("active", true)
      .single();
    if (profileError || !profile?.clinic_id) {
      return json({ error: "Active clinic profile not found" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const merchantOrderId = String(body?.merchant_order_id || "").trim();
    if (!merchantOrderId) return json({ error: "merchant_order_id is required" }, 400);

    const { data: order, error: orderError } = await adminClient
      .from("phonepe_payment_orders")
      .select("merchant_order_id,clinic_id,invoice_id,amount_paise,settled_payment_id")
      .eq("merchant_order_id", merchantOrderId)
      .eq("clinic_id", profile.clinic_id)
      .single();
    if (orderError || !order) return json({ error: "PhonePe order not found" }, 404);

    const status = await getPhonePeOrderStatus(merchantOrderId);
    const state = String(status.state || "UNKNOWN").toUpperCase();
    const statusAmount = Number(status.amount || 0);
    const amountMatches = statusAmount === Number(order.amount_paise);
    const settlementState = state === "COMPLETED" && !amountMatches ? "AMOUNT_MISMATCH" : state;
    const transactionId = completedPhonePeTransactionId(status);

    const { data: settlement, error: settlementError } = await adminClient.rpc(
      "settle_phonepe_invoice_payment_v27",
      {
        p_merchant_order_id: merchantOrderId,
        p_phonepe_state: settlementState,
        p_phonepe_order_id: status.orderId || null,
        p_phonepe_transaction_id: transactionId,
        p_status_payload: status,
      }
    );
    if (settlementError) throw settlementError;

    return json({
      merchantOrderId,
      invoiceId: order.invoice_id,
      state: settlementState,
      settled: Boolean(settlement?.settled),
      idempotent: Boolean(settlement?.idempotent),
      amountVerified: amountMatches,
    });
  } catch (error) {
    console.error("PhonePe payment status failed", error instanceof Error ? error.message : error);
    return json({ error: "PhonePe payment status could not be verified" }, 502);
  }
});
