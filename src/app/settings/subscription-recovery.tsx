import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Platform, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  googlePlayBillingUnavailableReason,
} from "@/lib/googlePlayBilling";
import {
  recheckLinkedGooglePlaySubscription,
  restoreGooglePlaySubscription,
} from "@/lib/googlePlayRecovery";
import {
  formatSubscriptionDateTime,
  getClinicPlanLabel,
  getClinicPlanName,
  getClinicSubscription,
  getSubscriptionDisplay,
  googlePlayBillingStatusLabel,
  type ClinicSubscription,
} from "@/lib/subscription";

const PAID_PLANS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_PAID_PLANS === "true";

type RecoveryAction = "restore" | "recheck" | null;

function stateTone(subscription: ClinicSubscription | null) {
  const status = subscription?.google_play_status;
  if (status === "active" || status === "trial_started") return "success" as const;
  if (status === "account_hold" || status === "expired" || status === "cancelled") return "warning" as const;
  if (status === "grace_period" || status === "pending_verification") return "warning" as const;
  return "primary" as const;
}

function stateMessage(subscription: ClinicSubscription | null) {
  const status = subscription?.google_play_status;

  if (!subscription?.google_play_purchase_token) {
    return "No Google Play purchase is linked to this clinic yet. Restore Purchase checks the Google account signed in on this device.";
  }
  if (status === "active") {
    return "Google Play and CapDent agree that paid access is active.";
  }
  if (status === "grace_period") {
    return "Google Play has granted a temporary grace period. Update the payment method in Play Store, then recheck the purchase.";
  }
  if (status === "account_hold") {
    return "Google Play has placed the subscription on account hold. Core Free access continues while the owner fixes payment in Play Store.";
  }
  if (status === "pending_verification") {
    return "The purchase is linked but needs another server verification. Recheck Purchase refreshes the authoritative Google Play state.";
  }
  if (status === "expired") {
    return "The previous paid period has expired. Core Free access remains available; restore or recheck after renewing in Google Play.";
  }
  if (status === "cancelled") {
    return "The previous subscription is cancelled. Core Free access remains available.";
  }

  return "Use Restore Purchase after reinstalling CapDent, changing devices, or signing back in with an existing Google Play subscription.";
}

