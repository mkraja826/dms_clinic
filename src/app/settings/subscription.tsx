import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  addGooglePlayPurchaseListeners,
  endGooglePlayBilling,
  finishGooglePlaySubscriptionPurchase,
  getGooglePlayPurchaseToken,
  GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID,
  GOOGLE_PLAY_PLAN_DETAILS,
  GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID,
  googlePlayBillingUnavailableReason,
  GooglePlayBillingPlan,
  GooglePlayPlanKey,
  launchGooglePlaySubscriptionPurchase,
  loadGooglePlayBillingPlans,
  recordGooglePlaySubscriptionPurchase,
} from "@/lib/googlePlayBilling";
import { useAuth } from "@/lib/auth";
import {
  getCapDentEntitlementsV25,
  type CapDentEntitlementsV25,
} from "@/lib/pricingV25";
import { getDashboardPath } from "@/lib/supabase";
import {
  getClinicPlanLabel,
  getClinicPlanName,
  getClinicSubscription,
  getSubscriptionAccess,
  getSubscriptionDisplay,
  hasGooglePlayAutopay,
} from "@/lib/subscription";
import type { ClinicPlanName, ClinicSubscription } from "@/lib/subscription";
import { CAPDENT_V25_LIMITS, formatStorageBytes } from "@/lib/v25Limits";

const RUPEE = "\u20B9";
const PAID_PLANS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true";
const PAID_PLAN_ORDER: GooglePlayPlanKey[] = ["professional", "clinic_intelligence"];
const FREE_PATIENT_LIMIT = CAPDENT_V25_LIMITS.free.patientLimit;

