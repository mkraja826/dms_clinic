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

async function getStripeAccount(accountId: string) {
  const response = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    headers: { Authorization: `Bearer ${requiredEnv("STRIPE_SECRET_KEY")}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Stripe account status request failed", response.status, payload?.error?.type || "unknown");
    throw new Error(payload?.error?.message || "Stripe account status could not be refreshed");
  }
  return payload as any;
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

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id,clinic_id,role,active")
      .eq("id", userData.user.id)
      .eq("active", true)
      .single();
    if (profileError || !profile?.clinic_id) return json({ error: "Active clinic profile not found" }, 403);
    if (!new Set(["owner", "head_doctor"]).has(String(profile.role))) {
      return json({ error: "Only the clinic owner or head doctor can refresh the receiving account" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: paymentAccount, error: paymentAccountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("id,provider_account_id,country_code,currency_code")
      .eq("clinic_id", profile.clinic_id)
      .eq("provider", "card")
      .maybeSingle();
    if (paymentAccountError) throw paymentAccountError;
    if (!paymentAccount?.provider_account_id) {
      return json({ provider: "card", status: "not_connected", paymentsEnabled: false, settlementsEnabled: false });
    }

    const account = await getStripeAccount(String(paymentAccount.provider_account_id));
    const chargesEnabled = account?.charges_enabled === true;
    const payoutsEnabled = account?.payouts_enabled === true;
    const detailsSubmitted = account?.details_submitted === true;
    const disabledReason = String(account?.requirements?.disabled_reason || "").trim();

    let status = "pending";
    if (chargesEnabled && payoutsEnabled) status = "connected";
    else if (disabledReason) status = "restricted";
    else if (!detailsSubmitted) status = "pending";

    const now = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("clinic_payment_accounts")
      .update({
        status,
        payments_enabled: chargesEnabled,
        settlements_enabled: payoutsEnabled,
        connected_at: status === "connected" ? now : null,
        last_verified_at: now,
        disabled_at: null,
      })
      .eq("id", paymentAccount.id)
      .eq("clinic_id", profile.clinic_id);
    if (updateError) throw updateError;

    return json({
      provider: "card",
      status,
      paymentsEnabled: chargesEnabled,
      settlementsEnabled: payoutsEnabled,
      detailsSubmitted,
      requirementsDue: Array.isArray(account?.requirements?.currently_due)
        ? account.requirements.currently_due.length
        : 0,
    });
  } catch (error) {
    console.error("Card receiving-account status sync error", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Card receiving-account status refresh failed" }, 500);
  }
});
