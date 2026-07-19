import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3";

type VerifyBody = {
  product_id?: string;
  purchase_token?: string;
  order_id?: string | null;
};

type PlanConfig = {
  planName: "professional" | "clinic_intelligence";
  planLabel: string;
  monthlyPrice: number;
};

const productCatalog: Record<string, PlanConfig> = {
  midms_monthly_799: {
    planName: "professional",
    planLabel: "CapDent Cloud",
    monthlyPrice: 799,
  },
  midms_clinic_intelligence_monthly: {
    planName: "clinic_intelligence",
    planLabel: "CapDent Intelligence",
    monthlyPrice: 1499,
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pemToPkcs8(privateKey: string) {
  const body = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return base64ToBytes(body).buffer;
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
};

function readServiceAccount(): ServiceAccount {
  const encoded = requiredEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64");
  const decoded = new TextDecoder().decode(base64ToBytes(encoded));
  const credentials = JSON.parse(decoded) as Partial<ServiceAccount>;

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Play service account secret is invalid");
  }

  return credentials as ServiceAccount;
}

async function createGoogleAccessToken(credentials: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
  };
  const claims = {
    iss: credentials.client_email,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: credentials.token_uri || GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${textToBase64Url(JSON.stringify(header))}.${textToBase64Url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;

  const response = await fetch(credentials.token_uri || GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== "string") {
    console.error("Google OAuth token request failed", response.status, payload?.error);
    throw new Error("Google Play authentication failed");
  }

  return payload.access_token as string;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function validDate(value: unknown) {
  const parsed = Date.parse(stringValue(value));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function maxExpiry(items: any[]) {
  let latest: Date | null = null;
  for (const item of items) {
    const date = validDate(item?.expiryTime);
    if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
  }
  return latest;
}

function autoRenewing(items: any[]) {
  return items.some((item) => item?.autoRenewingPlan?.autoRenewEnabled === true);
}

function safePurchaseSnapshot(purchase: any, matchingItems: any[]) {
  return {
    subscriptionState: stringValue(purchase?.subscriptionState),
    acknowledgementState: stringValue(purchase?.acknowledgementState),
    startTime: stringValue(purchase?.startTime) || null,
    latestOrderId: stringValue(purchase?.latestOrderId) || null,
    regionCode: stringValue(purchase?.regionCode) || null,
    testPurchase: Boolean(purchase?.testPurchase),
    linkedPurchaseTokenPresent: Boolean(purchase?.linkedPurchaseToken),
    lineItems: matchingItems.map((item) => ({
      productId: stringValue(item?.productId),
      expiryTime: stringValue(item?.expiryTime) || null,
      autoRenewEnabled: item?.autoRenewingPlan?.autoRenewEnabled === true,
      basePlanId: stringValue(item?.offerDetails?.basePlanId) || null,
      offerId: stringValue(item?.offerDetails?.offerId) || null,
    })),
  };
}

function googleStatusForState(state: string, entitlementGranted: boolean) {
  if (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") return "grace_period";
  if (state === "SUBSCRIPTION_STATE_ON_HOLD") return "account_hold";
  if (state === "SUBSCRIPTION_STATE_EXPIRED") return "expired";
  if (state === "SUBSCRIPTION_STATE_PENDING") return "pending_verification";
  if (state === "SUBSCRIPTION_STATE_PAUSED") return "pending_verification";
  if (state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") return "cancelled";
  if (state === "SUBSCRIPTION_STATE_CANCELED") return entitlementGranted ? "active" : "expired";
  if (state === "SUBSCRIPTION_STATE_ACTIVE") return "active";
  return "pending_verification";
}

function subscriptionStatusForState(state: string, entitlementGranted: boolean) {
  if (entitlementGranted) {
    return state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ? "grace_period" : "active";
  }
  if (state === "SUBSCRIPTION_STATE_EXPIRED" || state === "SUBSCRIPTION_STATE_CANCELED") {
    return "expired";
  }
  if (state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") return "cancelled";
  return "free";
}

async function acknowledgePurchase(input: {
  accessToken: string;
  packageName: string;
  productId: string;
  purchaseToken: string;
}) {
  const url = `${GOOGLE_API_ROOT}/applications/${encodeURIComponent(input.packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(input.productId)}` +
    `/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ developerPayload: "capdent-server-verified" }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.error("Google Play acknowledgement failed", response.status, payload?.error?.status);
    return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const packageName = requiredEnv("GOOGLE_PLAY_PACKAGE_NAME");
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id, clinic_id, role, active")
      .eq("id", userData.user.id)
      .eq("active", true)
      .single();

    if (profileError || !profile?.clinic_id) return json({ error: "Active clinic profile not found" }, 403);
    if (!new Set(["owner", "head_doctor"]).has(String(profile.role))) {
      return json({ error: "Only the clinic owner or head doctor can manage subscriptions" }, 403);
    }

    const body = (await req.json()) as VerifyBody;
    const productId = stringValue(body.product_id).trim();
    const purchaseToken = stringValue(body.purchase_token).trim();
    const configuredPlan = productCatalog[productId];

    if (!configuredPlan) return json({ error: "Unsupported Google Play product" }, 400);
    if (!purchaseToken) return json({ error: "Google Play purchase token is required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: tokenOwner, error: tokenOwnerError } = await adminClient
      .from("clinic_subscriptions")
      .select("clinic_id")
      .eq("google_play_purchase_token", purchaseToken)
      .neq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (tokenOwnerError) throw tokenOwnerError;
    if (tokenOwner) return json({ error: "This Google Play purchase is already linked to another clinic" }, 409);

    const credentials = readServiceAccount();
    const accessToken = await createGoogleAccessToken(credentials);
    const getUrl = `${GOOGLE_API_ROOT}/applications/${encodeURIComponent(packageName)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const googleResponse = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const googlePurchase = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok) {
      console.error("Google Play verification failed", googleResponse.status, googlePurchase?.error?.status);
      const status = googleResponse.status === 404 || googleResponse.status === 410 ? 400 : 502;
      return json({ error: "Google Play could not verify this purchase" }, status);
    }

    const lineItems = Array.isArray(googlePurchase?.lineItems) ? googlePurchase.lineItems : [];
    const matchingItems = lineItems.filter((item: any) => stringValue(item?.productId) === productId);
    if (matchingItems.length === 0) {
      return json({ error: "Verified purchase does not match the selected CapDent plan" }, 400);
    }

    const state = stringValue(googlePurchase?.subscriptionState);
    const expiry = maxExpiry(matchingItems);
    const notExpired = Boolean(expiry && expiry.getTime() > Date.now());
    const entitlementGranted =
      state === "SUBSCRIPTION_STATE_ACTIVE" ||
      state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
      (state === "SUBSCRIPTION_STATE_CANCELED" && notExpired);
    const googleStatus = googleStatusForState(state, entitlementGranted);
    const subscriptionStatus = subscriptionStatusForState(state, entitlementGranted);
    const renews = autoRenewing(matchingItems);
    const verifiedAt = new Date().toISOString();
    const orderId = stringValue(googlePurchase?.latestOrderId) || stringValue(body.order_id) || null;
    const safeSnapshot = safePurchaseSnapshot(googlePurchase, matchingItems);

    const { data: existingSubscription, error: existingError } = await adminClient
      .from("clinic_subscriptions")
      .select("id, google_play_purchase_token, google_play_linked_at, status, plan_name")
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();
    if (existingError) throw existingError;

    const replacingActiveToken =
      Boolean(existingSubscription?.google_play_purchase_token) &&
      existingSubscription.google_play_purchase_token !== purchaseToken;

    let subscription = existingSubscription;

    if (entitlementGranted) {
      const row = {
        clinic_id: profile.clinic_id,
        plan_name: configuredPlan.planName,
        status: subscriptionStatus,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: stringValue(googlePurchase?.startTime) || verifiedAt,
        current_period_end: expiry?.toISOString() || null,
        monthly_price: configuredPlan.monthlyPrice,
        visit_limit: null,
        billing_provider: "google_play",
        google_play_product_id: productId,
        google_play_purchase_token: purchaseToken,
        google_play_order_id: orderId,
        google_play_auto_renewing: renews,
        google_play_status: googleStatus,
        google_play_linked_at: existingSubscription?.google_play_linked_at || verifiedAt,
        google_play_last_event_at: verifiedAt,
        google_play_last_verified_at: verifiedAt,
      };

      const { data: updated, error: updateError } = await adminClient
        .from("clinic_subscriptions")
        .upsert(row, { onConflict: "clinic_id" })
        .select("id,clinic_id,plan_name,status,current_period_start,current_period_end,monthly_price,billing_provider,google_play_product_id,google_play_auto_renewing,google_play_status,google_play_linked_at,google_play_last_event_at,google_play_last_verified_at")
        .single();
      if (updateError) throw updateError;
      subscription = updated;
    } else if (!replacingActiveToken) {
      const row = {
        clinic_id: profile.clinic_id,
        plan_name: "free",
        status: subscriptionStatus,
        current_period_start: null,
        current_period_end: expiry?.toISOString() || null,
        monthly_price: 0,
        visit_limit: null,
        billing_provider: "google_play",
        google_play_product_id: productId,
        google_play_purchase_token: purchaseToken,
        google_play_order_id: orderId,
        google_play_auto_renewing: renews,
        google_play_status: googleStatus,
        google_play_linked_at: existingSubscription?.google_play_linked_at || verifiedAt,
        google_play_last_event_at: verifiedAt,
        google_play_last_verified_at: verifiedAt,
      };

      const { data: updated, error: updateError } = await adminClient
        .from("clinic_subscriptions")
        .upsert(row, { onConflict: "clinic_id" })
        .select("id,clinic_id,plan_name,status,current_period_start,current_period_end,monthly_price,billing_provider,google_play_product_id,google_play_auto_renewing,google_play_status,google_play_linked_at,google_play_last_event_at,google_play_last_verified_at")
        .single();
      if (updateError) throw updateError;
      subscription = updated;
    }

    const eventType = entitlementGranted
      ? `server_verified_${state.toLowerCase().replace("subscription_state_", "")}`
      : `server_rejected_${state.toLowerCase().replace("subscription_state_", "") || "unknown"}`;

    const { error: eventError } = await adminClient.from("google_play_subscription_events").insert({
      clinic_id: profile.clinic_id,
      subscription_id: subscription?.id || null,
      profile_id: profile.id,
      event_type: eventType,
      product_id: productId,
      purchase_token: purchaseToken,
      order_id: orderId,
      auto_renewing: renews,
      raw_purchase: safeSnapshot,
    });
    if (eventError) console.error("Google Play verification event insert failed", eventError.message);

    let acknowledged = stringValue(googlePurchase?.acknowledgementState) === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
    if (entitlementGranted && !acknowledged) {
      acknowledged = await acknowledgePurchase({ accessToken, packageName, productId, purchaseToken });
    }

    return json({
      verified: true,
      activated: entitlementGranted,
      plan: entitlementGranted ? configuredPlan.planName : "free",
      planLabel: entitlementGranted ? configuredPlan.planLabel : "Free",
      googleState: state,
      expiryTime: expiry?.toISOString() || null,
      autoRenewing: renews,
      acknowledged,
      subscription,
      message: entitlementGranted
        ? `${configuredPlan.planLabel} was verified and activated.`
        : "Google Play has not granted paid entitlement. CapDent remains on the Free plan.",
    }, entitlementGranted ? 200 : 202);
  } catch (error) {
    console.error("Google Play subscription verification error", error);
    return json({ error: error instanceof Error ? error.message : "Subscription verification failed" }, 500);
  }
});
