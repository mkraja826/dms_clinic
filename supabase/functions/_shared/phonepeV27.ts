type PhonePeEnvironment = "sandbox" | "production";

type PhonePeTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_at?: number;
  expires_in?: number;
};

export type PhonePeOrderStatus = {
  merchantOrderId?: string;
  orderId?: string;
  state?: string;
  amount?: number;
  paymentDetails?: Array<{
    transactionId?: string;
    state?: string;
    amount?: number;
    paymentMode?: string;
  }>;
  errorCode?: string;
  detailedErrorCode?: string;
  [key: string]: unknown;
};

export type PhonePeCheckoutResponse = {
  orderId?: string;
  state?: string;
  expireAt?: number;
  redirectUrl?: string;
};

let cachedToken: { value: string; type: string; expiresAtMs: number } | null = null;

export function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function currentPhonePeEnvironment(): PhonePeEnvironment {
  return Deno.env.get("PHONEPE_ENV")?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function phonePeBaseUrls() {
  if (currentPhonePeEnvironment() === "production") {
    return {
      oauth: "https://api.phonepe.com/apis/identity-manager",
      pg: "https://api.phonepe.com/apis/pg",
    };
  }

  return {
    oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox",
    pg: "https://api-preprod.phonepe.com/apis/pg-sandbox",
  };
}

async function fetchPhonePeToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) return cachedToken;

  const body = new URLSearchParams({
    client_id: requiredEnv("PHONEPE_CLIENT_ID"),
    client_version: requiredEnv("PHONEPE_CLIENT_VERSION"),
    client_secret: requiredEnv("PHONEPE_CLIENT_SECRET"),
    grant_type: "client_credentials",
  });
  const response = await fetch(`${phonePeBaseUrls().oauth}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as PhonePeTokenResponse & {
    error?: string;
  };

  if (!response.ok || !payload.access_token) {
    console.error("PhonePe OAuth failed", response.status, payload.error || "unknown");
    throw new Error("PhonePe authentication failed");
  }

  const expiresAtMs = payload.expires_at
    ? Number(payload.expires_at) * 1000
    : now + Math.max(Number(payload.expires_in || 300), 120) * 1000;
  cachedToken = {
    value: payload.access_token,
    type: payload.token_type || "O-Bearer",
    expiresAtMs,
  };
  return cachedToken;
}

async function phonePeFetch(path: string, init: RequestInit = {}) {
  const token = await fetchPhonePeToken();
  const response = await fetch(`${phonePeBaseUrls().pg}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `${token.type} ${token.value}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("PhonePe API request failed", response.status, path);
    throw new Error("PhonePe could not complete the payment request");
  }

  return payload as any;
}

export async function createPhonePeCheckout(input: {
  merchantOrderId: string;
  amountPaise: number;
  redirectUrl: string;
}) {
  return phonePeFetch("/checkout/v2/pay", {
    method: "POST",
    body: JSON.stringify({
      merchantOrderId: input.merchantOrderId,
      amount: input.amountPaise,
      expireAfter: 1200,
      metaInfo: {
        udf1: "capdent_invoice",
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "CapDent clinic invoice payment",
        merchantUrls: {
          redirectUrl: input.redirectUrl,
        },
      },
    }),
  }) as Promise<PhonePeCheckoutResponse>;
}

export async function getPhonePeOrderStatus(merchantOrderId: string) {
  return phonePeFetch(
    `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true`,
    { method: "GET" }
  ) as Promise<PhonePeOrderStatus>;
}

export function completedPhonePeTransactionId(status: PhonePeOrderStatus) {
  const details = Array.isArray(status.paymentDetails) ? status.paymentDetails : [];
  const completed = details.find((item) => String(item.state || "").toUpperCase() === "COMPLETED");
  return completed?.transactionId || details[0]?.transactionId || null;
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function safePhonePeCheckoutSnapshot(checkout: PhonePeCheckoutResponse) {
  return {
    orderId: safeString(checkout.orderId),
    state: safeString(checkout.state)?.toUpperCase() || "UNKNOWN",
    expireAt: safeNumber(checkout.expireAt),
  };
}

export function safePhonePeOrderStatusSnapshot(status: PhonePeOrderStatus) {
  const paymentDetails = Array.isArray(status.paymentDetails)
    ? status.paymentDetails.map((item) => ({
        transactionId: safeString(item.transactionId),
        state: safeString(item.state)?.toUpperCase() || "UNKNOWN",
        amount: safeNumber(item.amount),
        paymentMode: safeString(item.paymentMode),
      }))
    : [];

  return {
    merchantOrderId: safeString(status.merchantOrderId),
    orderId: safeString(status.orderId),
    state: safeString(status.state)?.toUpperCase() || "UNKNOWN",
    amount: safeNumber(status.amount),
    errorCode: safeString(status.errorCode),
    detailedErrorCode: safeString(status.detailedErrorCode),
    paymentDetails,
  };
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function isValidPhonePeCallbackAuthorization(authorization: string | null) {
  if (!authorization) return false;
  const expected = await sha256Hex(
    `${requiredEnv("PHONEPE_CALLBACK_USERNAME")}:${requiredEnv("PHONEPE_CALLBACK_PASSWORD")}`
  );
  return constantTimeEqual(expected.toLowerCase(), authorization.trim().toLowerCase());
}
