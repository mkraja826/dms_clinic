import { Platform } from "react-native";
import { getCurrentProfile, invalidateSupabaseCache, supabase } from "@/lib/supabase";

const RUPEE = "\u20B9";
let googlePlayPurchaseLaunchInFlight = false;

export type GooglePlayPlanKey = "professional" | "clinic_intelligence";

export const GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_PRODUCT_ID ||
  "midms_monthly_799";
export const GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID || "midms_clinic_intelligence_monthly";
export const GOOGLE_PLAY_PROFESSIONAL_TRIAL_OFFER_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PROFESSIONAL_TRIAL_OFFER_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_TRIAL_OFFER_ID ||
  "three-month-free-trial";

// Backward-compatible alias for existing imports and env names.
export const GOOGLE_PLAY_MONTHLY_PRODUCT_ID = GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID;

export const GOOGLE_PLAY_PRODUCT_IDS = [
  GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID,
  GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID,
] as const;

export const GOOGLE_PLAY_PLAN_DETAILS: Record<
  GooglePlayPlanKey,
  {
    name: string;
    productId: string;
    monthlyAmount: number;
    description: string;
    badge: string;
  }
> = {
  professional: {
    name: "CapDent Cloud",
    productId: GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID,
    monthlyAmount: 799,
    description: "5 GB secure cloud storage, unlimited patient records, backup and sync for one clinic.",
    badge: "Popular",
  },
  clinic_intelligence: {
    name: "CapDent Intelligence",
    productId: GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID,
    monthlyAmount: 1499,
    description: "20 GB cloud storage, advanced analytics, business insights, and management for up to 3 clinics.",
    badge: "Analytics",
  },
};

export type GooglePlayBillingPlan = {
  key: GooglePlayPlanKey;
  productId: string;
  title: string;
  description: string;
  displayPrice: string;
  trialText: string | null;
  hasTrialOffer: boolean;
  offerToken: string | null;
  basePlanId: string | null;
  offerId: string | null;
  rawProduct: any;
};

function getIapModule() {
  try {
    return require("react-native-iap");
  } catch {
    return null;
  }
}

function isAndroid() {
  return Platform.OS === "android";
}

export function googlePlayBillingUnavailableReason() {
  if (!isAndroid()) return "Google Play Billing is available only inside the Android app.";
  if (!getIapModule()) return "Google Play Billing package is not installed yet. Run npm install and rebuild the Android app.";
  return null;
}

export async function initGooglePlayBilling() {
  const reason = googlePlayBillingUnavailableReason();
  if (reason) throw new Error(reason);

  const iap = getIapModule();
  await iap.initConnection();

  if (typeof iap.flushFailedPurchasesCachedAsPendingAndroid === "function") {
    await iap.flushFailedPurchasesCachedAsPendingAndroid().catch(() => undefined);
  }
}

export async function endGooglePlayBilling() {
  const iap = getIapModule();
  if (!iap?.endConnection) return;
  await iap.endConnection().catch(() => undefined);
}

async function getSubscriptionsCompat(skus: string[]) {
  const iap = getIapModule();
  if (!iap) throw new Error("Google Play Billing is not available.");

  // react-native-iap 14 uses the OpenIAP fetchProducts API. Keep the legacy
  // fallback so older native builds can still load subscriptions safely.
  if (typeof iap.fetchProducts === "function") {
    const products = await iap.fetchProducts({ skus, type: "subs" });
    return Array.isArray(products) ? products : [];
  }

  if (typeof iap.getSubscriptions !== "function") {
    throw new Error("This build does not include a compatible Google Play Billing product API.");
  }

  try {
    return await iap.getSubscriptions({ skus });
  } catch {
    return await iap.getSubscriptions(skus);
  }
}

function planKeyForProductId(productId: string): GooglePlayPlanKey | null {
  if (productId === GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID) return "clinic_intelligence";
  if (productId === GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID) return "professional";
  return null;
}

function productIdOf(product: any) {
  return String(product?.productId || product?.id || product?.sku || "");
}

