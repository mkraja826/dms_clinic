import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { endGooglePlayBilling } from "@/lib/googlePlayBilling";
import { restoreGooglePlaySubscription } from "@/lib/googlePlayRestore";
import {
  getClinicPlanLabel,
  getClinicPlanName,
  getClinicSubscription,
  type ClinicSubscription,
} from "@/lib/subscription";

export default function RestoreSubscriptionScreen() {
  const { profile } = useAuth();
  const [subscription, setSubscription] = useState<ClinicSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setSubscription(await getClinicSubscription());
    } catch (error) {
      Alert.alert(
        "Subscription status unavailable",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      void endGooglePlayBilling();
    };
  }, [profile?.clinic_id]);

  async function restore() {
    if (Platform.OS !== "android") {
      Alert.alert("Google Play", "Subscription recovery is available in the Android app.");
      return;
    }

    try {
      setRestoring(true);
      const result = await restoreGooglePlaySubscription();
      if (result.status === "none") {
        Alert.alert(
          "No subscription found",
          "Google Play did not return an active CapDent subscription for this account. Core Free access remains available."
        );
        return;
      }

      setSubscription(result.subscription);
      const plan = getClinicPlanName(result.subscription);
      Alert.alert(
        "Subscription restored",
        `${getClinicPlanLabel(plan)} was verified with the CapDent server and restored for this clinic.`
      );
    } catch (error) {
      Alert.alert(
        "Restore could not be verified",
        error instanceof Error
          ? error.message
          : "Google Play recovery could not be verified. CapDent has not changed paid access."
      );
    } finally {
      setRestoring(false);
      await load();
    }
  }

  const plan = getClinicPlanName(subscription);
  const paid = plan !== "free";

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 29, fontWeight: "900" }}>
          Restore Subscription
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Recover a previously purchased CapDent plan after reinstalling the app or moving to another Android device.
        </Text>
      </View>

      <SectionCard title="Current clinic access" subtitle="Paid access is accepted only after server verification.">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 17,
              backgroundColor: paid ? colors.successSoft : colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={paid ? "checkmark-circle-outline" : "shield-checkmark-outline"}
              size={24}
              color={paid ? colors.success : colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
              {loading ? "Checking…" : getClinicPlanLabel(plan)}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
              {subscription?.status ? `Server status: ${subscription.status}` : "Core Free access is available."}
            </Text>
          </View>
          <StatusBadge label={paid ? "Verified" : "Free"} tone={paid ? "success" : "primary"} />
        </View>
      </SectionCard>

      <SectionCard
        title="Google Play recovery"
        subtitle="CapDent checks purchases owned by the signed-in Play account, then sends the purchase token to the existing server verifier before restoring access."
      >
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          Restoring cannot activate a plan from local device data alone. If Google Play or the CapDent verification service cannot confirm the subscription, the clinic remains on its current safe access level.
        </Text>
        <AppButton
          title="Restore Google Play Purchase"
          icon="logo-google-playstore"
          onPress={() => void restore()}
          loading={restoring}
          loadingTitle="Verifying Play purchase…"
        />
      </SectionCard>

      <View style={{ gap: 10 }}>
        <AppButton
          title="View Plans"
          icon="card-outline"
          variant="secondary"
          onPress={() => router.replace("/settings/subscription" as never)}
        />
        <AppButton
          title="Back"
          icon="arrow-back-outline"
          variant="ghost"
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}