export default function SubscriptionRecoveryScreen() {
  const [subscription, setSubscription] = useState<ClinicSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<RecoveryAction>(null);

  const billingUnavailable = PAID_PLANS_ENABLED ? googlePlayBillingUnavailableReason() : null;
  const linkedPurchase = Boolean(
    subscription?.google_play_product_id && subscription?.google_play_purchase_token
  );
  const planLabel = getClinicPlanLabel(getClinicPlanName(subscription));
  const display = getSubscriptionDisplay(subscription);
  const googleStatus = googlePlayBillingStatusLabel(subscription?.google_play_status);
  const tone = stateTone(subscription);
  const lastVerified = formatSubscriptionDateTime(subscription?.google_play_last_verified_at);
  const recoveryBlocked = !PAID_PLANS_ENABLED || Platform.OS !== "android" || Boolean(billingUnavailable);

  const actionHelp = useMemo(() => {
    if (!PAID_PLANS_ENABLED) {
      return "Paid plans are disabled in this release, so Google Play recovery is intentionally unavailable.";
    }
    if (Platform.OS !== "android") {
      return "Google Play subscription recovery is available only in the Android app.";
    }
    if (billingUnavailable) return billingUnavailable;
    return "Restore checks purchases owned by the Google account on this device. Recheck uses the purchase already linked to this clinic.";
  }, [billingUnavailable]);

  async function load() {
    try {
      setLoading(true);
      setSubscription(await getClinicSubscription());
    } catch (error) {
      Alert.alert(
        "Billing status load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleRestore() {
    if (recoveryBlocked) {
      Alert.alert("Google Play recovery unavailable", actionHelp);
      return;
    }

    try {
      setAction("restore");
      const result = await restoreGooglePlaySubscription();
      await load();

      if (!result.found) {
        Alert.alert("No purchase found", result.message);
        return;
      }

      Alert.alert(
        result.activated ? `${result.planLabel} restored` : "Purchase status refreshed",
        result.message
      );
    } catch (error) {
      await load();
      Alert.alert(
        "Restore failed",
        error instanceof Error ? error.message : "Google Play purchase restoration failed."
      );
    } finally {
      setAction(null);
    }
  }

  async function handleRecheck() {
    if (recoveryBlocked) {
      Alert.alert("Google Play recovery unavailable", actionHelp);
      return;
    }

    if (!linkedPurchase) {
      Alert.alert(
        "No linked purchase",
        "This clinic does not have a stored Google Play purchase. Use Restore Purchase instead."
      );
      return;
    }

    try {
      setAction("recheck");
      const result = await recheckLinkedGooglePlaySubscription({
        productId: subscription?.google_play_product_id,
        purchaseToken: subscription?.google_play_purchase_token,
        orderId: subscription?.google_play_order_id,
      });
      await load();

      Alert.alert(
        result.activated ? `${result.planLabel} verified` : "Google Play status refreshed",
        result.message
      );
    } catch (error) {
      await load();
      Alert.alert(
        "Recheck failed",
        error instanceof Error ? error.message : "Google Play verification could not be refreshed."
      );
    } finally {
      setAction(null);
    }
  }

  async function openPlaySubscriptions() {
    if (Platform.OS !== "android") {
      Alert.alert(
        "Google Play",
        "Open Google Play Store > Payments & subscriptions > Subscriptions on an Android device."
      );
      return;
    }

    try {
      await Linking.openURL("https://play.google.com/store/account/subscriptions");
    } catch {
      Alert.alert(
        "Google Play",
        "Open Google Play Store > Payments & subscriptions > Subscriptions."
      );
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Billing Recovery
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Recover an existing Google Play subscription safely after reinstall, device change, payment recovery, or a verification mismatch.
        </Text>
      </View>

      <SectionCard title="Current Billing State" subtitle="Server-authoritative clinic subscription status.">
        <View
          style={{
            borderRadius: 22,
            padding: 15,
            gap: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: tone === "success" ? colors.successSoft : tone === "warning" ? colors.warningSoft : colors.surface,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 17,
                backgroundColor: colors.white,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="logo-google-playstore" size={24} color={colors.primary} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
                {loading ? "Checking billing..." : display.title}
              </Text>
              <Text style={{ color: colors.muted, marginTop: 3 }}>
                {loading ? "Loading current plan state." : `${planLabel} • ${googleStatus}`}
              </Text>
            </View>

            <StatusBadge label={googleStatus} tone={tone} />
          </View>

          <Text style={{ color: colors.muted, lineHeight: 20 }}>{stateMessage(subscription)}</Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <StatusBadge label={`Plan: ${planLabel}`} tone={tone} />
            <StatusBadge
              label={subscription?.google_play_auto_renewing ? "Auto-renew on" : "Auto-renew off"}
              tone={subscription?.google_play_auto_renewing ? "success" : "warning"}
            />
          </View>

          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Last verified: {lastVerified}
          </Text>
        </View>
      </SectionCard>

      <SectionCard title="Recovery Actions" subtitle={actionHelp}>
        <AppButton
          title="Restore Purchase"
          icon="cloud-download-outline"
          onPress={handleRestore}
          loading={action === "restore"}
          loadingTitle="Checking Google Play..."
          disabled={Boolean(action) || recoveryBlocked}
        />

        <AppButton
          title="Recheck Linked Purchase"
          icon="refresh-outline"
          variant="secondary"
          onPress={handleRecheck}
          loading={action === "recheck"}
          loadingTitle="Verifying purchase..."
          disabled={Boolean(action) || recoveryBlocked || !linkedPurchase}
        />

        <AppButton
          title="Manage in Google Play"
          icon="logo-google-playstore"
          variant="ghost"
          onPress={openPlaySubscriptions}
        />
      </SectionCard>

      <SectionCard title="What Recovery Does" subtitle="No paid access is granted from device data alone.">
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          CapDent reads purchases owned by the Google account on this device, sends the purchase token to the existing secure server verifier, and only activates paid access when Google Play confirms the entitlement. Expired, cancelled, pending, grace-period, and account-hold states are recorded instead of being treated as active.
        </Text>
      </SectionCard>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="View Plans"
          icon="card-outline"
          variant="secondary"
          onPress={() => router.push("/settings/subscription" as never)}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Back"
          icon="arrow-back-outline"
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(head)/more" as never))}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}