function productOffers(product: any) {
  const modernOffers = product?.subscriptionOffers;
  if (Array.isArray(modernOffers) && modernOffers.length) {
    return modernOffers.map((offer: any) => ({
      offerToken: offer?.offerTokenAndroid || offer?.offerToken || null,
      basePlanId: offer?.basePlanIdAndroid || offer?.basePlanId || null,
      offerId: offer?.id || offer?.offerId || null,
      offerTags: offer?.offerTagsAndroid || offer?.offerTags || offer?.tags || [],
      displayPrice: offer?.displayPrice || null,
      pricingPhases:
        offer?.pricingPhasesAndroid?.pricingPhaseList ||
        offer?.pricingPhasesAndroid ||
        offer?.pricingPhases?.pricingPhaseList ||
        offer?.pricingPhases ||
        [],
      raw: offer,
    }));
  }

  const legacyOffers = product?.subscriptionOfferDetailsAndroid || product?.subscriptionOfferDetails || [];
  if (!Array.isArray(legacyOffers)) return [];

  return legacyOffers.map((offer: any) => ({
    offerToken: offer?.offerToken || null,
    basePlanId: offer?.basePlanId || null,
    offerId: offer?.offerId || null,
    offerTags: offer?.offerTags || offer?.tags || [],
    displayPrice: null,
    pricingPhases: offer?.pricingPhases?.pricingPhaseList || offer?.pricingPhases || [],
    raw: offer,
  }));
}

function phasePriceMicros(phase: any) {
  return Number(phase?.priceAmountMicros || phase?.priceMicros || 0);
}

function phaseIsFree(phase: any) {
  const formatted = String(phase?.formattedPrice || phase?.price || "").toLowerCase();
  return phasePriceMicros(phase) === 0 || formatted.includes("free");
}

function phaseIsMonthly(phase: any) {
  return String(phase?.billingPeriod || phase?.period || "").toUpperCase() === "P1M";
}

function phaseIsThreeMonthFreeTrial(phase: any) {
  const period = String(phase?.billingPeriod || phase?.period || "").toUpperCase();
  return phaseIsFree(phase) && period === "P3M";
}

function offerHasProfessionalTrial(offer: any) {
  const configuredOfferId = GOOGLE_PLAY_PROFESSIONAL_TRIAL_OFFER_ID.toLowerCase();
  const offerId = String(offer?.offerId || "").toLowerCase();
  const tags = Array.isArray(offer?.offerTags) ? offer.offerTags.map((tag: any) => String(tag).toLowerCase()) : [];

  return (
    offerId === configuredOfferId ||
    tags.includes(configuredOfferId) ||
    offer?.pricingPhases?.some((phase: any) => phaseIsThreeMonthFreeTrial(phase))
  );
}

function pickProfessionalTrialOffer(product: any) {
  const offers = productOffers(product);
  if (!offers.length) return null;

  return (
    offers.find((offer) => offerHasProfessionalTrial(offer)) ||
    offers.find((offer) => offer.pricingPhases.some((phase: any) => phaseIsFree(phase))) ||
    null
  );
}

function pickPaidMonthlyOffer(product: any) {
  const offers = productOffers(product);
  if (!offers.length) return null;

  const withoutFree = offers.filter((offer) => !offer.pricingPhases.some((phase: any) => phaseIsFree(phase)));
  const candidates = withoutFree.length ? withoutFree : offers;

  return (
    candidates.find((offer) =>
      offer.pricingPhases.some((phase: any) => phasePriceMicros(phase) > 0 && phaseIsMonthly(phase))
    ) ||
    candidates.find((offer) => offer.offerToken) ||
    candidates[0] ||
    null
  );
}

function pickOfferForPlan(product: any, key: GooglePlayPlanKey) {
  if (key === "professional") {
    return pickProfessionalTrialOffer(product) || pickPaidMonthlyOffer(product);
  }

  return pickPaidMonthlyOffer(product);
}

function displayPriceForProduct(product: any, offer: any, fallbackAmount: number) {
  const phases = offer?.pricingPhases || [];
  const paidMonthlyPhase = phases.find((phase: any) => phasePriceMicros(phase) > 0 && phaseIsMonthly(phase));
  const paidPhase = phases.find((phase: any) => phasePriceMicros(phase) > 0);

  return (
    product?.displayPrice ||
    offer?.displayPrice ||
    paidMonthlyPhase?.formattedPrice ||
    paidMonthlyPhase?.price ||
    paidPhase?.formattedPrice ||
    paidPhase?.price ||
    product?.localizedPrice ||
    product?.price ||
    `${RUPEE}${fallbackAmount.toLocaleString("en-IN")}/month`
  );
}

export async function loadGooglePlayBillingPlans(): Promise<GooglePlayBillingPlan[]> {
  await initGooglePlayBilling();

  const products = await getSubscriptionsCompat([...GOOGLE_PLAY_PRODUCT_IDS]);
  if (!Array.isArray(products)) return [];

  return products
    .map((product) => {
      const productId = productIdOf(product);
      const key = planKeyForProductId(productId);
      if (!key) return null;

      const details = GOOGLE_PLAY_PLAN_DETAILS[key];
      const offer = pickOfferForPlan(product, key);
      const hasTrialOffer = key === "professional" && Boolean(offer && offerHasProfessionalTrial(offer));

      return {
        key,
        productId,
        title: String(product.title || product.displayName || product.name || details.name),
        description: String(product.description || details.description),
        displayPrice: displayPriceForProduct(product, offer, details.monthlyAmount),
        trialText: hasTrialOffer ? "3 months free, then auto-renews monthly" : null,
        hasTrialOffer,
        offerToken: offer?.offerToken || null,
        basePlanId: offer?.basePlanId || null,
        offerId: offer?.offerId || null,
        rawProduct: product,
      };
    })
    .filter(Boolean) as GooglePlayBillingPlan[];
}

