import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const ANDROID_PUBLISHER_SCOPE =
  "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_ROOT =
  "https://androidpublisher.googleapis.com/androidpublisher/v3";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
};

type SubscriptionRow = {
  id: string;
  clinic_id: string;
  google_play_product_id: string | null;
  google_play_purchase_token: string | null;
  google_play_linked_at: string | null;
};

type PlanConfig = {
  planName: "professional" | "clinic_intelligence";
  monthlyPrice: number;
};

class GooglePlayHealthError extends Error {
  constructor(
    readonly stage: "oauth" | "android_publisher",
    readonly upstreamStatus: number | null = null,
    readonly upstreamCode: string | null = null,
  ) {
    super(`Google Play health check failed during ${stage}`);
  }
}

const productCatalog: Record<string, PlanConfig> = {
  midms_monthly_799: {
    planName: "professional",
    monthlyPrice: 800,
  },
  midms_clinic_intelligence_monthly: {
    planName: "clinic_intelligence",
    monthlyPrice: 1499,
  },
};

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const packageName = requiredEnv("GOOGLE_PLAY_PACKAGE_NAME");
const syncSecret = requiredEnv("GOOGLE_PLAY_SYNC_SECRET");
const syncEnabled =
  String(Deno.env.get("GOOGLE_PLAY_SYNC_ENABLED") ?? "false").toLowerCase() ===
    "true";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function secretsMatch(actual: string | null, expected: string) {
  if (!actual) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
  const unsigned = `${textToBase64Url(JSON.stringify(header))}.${
    textToBase64Url(JSON.stringify(claims))
  }`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${
    bytesToBase64Url(new Uint8Array(signature))
  }`;

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
    console.error(
      "Google OAuth token request failed",
      response.status,
      payload?.error,
    );
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
  return items.some(
    (item) => item?.autoRenewingPlan?.autoRenewEnabled === true,
  );
}

function googleStatusForState(state: string, entitlementGranted: boolean) {
  if (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") return "grace_period";
  if (state === "SUBSCRIPTION_STATE_ON_HOLD") return "account_hold";
  if (state === "SUBSCRIPTION_STATE_EXPIRED") return "expired";
  if (state === "SUBSCRIPTION_STATE_PENDING") return "pending_verification";
  if (state === "SUBSCRIPTION_STATE_PAUSED") return "pending_verification";
  if (state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
    return "cancelled";
  }
  if (state === "SUBSCRIPTION_STATE_CANCELED") {
    return entitlementGranted ? "active" : "expired";
  }
  if (state === "SUBSCRIPTION_STATE_ACTIVE") return "active";
  return "pending_verification";
}

function subscriptionStatusForState(
  state: string,
  entitlementGranted: boolean,
) {
  if (entitlementGranted) {
    return state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      ? "grace_period"
      : "active";
  }
  if (
    state === "SUBSCRIPTION_STATE_EXPIRED" ||
    state === "SUBSCRIPTION_STATE_CANCELED"
  ) {
    return "expired";
  }
  if (state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
    return "cancelled";
  }
  return "free";
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
      autoRenewEnabled:
        item?.autoRenewingPlan?.autoRenewEnabled === true,
      basePlanId: stringValue(item?.offerDetails?.basePlanId) || null,
      offerId: stringValue(item?.offerDetails?.offerId) || null,
    })),
  };
}

async function acknowledgePurchase(input: {
  accessToken: string;
  productId: string;
  purchaseToken: string;
}) {
  const url =
    `${GOOGLE_API_ROOT}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(input.productId)}` +
    `/tokens/${encodeURIComponent(input.purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ developerPayload: "capdent-server-sync" }),
  });
  if (!response.ok) {
    console.error("Google Play sync acknowledgement failed", response.status);
  }
  return response.ok;
}

