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

function requireHttpsUrl(name: string) {
  const value = requiredEnv(name);
  if (!/^https:\/\//i.test(value)) throw new Error(`${name} must be an HTTPS URL`);
  return value;
}

async function stripeRequest(
  path: string,
  options?: { method?: string; body?: URLSearchParams }
) {
  const secretKey = requiredEnv("STRIPE_SECRET_KEY");
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(options?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options?.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Stripe Connect request failed", response.status, payload?.error?.type || "unknown");
    throw new Error(payload?.error?.message || "Stripe Connect request failed");
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
      return json({ error: "Only the clinic owner or head doctor can connect the receiving account" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: clinic, error: clinicError } = await adminClient
      .from("clinics")
      .select("id,country_code,currency_code")
      .eq("id", profile.clinic_id)
      .single();
    if (clinicError || !clinic) throw clinicError || new Error("Clinic not found");

    const countryCode = String(clinic.country_code || "").trim().toUpperCase();
    const currencyCode = String(clinic.currency_code || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return json({ error: "Clinic country must be configured first" }, 409);
    if (!/^[A-Z]{3}$/.test(currencyCode)) return json({ error: "Clinic currency must be configured first" }, 409);
    if (countryCode === "IN") return json({ error: "Indian clinics use PhonePe, not card receiving-account onboarding" }, 409);

    const { data: existing, error: existingError } = await adminClient
      .from("clinic_payment_accounts")
      .select("id,provider_account_id,status")
      .eq("clinic_id", profile.clinic_id)
      .eq("provider", "card")
      .maybeSingle();
    if (existingError) throw existingError;

    let accountId = String(existing?.provider_account_id || "").trim();
    if (!accountId) {
      const accountBody = new URLSearchParams();
      accountBody.set("type", "express");
      accountBody.set("country", countryCode);
      accountBody.set("capabilities[card_payments][requested]", "true");
      accountBody.set("capabilities[transfers][requested]", "true");
      accountBody.set("metadata[capdent_clinic_id]", profile.clinic_id);

      const account = await stripeRequest("/v1/accounts", { method: "POST", body: accountBody });
      accountId = String(account?.id || "").trim();
      if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Stripe did not return a connected account ID");

      const { error: upsertError } = await adminClient.from("clinic_payment_accounts").upsert(
        {
          clinic_id: profile.clinic_id,
          provider: "card",
          country_code: countryCode,
          currency_code: currencyCode,
          provider_account_id: accountId,
          status: "pending",
          payments_enabled: false,
          settlements_enabled: false,
          connected_by: profile.id,
          disabled_at: null,
          last_verified_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id,provider" }
      );
      if (upsertError) throw upsertError;
    }

    const linkBody = new URLSearchParams();
    linkBody.set("account", accountId);
    linkBody.set("refresh_url", requireHttpsUrl("STRIPE_CONNECT_REFRESH_URL"));
    linkBody.set("return_url", requireHttpsUrl("STRIPE_CONNECT_RETURN_URL"));
    linkBody.set("type", "account_onboarding");

    const accountLink = await stripeRequest("/v1/account_links", { method: "POST", body: linkBody });
    const onboardingUrl = String(accountLink?.url || "").trim();
    if (!/^https:\/\//i.test(onboardingUrl)) throw new Error("Stripe did not return a secure onboarding URL");

    return json({
      provider: "card",
      accountId,
      onboardingUrl,
      expiresAt: accountLink?.expires_at ? new Date(Number(accountLink.expires_at) * 1000).toISOString() : null,
      message: "Open the Stripe-hosted page in your browser to complete the clinic receiving-account setup.",
    });
  } catch (error) {
    console.error("Card receiving-account onboarding error", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Card receiving-account onboarding failed" }, 500);
  }
});