export async function loadGooglePlayBillingOffer(): Promise<GooglePlayBillingPlan | null> {
  const plans = await loadGooglePlayBillingPlans();
  return plans.find((plan) => plan.key === "professional") || plans[0] || null;
}

export async function launchGooglePlaySubscriptionPurchase(
  plan: GooglePlayBillingPlan,
  options?: { currentProductId?: string | null }
) {
  if (googlePlayPurchaseLaunchInFlight) {
    throw new Error("A Google Play purchase is already being opened. Please complete or cancel it first.");
  }

  googlePlayPurchaseLaunchInFlight = true;

  try {
    await initGooglePlayBilling();

    const iap = getIapModule();
    const subscriptionOffers = plan.offerToken ? [{ sku: plan.productId, offerToken: plan.offerToken }] : [];
    const replacementParams =
      options?.currentProductId && options.currentProductId !== plan.productId
        ? {
            oldProductId: options.currentProductId,
            replacementMode: "charge-prorated-price",
          }
        : undefined;

    if (iap?.requestPurchase) {
      return await iap.requestPurchase({
        type: "subs",
        request: {
          google: {
            skus: [plan.productId],
            subscriptionOffers,
            subscriptionProductReplacementParams: replacementParams,
          },
        },
      });
    }

    if (!iap?.requestSubscription) throw new Error("Google Play subscription billing is not available.");

    if (plan.offerToken) {
      return await iap.requestSubscription({
        sku: plan.productId,
        subscriptionOffers,
      });
    }

    return await iap.requestSubscription({ sku: plan.productId });
  } finally {
    googlePlayPurchaseLaunchInFlight = false;
  }
}

export function addGooglePlayPurchaseListeners(input: {
  onPurchase: (purchase: any) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const iap = getIapModule();
  if (!iap?.purchaseUpdatedListener || !iap?.purchaseErrorListener) return () => undefined;

  const purchaseSub = iap.purchaseUpdatedListener((purchase: any) => {
    Promise.resolve(input.onPurchase(purchase)).catch((error) => {
      input.onError(
        error instanceof Error
          ? error.message
          : "Unable to complete Google Play purchase verification."
      );
    });
  });

  const errorSub = iap.purchaseErrorListener((error: any) => {
    const code = error?.code ? `${error.code}: ` : "";
    input.onError(`${code}${error?.message || "Google Play purchase failed."}`);
  });

  return () => {
    purchaseSub?.remove?.();
    errorSub?.remove?.();
  };
}

export function getGooglePlayPurchaseToken(purchase: any) {
  if (purchase?.purchaseToken) return String(purchase.purchaseToken);

  try {
    const parsed = JSON.parse(String(purchase?.transactionReceipt || "{}"));
    return parsed?.purchaseToken ? String(parsed.purchaseToken) : null;
  } catch {
    return null;
  }
}

export async function recordGooglePlaySubscriptionPurchase(purchase: any) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const purchaseToken = getGooglePlayPurchaseToken(purchase);
  if (!purchaseToken) throw new Error("Google Play purchase token was not returned.");

  const productId = String(
    purchase?.productId ||
      purchase?.id ||
      (Array.isArray(purchase?.productIds) ? purchase.productIds[0] : "") ||
      ""
  ).trim();

  if (!productId) {
    throw new Error("Google Play purchase product ID was not returned.");
  }
  if (!planKeyForProductId(productId)) {
    throw new Error("Google Play returned an unrecognized CapDent subscription product.");
  }

  const { data, error } = await supabase.functions.invoke("verify-google-play-subscription", {
    body: {
      product_id: productId,
      purchase_token: purchaseToken,
      order_id: purchase?.orderId || purchase?.transactionId || null,
    },
  });

  if (error) throw error;
  if (!data?.verified || !data?.activated || !data?.subscription) {
    throw new Error(data?.message || "Google Play has not verified paid access. CapDent remains on the Free plan.");
  }

  invalidateSupabaseCache();
  return data.subscription;
}

export async function finishGooglePlaySubscriptionPurchase(purchase: any) {
  const iap = getIapModule();
  if (!iap?.finishTransaction) return;

  try {
    await iap.finishTransaction({ purchase, isConsumable: false });
  } catch {
    await iap.finishTransaction(purchase, false).catch(() => undefined);
  }
}
