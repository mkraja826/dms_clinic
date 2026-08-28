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

function maskMerchantId(value: string | null | undefined) {
  const merchantId = String(value || "").trim();
  if (!merchantId) return null;
  if (merchantId.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, merchantId.length - 4))}${merchantId.slice(-4)}`;
}

function maskUpiId(value: string | null | undefined) {
  const upiId = String(value || "").trim();
  if (!upiId) return null;
  const [handle, provider] = upiId.split("@");
  if (!provider) return "****";
  const visible = handle.length <= 2 ? handle.slice(0, 1) : `${handle.slice(0, 2)}${"*".repeat(Math.min(6, handle.length - 2))}`;
  return `${visible}@${provider}`;
}

function validMerchantId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(value);
}

function validUpiId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}@[A-Za-z0-9][A-Za-z0-9.-]{1,63}$/.test(value);
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
      return json({ error: "Only the clinic owner or head doctor can manage PhonePe receiving accounts" }, 403);
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
    if (countryCode !== "IN" || currencyCode !== "INR") {
      return json({ error: "PhonePe/UPI receiving accounts are available only for Indian INR clinics" }, 409);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "list").trim().toLowerCase();

    if (action === "list") {
      const { data, error } = await adminClient
        .from("clinic_payment_accounts")
        .select("id,account_label,provider_account_id,provider_merchant_id,collection_mode,manual_confirmation_required,status,verification_status,verification_method,verification_checked_at,verification_failure_reason,payments_enabled,settlements_enabled,is_default,connected_at,last_verified_at,disabled_at,created_at")
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;

      return json({
        provider: "phonepe",
        accounts: (data || []).map((row) => ({
          id: row.id,
          label: row.account_label,
          upiIdMasked: maskUpiId(row.provider_account_id),
          merchantIdMasked: maskMerchantId(row.provider_merchant_id),
          collectionMode: row.collection_mode || "phonepe_api",
          manualConfirmationRequired: row.manual_confirmation_required === true,
          status: row.status,
          verificationStatus: row.verification_status,
          verificationMethod: row.verification_method,
          verificationCheckedAt: row.verification_checked_at,
          verificationFailureReason: row.verification_failure_reason,
          paymentsEnabled: row.payments_enabled,
          settlementsEnabled: row.settlements_enabled,
          isDefault: row.is_default,
          connectedAt: row.connected_at,
          lastVerifiedAt: row.last_verified_at,
          disabledAt: row.disabled_at,
        })),
      });
    }

    const label = String(body.label || "Primary").trim();
    if (!label || label.length > 80) return json({ error: "Account label must be between 1 and 80 characters" }, 400);

    if (action === "add_upi") {
      const upiId = String(body.upi_id || "").trim().toLowerCase();
      if (!validUpiId(upiId)) return json({ error: "Enter a valid UPI ID such as clinic@bank" }, 400);

      const { count, error: countError } = await adminClient
        .from("clinic_payment_accounts")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .neq("status", "disabled");
      if (countError) throw countError;
      if ((count || 0) >= 10) return json({ error: "A clinic can have at most 10 active receiving accounts" }, 409);

      const { data: existing, error: existingError } = await adminClient
        .from("clinic_payment_accounts")
        .select("id,status")
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .eq("provider_account_id", upiId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ error: "This UPI ID is already added to the clinic" }, 409);

      const { count: defaultCount, error: defaultCountError } = await adminClient
        .from("clinic_payment_accounts")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .eq("is_default", true)
        .neq("status", "disabled");
      if (defaultCountError) throw defaultCountError;
      const makeDefault = (defaultCount || 0) === 0;
      const now = new Date().toISOString();

      const { data: inserted, error: insertError } = await adminClient
        .from("clinic_payment_accounts")
        .insert({
          clinic_id: profile.clinic_id,
          provider: "phonepe",
          country_code: "IN",
          currency_code: "INR",
          provider_account_id: upiId,
          provider_merchant_id: null,
          collection_mode: "manual_upi",
          manual_confirmation_required: true,
          account_label: label,
          is_default: makeDefault,
          status: "connected",
          verification_status: "pending",
          verification_method: null,
          verification_reference: null,
          verification_checked_at: null,
          verification_failure_reason: null,
          payments_enabled: true,
          settlements_enabled: false,
          connected_by: profile.id,
          connected_at: now,
          last_verified_at: null,
          disabled_at: null,
        })
        .select("id,account_label,provider_account_id,collection_mode,status,verification_status,is_default,created_at")
        .single();
      if (insertError) throw insertError;

      return json({
        account: {
          id: inserted.id,
          label: inserted.account_label,
          upiIdMasked: maskUpiId(inserted.provider_account_id),
          collectionMode: inserted.collection_mode,
          manualConfirmationRequired: true,
          status: inserted.status,
          verificationStatus: inserted.verification_status,
          isDefault: inserted.is_default,
        },
        message: "UPI receiving account added. Counter payments require staff confirmation after the clinic verifies receipt in PhonePe Business or its bank account.",
      }, 201);
    }

    if (action === "add") {
      const merchantId = String(body.merchant_id || "").trim();
      if (!validMerchantId(merchantId)) return json({ error: "Enter a valid PhonePe Merchant ID" }, 400);

      const { count, error: countError } = await adminClient
        .from("clinic_payment_accounts")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .neq("status", "disabled");
      if (countError) throw countError;
      if ((count || 0) >= 10) return json({ error: "A clinic can have at most 10 active PhonePe accounts" }, 409);

      const { data: existing, error: existingError } = await adminClient
        .from("clinic_payment_accounts")
        .select("id,status")
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .eq("provider_merchant_id", merchantId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ error: "This PhonePe Merchant ID is already added to the clinic" }, 409);

      const { data: inserted, error: insertError } = await adminClient
        .from("clinic_payment_accounts")
        .insert({
          clinic_id: profile.clinic_id,
          provider: "phonepe",
          country_code: "IN",
          currency_code: "INR",
          provider_merchant_id: merchantId,
          collection_mode: "phonepe_api",
          manual_confirmation_required: false,
          account_label: label,
          is_default: false,
          status: "pending",
          verification_status: "pending",
          verification_method: null,
          verification_reference: null,
          verification_checked_at: null,
          verification_failure_reason: null,
          payments_enabled: false,
          settlements_enabled: false,
          connected_by: profile.id,
          connected_at: null,
          last_verified_at: null,
          disabled_at: null,
        })
        .select("id,account_label,status,verification_status,is_default,created_at")
        .single();
      if (insertError) throw insertError;

      return json({
        account: {
          id: inserted.id,
          label: inserted.account_label,
          merchantIdMasked: maskMerchantId(merchantId),
          collectionMode: "phonepe_api",
          manualConfirmationRequired: false,
          status: inserted.status,
          verificationStatus: inserted.verification_status,
          isDefault: inserted.is_default,
        },
        message: "Merchant account added for future PhonePe provider verification.",
      }, 201);
    }

    const accountId = String(body.account_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return json({ error: "A valid payment account ID is required" }, 400);
    }

    const { data: account, error: accountError } = await adminClient
      .from("clinic_payment_accounts")
      .select("id,status,verification_status,payments_enabled,settlements_enabled,is_default,collection_mode,provider_account_id")
      .eq("id", accountId)
      .eq("clinic_id", profile.clinic_id)
      .eq("provider", "phonepe")
      .single();
    if (accountError || !account) return json({ error: "PhonePe account not found in this clinic" }, 404);

    if (action === "set_default") {
      const manualReady =
        account.collection_mode === "manual_upi" &&
        account.status === "connected" &&
        account.payments_enabled === true &&
        Boolean(String(account.provider_account_id || "").trim());
      const apiReady =
        account.collection_mode === "phonepe_api" &&
        account.status === "connected" &&
        account.verification_status === "verified" &&
        account.payments_enabled === true &&
        account.settlements_enabled === true;
      if (!manualReady && !apiReady) {
        return json({ error: "This receiving account is not ready to be used as the clinic default" }, 409);
      }

      const { error: clearError } = await adminClient
        .from("clinic_payment_accounts")
        .update({ is_default: false })
        .eq("clinic_id", profile.clinic_id)
        .eq("provider", "phonepe")
        .eq("is_default", true);
      if (clearError) throw clearError;

      const { error: defaultError } = await adminClient
        .from("clinic_payment_accounts")
        .update({ is_default: true })
        .eq("id", accountId)
        .eq("clinic_id", profile.clinic_id);
      if (defaultError) throw defaultError;

      return json({ accountId, isDefault: true });
    }

    if (action === "disable") {
      const { error: disableError } = await adminClient
        .from("clinic_payment_accounts")
        .update({
          status: "disabled",
          verification_status: account.collection_mode === "phonepe_api" ? "revoked" : account.verification_status,
          payments_enabled: false,
          settlements_enabled: false,
          is_default: false,
          disabled_at: new Date().toISOString(),
        })
        .eq("id", accountId)
        .eq("clinic_id", profile.clinic_id);
      if (disableError) throw disableError;

      return json({ accountId, status: "disabled", isDefault: false });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("PhonePe payment-account management error", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "PhonePe account management failed" }, 500);
  }
});