function money(value: number) {
  return `${RUPEE}${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function usageText(count: number, limit: number | null, unit: string) {
  if (limit === null) return `${count.toLocaleString("en-IN")} ${unit} • Unlimited`;
  return `${count.toLocaleString("en-IN")} / ${limit.toLocaleString("en-IN")} ${unit}`;
}

function FeatureRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 13,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

function currentBadgeTone(isCurrent: boolean, planKey: GooglePlayPlanKey) {
  if (isCurrent) return "success" as const;
  return planKey === "clinic_intelligence" ? ("warning" as const) : ("primary" as const);
}

function FreePlanCard({ currentPlan }: { currentPlan: ClinicPlanName }) {
  const isCurrent = currentPlan === "free";

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: isCurrent ? colors.primary : colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 17,
            backgroundColor: colors.successSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>Free</Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 20 }}>
            Up to {FREE_PATIENT_LIMIT} patients and 1 GB storage for one clinic.
          </Text>
        </View>
        <StatusBadge label={isCurrent ? "Current" : "Included"} tone={isCurrent ? "success" : "primary"} />
      </View>

      <Text style={{ color: colors.text, fontSize: 26, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
        Free
      </Text>
    </View>
  );
}

function GooglePlayPlanCard({
  planKey,
  plan,
  isCurrent,
  loading,
  onPress,
}: {
  planKey: GooglePlayPlanKey;
  plan: GooglePlayBillingPlan | null;
  isCurrent: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const details = GOOGLE_PLAY_PLAN_DETAILS[planKey];
  const isIntelligence = planKey === "clinic_intelligence";
  const price = plan?.displayPrice || `${money(details.monthlyAmount)}/month`;
  const disabled = isCurrent || loading || Platform.OS !== "android";
  const renewalText = plan?.trialText
    ? `${plan.trialText}. Google Play handles monthly renewal and cancellation.`
    : "Monthly auto-renewal through Google Play. The owner can cancel anytime in Play Store.";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isCurrent ? `${details.name}, current plan` : `Subscribe to ${details.name}`}
      accessibilityState={{ disabled, busy: loading }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 22,
        padding: 16,
        gap: 14,
        borderWidth: 1,
        borderColor: isCurrent ? colors.success : isIntelligence ? colors.warning : colors.primary,
        backgroundColor: isIntelligence ? colors.warningSoft : colors.primarySoft,
        opacity: disabled ? 0.85 : pressed ? 0.78 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            backgroundColor: isIntelligence ? colors.warning : colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={isIntelligence ? "analytics-outline" : "logo-google-playstore"} size={25} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
            {plan?.title || details.name}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 20 }}>
            {plan?.description || details.description}
          </Text>
        </View>
        <StatusBadge label={isCurrent ? "Current" : details.badge} tone={currentBadgeTone(isCurrent, planKey)} />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
          {price}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>{renewalText}</Text>
      </View>

      <AppButton
        title={isCurrent ? "Current Plan" : `Subscribe ${getClinicPlanLabel(planKey)}`}
        icon={isCurrent ? "checkmark-circle-outline" : "logo-google-playstore"}
        onPress={onPress}
        loading={loading}
        loadingTitle="Opening Google Play..."
        disabled={disabled}
      />
    </Pressable>
  );
}

export default function SubscriptionScreen() {
  const params = useLocalSearchParams<{ locked?: string }>();
  const { profile } = useAuth();
  const [subscription, setSubscription] = useState<ClinicSubscription | null>(null);
  const [entitlements, setEntitlements] = useState<CapDentEntitlementsV25 | null>(null);
  const [billingPlans, setBillingPlans] = useState<GooglePlayBillingPlan[]>([]);
  const [billingError, setBillingError] = useState<string | null>(
    PAID_PLANS_ENABLED ? googlePlayBillingUnavailableReason() : null
  );
  const [loading, setLoading] = useState(true);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [startingPlan, setStartingPlan] = useState<GooglePlayPlanKey | null>(null);
  const processingPurchaseKeysRef = useRef(new Set<string>());

  const locked = params.locked === "1";
  const effectiveSubscription = PAID_PLANS_ENABLED ? subscription : null;
  const subscriptionInfo = getSubscriptionDisplay(effectiveSubscription);
  const access = getSubscriptionAccess(effectiveSubscription);
  const currentPlan = getClinicPlanName(effectiveSubscription);
  const googlePlayLinked = hasGooglePlayAutopay(effectiveSubscription);
  const currentProductId = googlePlayLinked ? subscription?.google_play_product_id || null : null;
  const paidPlanActive =
    currentPlan !== "free" &&
    googlePlayLinked &&
    (subscription?.status === "active" || subscription?.status === "grace_period") &&
    subscription?.google_play_status !== "cancelled" &&
    subscription?.google_play_status !== "expired" &&
    subscription?.google_play_status !== "account_hold";

  async function load() {
    try {
      setLoading(true);
      if (!PAID_PLANS_ENABLED) {
        setSubscription(null);
        return;
      }
      setSubscription(await getClinicSubscription());
    } catch (error) {
      Alert.alert("Subscription load failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEntitlements() {
    try {
      setEntitlements(await getCapDentEntitlementsV25());
    } catch (error) {
      console.warn("Clinic usage load failed:", error);
    }
  }

  async function loadBillingPlans(options?: { throwOnError?: boolean }) {
    if (!PAID_PLANS_ENABLED) {
      setBillingPlans([]);
      setBillingError(null);
      return [] as GooglePlayBillingPlan[];
    }

    if (Platform.OS !== "android") {
      setBillingError("Google Play Billing works only inside the Android app installed from Play testing or production.");
      return [] as GooglePlayBillingPlan[];
    }

    try {
      setLoadingBilling(true);
      setBillingError(null);
      const plans = await loadGooglePlayBillingPlans();
      setBillingPlans(plans);

      const foundIds = new Set(plans.map((plan) => plan.productId));
      const missing = [GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID, GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID].filter(
        (productId) => !foundIds.has(productId)
      );
      if (missing.length) {
        setBillingError(`Google Play product not found or inactive: ${missing.join(", ")}.`);
      }

      return plans;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google Play Billing could not load subscription plans.";
      setBillingError(message);
      if (options?.throwOnError) {
        throw error instanceof Error ? error : new Error(message);
      }
      return [] as GooglePlayBillingPlan[];
    } finally {
      setLoadingBilling(false);
    }
  }

  useEffect(() => {
    load();
    void loadEntitlements();
  }, [profile?.clinic_id]);

  useEffect(() => {
    if (!PAID_PLANS_ENABLED) {
      setBillingPlans([]);
      setBillingError(null);
      return;
    }

    let active = true;
    loadBillingPlans();

    const cleanup = addGooglePlayPurchaseListeners({
      onPurchase: async (purchase) => {
        const purchaseKey =
          getGooglePlayPurchaseToken(purchase) ||
          String(purchase?.transactionId || purchase?.orderId || purchase?.productId || "unknown-purchase");
        if (!active || processingPurchaseKeysRef.current.has(purchaseKey)) return;
        processingPurchaseKeysRef.current.add(purchaseKey);

        try {
          const updatedSubscription = (await recordGooglePlaySubscriptionPurchase(purchase)) as ClinicSubscription;
          await finishGooglePlaySubscriptionPurchase(purchase);
          if (!active) return;

          setSubscription(updatedSubscription);
          await load();
          await loadEntitlements();
          if (!active) return;

          const planLabel = getClinicPlanLabel(getClinicPlanName(updatedSubscription));
          Alert.alert(
            `${planLabel} active`,
            `CapDent ${planLabel} was verified by Google Play and activated. Core Free access remains available if the owner cancels.`
          );
        } catch (error) {
          if (active) {
            Alert.alert("Subscription verification failed", error instanceof Error ? error.message : "Please try again.");
          }
        } finally {
          processingPurchaseKeysRef.current.delete(purchaseKey);
          if (active) setStartingPlan(null);
        }
      },
      onError: (message) => {
        if (!active) return;
        setStartingPlan(null);
        Alert.alert("Google Play Billing", message);
      },
    });

    return () => {
      active = false;
      cleanup();
      endGooglePlayBilling();
    };
  }, [profile?.clinic_id]);

  function goDashboard() {
    if (profile?.role) {
      router.replace(getDashboardPath(profile.role) as never);
      return;
    }
    router.replace("/" as never);
  }

  async function startGooglePlaySubscription(planKey: GooglePlayPlanKey) {
    if (!PAID_PLANS_ENABLED) {
      Alert.alert("Paid plans disabled", "Paid plans are not enabled in this CapDent release.");
      return;
    }

    try {
      setStartingPlan(planKey);
      let plans = billingPlans;
      if (!plans.length) plans = await loadBillingPlans({ throwOnError: true });

      const plan = plans.find((item) => item.key === planKey);
      if (!plan) {
        throw new Error(`Google Play product ${GOOGLE_PLAY_PLAN_DETAILS[planKey].productId} was not returned.`);
      }

      await launchGooglePlaySubscriptionPurchase(plan, { currentProductId });
    } catch (error) {
      setStartingPlan(null);
      Alert.alert("Google Play subscription failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function planFor(key: GooglePlayPlanKey) {
    return billingPlans.find((plan) => plan.key === key) || null;
  }

  async function openGooglePlaySubscriptions() {
    if (Platform.OS !== "android") {
      Alert.alert("Google Play", "Open Google Play Store > Payments & subscriptions > Subscriptions to manage this plan.");
      return;
    }

    try {
      await Linking.openURL("https://play.google.com/store/account/subscriptions");
    } catch {
      Alert.alert("Google Play", "Open Google Play Store > Payments & subscriptions > Subscriptions to manage this plan.");
    }
  }

  return (
    <Screen
      refreshing={loading || (PAID_PLANS_ENABLED && loadingBilling)}
      onRefresh={() => {
        load();
        void loadEntitlements();
        if (PAID_PLANS_ENABLED) loadBillingPlans();
      }}
    >
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          {PAID_PLANS_ENABLED && paidPlanActive ? "Subscription" : "Free Access"}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          {!PAID_PLANS_ENABLED
            ? "CapDent is currently free for all clinics. Paid plans will appear only after official store subscriptions are enabled."
            : paidPlanActive
              ? "Your verified paid plan is active. Manage renewal or cancellation through Google Play."
              : "Start on Free, grow with Cloud, and understand the clinic deeply with Intelligence."}
        </Text>
      </View>

      {locked || access.blocked ? (
        <SectionCard title="Clinic Access" subtitle="Core clinic access remains available on the Free plan.">
          <View
            style={{
              borderRadius: 22,
              padding: 14,
              backgroundColor: colors.warningSoft,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 10,
            }}
          >
            <StatusBadge label={access.statusLabel} tone="warning" />
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 18 }}>{subscriptionInfo.title}</Text>
            <Text style={{ color: colors.muted, lineHeight: 21 }}>{access.reason}</Text>
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Current Plan" subtitle="Live status from clinic subscription settings.">
        <View
          style={{
            borderRadius: 22,
            padding: 16,
            gap: 14,
            backgroundColor: subscriptionInfo.tone === "warning" ? colors.warningSoft : colors.successSoft,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                backgroundColor: colors.white,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={googlePlayLinked ? "logo-google-playstore" : "shield-checkmark-outline"}
                size={25}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
                {loading ? "Checking plan..." : subscriptionInfo.title}
              </Text>
              <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 20 }}>
                {loading ? "Loading subscription status." : subscriptionInfo.subtitle}
              </Text>
            </View>
            <StatusBadge label={access.statusLabel} tone={subscriptionInfo.tone} />
          </View>
        </View>
      </SectionCard>

      {entitlements ? (
        <SectionCard
          title="Clinic Usage"
          subtitle="Live patient, upload, and storage capacity for this clinic."
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <StatusBadge label={`${entitlements.planLabel} plan`} />
            <StatusBadge
              label={entitlements.canAddPatient ? "Patient capacity available" : "Patient limit reached"}
              tone={entitlements.canAddPatient ? "success" : "warning"}
            />
            <StatusBadge
              label={entitlements.canUpload ? "Uploads available" : "Upload capacity reached"}
              tone={entitlements.canUpload ? "success" : "warning"}
            />
          </View>

          <FeatureRow
            icon="people-outline"
            label={usageText(entitlements.patientCount, entitlements.patientLimit, "patients")}
          />
          <FeatureRow
            icon="cloud-upload-outline"
            label={usageText(entitlements.uploadCount, entitlements.uploadLimit, "uploads")}
          />
          <FeatureRow
            icon="server-outline"
            label={`${formatStorageBytes(entitlements.storageUsedBytes)} used of ${formatStorageBytes(entitlements.storageLimitBytes)} storage`}
          />

          {(!entitlements.canAddPatient || !entitlements.canUpload) ? (
            <View
              style={{
                borderRadius: 18,
                padding: 12,
                backgroundColor: colors.warningSoft,
                borderWidth: 1,
                borderColor: colors.border,
                gap: 6,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>Capacity action needed</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Existing clinic records remain available. Choose a higher plan below to add more patients or clinical files when the server limit is enforced.
              </Text>
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      {!PAID_PLANS_ENABLED ? (
        <SectionCard title="Free Access" subtitle="No subscription is required for this release.">
          <FreePlanCard currentPlan="free" />
          <FeatureRow
            icon="shield-checkmark-outline"
            label="Core patient, visit, payment, appointment, report, and staff workflows remain available."
          />
          <FeatureRow
            icon="cloud-outline"
            label="Paid-plan code is preserved behind a disabled release flag and cannot start checkout in this build."
          />
        </SectionCard>
      ) : paidPlanActive ? (
        <SectionCard title="Manage Plan" subtitle="Paid access is active and verified through Google Play.">
          <FeatureRow
            icon="checkmark-circle-outline"
            label={`${getClinicPlanLabel(currentPlan)} is active through Google Play.`}
          />
          <FeatureRow
            icon="logo-google-playstore"
            label="Manage renewal or cancellation in Play Store. Core Free access remains after paid access ends."
          />
          <AppButton
            title="Manage Plan in Play Store"
            icon="logo-google-playstore"
            variant="secondary"
            onPress={openGooglePlaySubscriptions}
          />
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Plan Map" subtitle="What each level provides inside CapDent.">
            <FeatureRow
              icon="shield-checkmark-outline"
              label={`Free: up to ${FREE_PATIENT_LIMIT} patients, 1 GB storage, one clinic, and core clinic management.`}
            />
            <FeatureRow
              icon="cloud-outline"
              label={`Cloud: ${money(GOOGLE_PLAY_PLAN_DETAILS.professional.monthlyAmount)}/month, 5 GB storage, unlimited patient records, backup and sync for one clinic.`}
            />
            <FeatureRow
              icon="analytics-outline"
              label={`Intelligence: ${money(GOOGLE_PLAY_PLAN_DETAILS.clinic_intelligence.monthlyAmount)}/month, 20 GB storage, advanced analytics, and up to 3 clinics.`}
            />
          </SectionCard>

          <SectionCard title="Choose Plan" subtitle="Prices and available offers are loaded directly from Google Play.">
            <FreePlanCard currentPlan={currentPlan} />

            {PAID_PLAN_ORDER.map((planKey) => (
              <GooglePlayPlanCard
                key={planKey}
                planKey={planKey}
                plan={planFor(planKey)}
                isCurrent={currentPlan === planKey && googlePlayLinked}
                loading={startingPlan === planKey}
                onPress={() => startGooglePlaySubscription(planKey)}
              />
            ))}

            {billingError ? (
              <View
                style={{
                  padding: 14,
                  borderRadius: 20,
                  backgroundColor: colors.warningSoft,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="information-circle-outline" size={22} color={colors.warning} />
                  <Text style={{ flex: 1, color: colors.text, fontWeight: "900" }}>Google Play setup needed</Text>
                </View>
                <Text style={{ color: colors.muted, lineHeight: 20 }}>{billingError}</Text>
              </View>
            ) : null}
          </SectionCard>
        </>
      )}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="Dashboard"
          icon="home-outline"
          variant="secondary"
          onPress={goDashboard}
          loading={loading}
          style={{ flex: 1 }}
        />
        {PAID_PLANS_ENABLED && !paidPlanActive ? (
          <AppButton
            title="Reload Billing"
            icon="refresh-circle-outline"
            variant="ghost"
            onPress={loadBillingPlans}
            loading={loadingBilling}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
    </Screen>
  );
}
