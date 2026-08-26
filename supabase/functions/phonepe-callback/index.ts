import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  completedPhonePeTransactionId,
  getPhonePeOrderStatus,
  isValidPhonePeCallbackAuthorization,
  requiredEnv,
} from "../_shared/phonepeV27.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (Deno.env.get("PHONEPE_PAYMENTS_ENABLED") !== "true") {
      return json({ acknowledged: true, enabled: false });
    }

    const authorization = req.headers.get("Authorization");
    if (!(await isValidPhonePeCallbackAuthorization(authorization))) {
      return json({ error: "Invalid PhonePe callback authorization" }, 401);
    }

    const rawBody = await req.text();
    const callback = JSON.parse(rawBody || "{}") as {
      payload?: {
        merchantOrderId?: string;
        orderId?: string;
      };
    };
    const callbackMerchantOrderId = String(callback?.payload?.merchantOrderId || "").trim();
    const callbackPhonePeOrderId = String(callback?.payload?.orderId || "").trim();

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let merchantOrderId = callbackMerchantOrderId;
    if (!merchantOrderId && callbackPhonePeOrderId) {
      const { data: mappedOrder, error: mappedOrderError } = await adminClient
        .from("phonepe_payment_orders")
        .select("merchant_order_id")
        .eq("phonepe_order_id", callbackPhonePeOrderId)
        .maybeSingle();
      if (mappedOrderError) throw mappedOrderError;
      merchantOrderId = String(mappedOrder?.merchant_order_id || "").trim();
    }

    if (!merchantOrderId) {
      return json({ acknowledged: true, settled: false, reason: "order_not_mapped" });
    }

    const { data: storedOrder, error: storedOrderError } = await adminClient
      .from("phonepe_payment_orders")
      .select("merchant_order_id,amount_paise")
      .eq("merchant_order_id", merchantOrderId)
      .maybeSingle();
    if (storedOrderError) throw storedOrderError;
    if (!storedOrder) {
      return json({ acknowledged: true, settled: false, reason: "order_not_found" });
    }

    // Never trust callback state/amount as payment proof. Always verify the order
    // directly with PhonePe before any CapDent financial record can be settled.
    const status = await getPhonePeOrderStatus(merchantOrderId);
    const state = String(status.state || "UNKNOWN").toUpperCase();
    const statusAmount = Number(status.amount || 0);
    const amountMatches = statusAmount === Number(storedOrder.amount_paise);
    const settlementState = state === "COMPLETED" && !amountMatches ? "AMOUNT_MISMATCH" : state;
    const transactionId = completedPhonePeTransactionId(status);

    const { data: settlement, error: settlementError } = await adminClient.rpc(
      "settle_phonepe_invoice_payment_v27",
      {
        p_merchant_order_id: merchantOrderId,
        p_phonepe_state: settlementState,
        p_phonepe_order_id: status.orderId || callbackPhonePeOrderId || null,
        p_phonepe_transaction_id: transactionId,
        p_status_payload: status,
      }
    );
    if (settlementError) throw settlementError;

    return json({
      acknowledged: true,
      merchantOrderId,
      state: settlementState,
      amountVerified: amountMatches,
      settled: Boolean(settlement?.settled),
      idempotent: Boolean(settlement?.idempotent),
    });
  } catch (error) {
    console.error("PhonePe callback processing failed", error instanceof Error ? error.message : error);
    return json({ error: "PhonePe callback could not be processed" }, 500);
  }
});
