import { Platform } from "react-native";
import {
  GOOGLE_PLAY_PRODUCT_IDS,
  finishGooglePlaySubscriptionPurchase,
  initGooglePlayBilling,
  recordGooglePlaySubscriptionPurchase,
} from "@/lib/googlePlayBilling";
import type { ClinicSubscription } from "@/lib/subscription";

export type GooglePlayRestoreResult =
  | { status: "restored"; subscription: ClinicSubscription; productId: string }
  | { status: "none" };

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
  const raw = purchase?.transactionDate || purchase?.purchaseTime || purchase?.transactionDateAndroid || 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

async function getAvailablePurchasesCompat() {
  const iap = getIapModule();
  if (!iap?.getAvailablePurchases) {
    throw new Error("This build does not include Google Play purchase restore support.");
  }

  try {
    const purchases = await iap.getAvailablePurchases({ onlyIncludeActiveItems: true });
    return Array.isArray(purchases) ? purchases : [];
  } catch {
    const purchases = await iap.getAvailablePurchases();
    return Array.isArray(purchases) ? purchases : [];
  }
}

/**
 * Restores an already-owned CapDent Play subscription after reinstall or
 * device change. A local Play purchase never unlocks the app by itself: each
 * candidate is sent through the same server verification function used by a
 * new purchase before CapDent accepts the restored subscription.
 */
export async function restoreGooglePlaySubscription(): Promise<GooglePlayRestoreResult> {
  if (Platform.OS !== "android") {
    throw new Error("Google Play subscription restore is available only in the Android app.");
  }

  await initGooglePlayBilling();
  const available = await getAvailablePurchasesCompat();
  const allowedProducts = new Set<string>(GOOGLE_PLAY_PRODUCT_IDS);
  const candidates = available
    .filter((purchase: any) => allowedProducts.has(purchaseProductId(purchase)))
    .sort((a: any, b: any) => purchaseTime(b) - purchaseTime(a));

  if (!candidates.length) return { status: "none" };

  let lastError: unknown = null;

  for (const purchase of candidates) {
    try {
      const subscription = (await recordGooglePlaySubscriptionPurchase(
        purchase
      )) as ClinicSubscription;

      // Safe for already-acknowledged purchases and important for a recovered
      // purchase that Play still considers unfinished.
      await finishGooglePlaySubscriptionPurchase(purchase);

      return {
        status: "restored",
        subscription,
        productId: purchaseProductId(purchase),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Google Play found a CapDent subscription, but the server could not verify it.");
}