async function syncSubscription(
  row: SubscriptionRow,
  accessToken: string,
) {
  const productId = stringValue(row.google_play_product_id).trim();
  const purchaseToken = stringValue(row.google_play_purchase_token).trim();
  const configuredPlan = productCatalog[productId];
  if (!configuredPlan || !purchaseToken) {
    return { id: row.id, status: "unsupported-or-missing" };
  }

  const getUrl =
    `${GOOGLE_API_ROOT}/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const googleResponse = await fetch(getUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const googlePurchase = await googleResponse.json().catch(() => ({}));
  if (!googleResponse.ok) {
    console.error(
      "Google Play lifecycle sync failed",
      row.id,
      googleResponse.status,
      googlePurchase?.error?.status,
    );
    return { id: row.id, status: "google-error" };
  }

  const lineItems = Array.isArray(googlePurchase?.lineItems)
    ? googlePurchase.lineItems
    : [];
  const matchingItems = lineItems.filter(
    (item: any) => stringValue(item?.productId) === productId,
  );
  if (matchingItems.length === 0) {
    return { id: row.id, status: "product-mismatch" };
  }

  const state = stringValue(googlePurchase?.subscriptionState);
  const expiry = maxExpiry(matchingItems);
  const notExpired = Boolean(expiry && expiry.getTime() > Date.now());
  const entitlementGranted =
    state === "SUBSCRIPTION_STATE_ACTIVE" ||
    state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
    (state === "SUBSCRIPTION_STATE_CANCELED" && notExpired);
  const googleStatus = googleStatusForState(state, entitlementGranted);
  const subscriptionStatus = subscriptionStatusForState(
    state,
    entitlementGranted,
  );
  const renews = autoRenewing(matchingItems);
  const verifiedAt = new Date().toISOString();
  const orderId = stringValue(googlePurchase?.latestOrderId) || null;
  const safeSnapshot = safePurchaseSnapshot(googlePurchase, matchingItems);

  const { error: updateError } = await supabase
    .from("clinic_subscriptions")
    .update({
      plan_name: entitlementGranted ? configuredPlan.planName : "free",
      status: subscriptionStatus,
      trial_started_at: null,
      trial_ends_at: null,
      current_period_start: entitlementGranted
        ? stringValue(googlePurchase?.startTime) || verifiedAt
        : null,
      current_period_end: expiry?.toISOString() || null,
      monthly_price: entitlementGranted ? configuredPlan.monthlyPrice : 0,
      visit_limit: null,
      billing_provider: "google_play",
      google_play_order_id: orderId,
      google_play_auto_renewing: renews,
      google_play_status: googleStatus,
      google_play_linked_at: row.google_play_linked_at || verifiedAt,
      google_play_last_event_at: verifiedAt,
      google_play_last_verified_at: verifiedAt,
    })
    .eq("id", row.id);
  if (updateError) throw updateError;

  const eventType =
    `server_sync_${state.toLowerCase().replace("subscription_state_", "") ||
      "unknown"}`;
  const { error: eventError } = await supabase
    .from("google_play_subscription_events")
    .insert({
      clinic_id: row.clinic_id,
      subscription_id: row.id,
      profile_id: null,
      event_type: eventType,
      product_id: productId,
      purchase_token: purchaseToken,
      order_id: orderId,
      auto_renewing: renews,
      raw_purchase: safeSnapshot,
    });
  if (eventError) {
    console.error("Google Play lifecycle event insert failed", eventError.message);
  }

  let acknowledged =
    stringValue(googlePurchase?.acknowledgementState) ===
      "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  if (entitlementGranted && !acknowledged) {
    acknowledged = await acknowledgePurchase({
      accessToken,
      productId,
      purchaseToken,
    });
  }

  return {
    id: row.id,
    status: entitlementGranted ? "entitled" : googleStatus,
    acknowledged,
  };
}

async function runSync() {
  const { data, error } = await supabase
    .from("clinic_subscriptions")
    .select(
      "id,clinic_id,google_play_product_id,google_play_purchase_token,google_play_linked_at",
    )
    .eq("billing_provider", "google_play")
    .not("google_play_product_id", "is", null)
    .not("google_play_purchase_token", "is", null)
    .order("google_play_last_verified_at", {
      ascending: true,
      nullsFirst: true,
    })
    .limit(100);
  if (error) throw error;

  const rows = (data ?? []) as SubscriptionRow[];
  if (rows.length === 0) {
    return { checked: 0, entitled: 0, downgraded: 0, errors: 0 };
  }

  const accessToken = await createGoogleAccessToken(readServiceAccount());
  const results: Array<{ id: string; status: string; acknowledged?: boolean }> =
    [];
  for (let index = 0; index < rows.length; index += 10) {
    const batch = rows.slice(index, index + 10);
    results.push(
      ...(await Promise.all(
        batch.map(async (row) => {
          try {
            return await syncSubscription(row, accessToken);
          } catch (syncError) {
            console.error("Google Play subscription sync failed", row.id, syncError);
            return { id: row.id, status: "sync-error" };
          }
        }),
      )),
    );
  }

  const entitled = results.filter((result) => result.status === "entitled")
    .length;
  const errors = results.filter((result) =>
    ["google-error", "product-mismatch", "unsupported-or-missing", "sync-error"]
      .includes(result.status)
  ).length;

  return {
    checked: results.length,
    entitled,
    downgraded: results.length - entitled - errors,
    errors,
  };
}

async function checkGooglePlayAccess() {
  let accessToken: string;
  try {
    accessToken = await createGoogleAccessToken(readServiceAccount());
  } catch {
    throw new GooglePlayHealthError("oauth");
  }
  const url =
    `${GOOGLE_API_ROOT}/applications/${encodeURIComponent(packageName)}` +
    "/purchases/subscriptionsv2/tokens/capdent-health-check-invalid-token";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  // A well-authenticated request with a deliberately invalid purchase token
  // reaches the subscriptionsv2 API and returns a client/not-found response.
  // This checks production purchase access without requiring product-catalog
  // permissions or a real patient's purchase token.
  if ([400, 404, 410].includes(response.status)) {
    return {
      authorized: true,
      probeStatus: response.status,
    };
  }
  if (!response.ok) {
    console.error(
      "Google Play production access check failed",
      response.status,
      payload?.error?.status,
    );
    throw new GooglePlayHealthError(
      "android_publisher",
      response.status,
      stringValue(payload?.error?.status) || null,
    );
  }
  return {
    authorized: true,
    probeStatus: response.status,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    !(await secretsMatch(
      request.headers.get("x-capdent-google-play-sync-secret"),
      syncSecret,
    ))
  ) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!syncEnabled) {
    return json({
      ok: true,
      disabled: true,
      message: "GOOGLE_PLAY_SYNC_ENABLED is false.",
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.mode === "health") {
      try {
        return json({ ok: true, ...(await checkGooglePlayAccess()) });
      } catch (error) {
        if (error instanceof GooglePlayHealthError) {
          return json({
            ok: false,
            stage: error.stage,
            upstreamStatus: error.upstreamStatus,
            upstreamCode: error.upstreamCode,
          }, 502);
        }
        throw error;
      }
    }
    return json({ ok: true, ...(await runSync()) });
  } catch (error) {
    console.error("Google Play lifecycle maintenance failed", error);
    return json({ error: "Google Play lifecycle maintenance failed" }, 500);
  }
});
