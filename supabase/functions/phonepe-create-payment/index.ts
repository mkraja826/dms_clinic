import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createPhonePeCheckout,
  currentPhonePeEnvironment,
  requiredEnv,
  safePhonePeCheckoutSnapshot,
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
      .select("id,clinic_id,role,active")
      .eq("id", userData.user.id)
      .eq("active", true)
      .single();
    if (profileError || !profile?.clinic_id) {
      return json({ error: "Active clinic profile not found" }, 403);
    }

    const allowedRoles = new Set(["owner", "head_doctor", "receptionist"]);
    if (!allowedRoles.has(String(profile.role))) {
      return json({ error: "This role cannot collect PhonePe invoice payments" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body?.invoice_id || "").trim();
    if (!invoiceId) return json({ error: "invoice_id is required" }, 400);

    const { data: invoice, error: invoiceError } = await adminClient
      .from("invoices")
      .select("id,clinic_id,patient_id,total_amount,paid_amount,due_amount,status")
      .eq("id", invoiceId)
      .eq("clinic_id", profile.clinic_id)
      .single();
    if (invoiceError || !invoice) return json({ error: "Invoice not found" }, 404);

    const dueAmount = Number(invoice.due_amount || 0);
    const amountPaise = Math.round(dueAmount * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return json({ error: "This invoice has no payable balance" }, 409);
    }

    const environment = currentPhonePeEnvironment();
    const merchantOrderId = `CD-${crypto.randomUUID()}`;
    const { error: orderInsertError } = await adminClient
      .from("phonepe_payment_orders")
      .insert({
        clinic_id: profile.clinic_id,
        invoice_id: invoice.id,
        patient_id: invoice.patient_id,
        created_by: profile.id,
        merchant_order_id: merchantOrderId,
        amount_paise: amountPaise,
        state: "CREATED",
        environment,
      });
    if (orderInsertError) throw orderInsertError;

    try {
      const checkout = await createPhonePeCheckout({
        merchantOrderId,
        amountPaise,
        redirectUrl: requiredEnv("PHONEPE_REDIRECT_URL"),
      });
      if (!checkout.redirectUrl) throw new Error("PhonePe did not return a checkout URL");

      await adminClient
        .from("phonepe_payment_orders")
        .update({
          state: String(checkout.state || "PENDING").toUpperCase(),
          phonepe_order_id: checkout.orderId || null,
          last_status_payload: safePhonePeCheckoutSnapshot(checkout),
          updated_at: new Date().toISOString(),
        })
        .eq("merchant_order_id", merchantOrderId)
        .eq("environment", environment);

      return json({
        merchantOrderId,
        state: String(checkout.state || "PENDING").toUpperCase(),
        amountPaise,
        redirectUrl: checkout.redirectUrl,
        expireAt: checkout.expireAt || null,
      });
    } catch (error) {
      await adminClient
        .from("phonepe_payment_orders")
        .update({ state: "INIT_FAILED", updated_at: new Date().toISOString() })
        .eq("merchant_order_id", merchantOrderId)
        .eq("environment", environment);
      throw error;
    }
  } catch (error) {
    console.error("PhonePe payment creation failed", error instanceof Error ? error.message : error);
    return json({ error: "PhonePe payment could not be started" }, 502);
  }
});
