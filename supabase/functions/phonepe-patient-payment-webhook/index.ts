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

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function normalizeShaAuthorization(value: string | null) {
  return String(value || "")
    .trim()
    .replace(/^sha256\s+/i, "")
    .toLowerCase();
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // CapDent intentionally uses PhonePe's documented SHA webhook option for
    // this endpoint. Username/password exist only as Supabase Edge secrets.
    const username = requiredEnv("PHONEPE_WEBHOOK_USERNAME");
    const password = requiredEnv("PHONEPE_WEBHOOK_PASSWORD");
    const expectedAuth = await sha256(`${username}:${password}`);
    const receivedAuth = normalizeShaAuthorization(req.headers.get("Authorization"));

    if (!/^[a-f0-9]{64}$/.test(receivedAuth) || !constantTimeEqual(receivedAuth, expectedAuth)) {
      return json({ error: "Invalid PhonePe webhook authorization" }, 401);
    }

    const rawBody = await req.text();
    const payloadDigest = await sha256(rawBody);
    const body = JSON.parse(rawBody || "{}") as any;
    const event = String(body?.event || "").trim();

    if (!new Set(["paylink.order.completed", "paylink.order.failed"]).has(event)) {
      // Acknowledge unneeded event types after authentication so PhonePe does
      // not repeatedly retry events CapDent deliberately does not subscribe to.
      return json({ received: true, ignored: true });
    }

    const payload = body?.payload || {};
    const orderId = String(payload?.orderId || "").trim();
    const merchantOrderId = String(payload?.merchantOrderId || "").trim();
    const merchantId = String(payload?.merchantId || "").trim();
    const state = String(payload?.state || "").trim().toUpperCase();
    const amountPaise = Number(payload?.amount);

    if (!orderId || !merchantOrderId || !merchantId) {
      return json({ error: "PhonePe webhook is missing order identifiers" }, 400);
    }
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      return json({ error: "PhonePe webhook amount is invalid" }, 400);
    }

    const success = event === "paylink.order.completed" && state === "COMPLETED";
    const failed = event === "paylink.order.failed" || state === "FAILED";
    if (!success && !failed) return json({ received: true, ignored: true });

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: requestRow, error: requestError } = await adminClient
      .from("patient_payment_requests")
      .select("id,clinic_id,payment_account_id,provider,provider_request_id,status")
      .eq("provider", "phonepe")
      .eq("provider_request_id", orderId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!requestRow) return json({ error: "PhonePe order is not linked to a CapDent payment request" }, 404);

    const { data: account, error: accountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("provider_merchant_id")
      .eq("id", requestRow.payment_account_id)
      .eq("clinic_id", requestRow.clinic_id)
      .eq("provider", "phonepe")
      .single();
    if (accountError || !account) throw accountError || new Error("Clinic PhonePe account not found");
    if (String(account.provider_merchant_id || "").trim() !== merchantId) {
      return json({ error: "PhonePe merchant does not match the clinic receiving account" }, 409);
    }

    const transactionId = firstTransactionId(payload);
    const eventFingerprint = [event, orderId, merchantOrderId, transactionId, state, amountPaise].join("|");
    const providerEventId = await sha256(eventFingerprint);

    const { data: inserted, error: eventError } = await adminClient.rpc(
      "record_v28_verified_provider_event",
      {
        p_payment_request_id: requestRow.id,
        p_provider_event_id: providerEventId,
        p_provider_request_id: orderId,
        p_event_type: event,
        p_amount: amountPaise / 100,
        p_currency_code: "INR",
        p_payload_digest: payloadDigest,
        p_success: success,
      }
    );
    if (eventError) throw eventError;

    let reconciliation: unknown = null;
    if (success) {
      const { data, error } = await adminClient.rpc("reconcile_v28_verified_patient_payment", {
        p_payment_request_id: requestRow.id,
      });
      if (error) throw error;
      reconciliation = data;
    }

    return json({
      received: true,
      duplicate: inserted === false,
      state: success ? "completed" : "failed",
      reconciliation,
    });
  } catch (error) {
    console.error("PhonePe patient payment webhook error", error instanceof Error ? error.message : error);
    return json({ error: "PhonePe webhook processing failed" }, 500);
  }
});
