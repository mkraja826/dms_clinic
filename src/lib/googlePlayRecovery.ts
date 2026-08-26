import {
  finishGooglePlaySubscriptionPurchase,
  getGooglePlayPurchaseToken,
  GOOGLE_PLAY_PRODUCT_IDS,
  initGooglePlayBilling,
} from "@/lib/googlePlayBilling";
import { invalidateSupabaseCache, supabase } from "@/lib/supabase";

const CAPDENT_GOOGLE_PLAY_PRODUCTS = new Set<string>(GOOGLE_PLAY_PRODUCT_IDS);

export type GooglePlayRecoveryResult = {
  found: boolean;
  activated: boolean;
  checked: number;
  productId: string | null;
  plan: string;
  planLabel: string;
  googleState: string | null;
  expiryTime: string | null;
  autoRenewing: boolean;
  subscription: any | null;
  message: string;
};

function getIapModule() {
  try {
    return require("react-native-iap");
  } catch {
    return null;
  }
}

function purchaseProductId(purchase: any) {
  return String(
    purchase?.productId ||
      purchase?.id ||
      (Array.isArray(purchase?.productIds) ? purchase.productIds[0] : "") ||
      ""
  ).trim();
}

function purchaseTime(purchase: any) {
  const numeric = Number(purchase?.transactionDate || purchase?.purchaseTime || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Date.parse(String(purchase?.transactionDate || purchase?.purchaseDate || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function verifyGooglePlayPurchaseState(purchase: any): Promise<GooglePlayRecoveryResult> {
  const purchaseToken = getGooglePlayPurchaseToken(purchase);
  if (!purchaseToken) throw new Error("Google Play purchase token was not returned.");

  const productId = purchaseProductId(purchase);
  if (!productId || !CAPDENT_GOOGLE_PLAY_PRODUCTS.has(productId)) {
    throw new Error("Google Play did not return a recognized CapDent subscription.");
  }

  const { data, error } = await supabase.functions.invoke("verify-google-play-subscription", {
    body: {
      product_id: productId,
      purchase_token: purchaseToken,
      order_id: purchase?.orderId || purchase?.transactionId || null,
    },
  });

  if (error) throw error;
  if (!data?.verified || !data?.subscription) {
    throw new Error(data?.message || "Google Play could not refresh this subscription.");
  }

  invalidateSupabaseCache();

  return {
    found: true,
    activated: Boolean(data.activated),
    checked: 1,
    productId,
    plan: String(data.plan || "free"),
    planLabel: String(data.planLabel || (data.activated ? "Paid" : "Free")),
    googleState: data.googleState ? String(data.googleState) : null,
    expiryTime: data.expiryTime ? String(data.expiryTime) : null,
    autoRenewing: Boolean(data.autoRenewing),
    subscription: data.subscription,
    message: String(
      data.message ||
        (data.activated
          ? "Google Play subscription verified."
          : "Google Play status refreshed. Paid entitlement is not currently active.")
    ),
  };
}

export async function restoreGooglePlaySubscription(): Promise<GooglePlayRecoveryResult> {
  await initGooglePlayBilling();

  const iap = getIapModule();
  if (!iap?.getAvailablePurchases) {
    throw new Error("This Android build does not support Google Play purchase restoration.");
  }

  const purchases = await iap.getAvailablePurchases();
  const candidates = (Array.isArray(purchases) ? purchases : [])
    .filter((purchase) => CAPDENT_GOOGLE_PLAY_PRODUCTS.has(purchaseProductId(purchase)))
    .sort((left, right) => purchaseTime(right) - purchaseTime(left));

  if (!candidates.length) {
    return {
      found: false,
      activated: false,
      checked: 0,
      productId: null,
      plan: "free",
      planLabel: "Free",
      googleState: null,
      expiryTime: null,
      autoRenewing: false,
      subscription: null,
      message:
        "No CapDent subscription was found for the Google Play account currently signed in on this device.",
    };
  }

  let latestResult: GooglePlayRecoveryResult | null = null;
  let latestError: unknown = null;

  for (const purchase of candidates) {
    try {
      const result = await verifyGooglePlayPurchaseState(purchase);
      latestResult = { ...result, checked: candidates.length };

      if (result.activated) {
        await finishGooglePlaySubscriptionPurchase(purchase);
        return latestResult;
      }
    } catch (error) {
      latestError = error;
    }
  }

  if (latestResult) return latestResult;

  throw latestError instanceof Error
    ? latestError
    : new Error("Google Play purchases were found, but CapDent could not verify them.");
}

export async function recheckLinkedGooglePlaySubscription(input: {
  productId?: string | null;
  purchaseToken?: string | null;
  orderId?: string | null;
}) {
  const productId = String(input.productId || "").trim();
  const purchaseToken = String(input.purchaseToken || "").trim();

  if (!productId || !purchaseToken) {
    throw new Error("No linked Google Play purchase is stored for this clinic. Use Restore Purchase instead.");
  }

  return verifyGooglePlayPurchaseState({
    productId,
    purchaseToken,
    orderId: input.orderId || null,
  });
}
