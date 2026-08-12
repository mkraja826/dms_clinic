import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { getDashboardPath } from "@/lib/supabase";

export default function LegalAccountScreen() {
  const { profile, signOut } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const homePath = getDashboardPath(profile?.role ?? "receptionist");
  const canManageSubscription =
    profile?.role === "head_doctor" || profile?.role === "owner";

  async function logout() {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut();
    } catch (error) {
      Alert.alert(
        "Logout failed",
        error instanceof Error ? error.message : "Please try again."
      );
      setLoggingOut(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <SectionCard
        title="Legal & Account"
        subtitle="Privacy, terms, support, clinic settings, and account deletion."
      >
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            CapDent Play Store compliance
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Access clinic settings, privacy information, terms, account/data
            deletion, and support.
          </Text>
        </View>
      </SectionCard>

      <AppButton
        title="CapDent Guide"
        variant="secondary"
        icon="book-outline"
        onPress={() => router.push("/settings/guide" as never)}
      />

      {canManageSubscription ? (
        <AppButton
          title="Subscription Plans"
          variant="secondary"
          icon="card-outline"
          onPress={() => router.push("/settings/subscription" as never)}
        />
      ) : null}

      {canManageSubscription ? (
        <AppButton
          title="Clinic Settings"
          variant="secondary"
          icon="options-outline"
          onPress={() => router.push("/settings/account" as never)}
        />
      ) : null}

      <AppButton
        title="Report Issue / Support"
        variant="secondary"
        icon="help-circle-outline"
        onPress={() => router.push("/settings/report-issue" as never)}
      />

      <AppButton
        title="Privacy Help"
        variant="secondary"
        icon="shield-checkmark-outline"
        onPress={() => router.push("/settings/privacy" as never)}
      />

      <AppButton
        title="Terms & Conditions"
        variant="secondary"
        icon="document-text-outline"
        onPress={() => router.push("/settings/terms" as never)}
      />

      <AppButton
        title="Logout"
        variant="secondary"
        icon="log-out-outline"
        onPress={logout}
        loading={loggingOut}
        loadingTitle="Logging out..."
      />

      <AppButton
        title="Delete Account & Data"
        variant="danger"
        icon="trash-outline"
        onPress={() => router.push("/settings/delete-account" as never)}
      />

      <AppButton
        title="Back to Dashboard"
        variant="secondary"
        icon="arrow-back-outline"
        onPress={() => router.replace(homePath as never)}
      />
    </ScrollView>
  );
}
