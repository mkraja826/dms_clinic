import { router } from "expo-router";
import { Alert, ScrollView, Text } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { canManageClinicFeatureSettings } from "@/lib/clinicOptions";

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const canManageClinicSettings = canManageClinicFeatureSettings(profile);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SectionCard title="Clinic Profile">
        <Text selectable style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{profile?.name ?? "Clinic user"}</Text>
        <Text selectable style={{ color: colors.muted }}>{profile?.email}</Text>
        <Text selectable style={{ color: colors.muted }}>Role: {profile?.role}</Text>
        <Text selectable style={{ color: colors.muted }}>Clinic: {profile?.clinic_id}</Text>
      </SectionCard>

      {profile?.role === "owner" ? (
        <AppButton title="Staff Management" onPress={() => router.push("/staff")} />
      ) : null}

      {canManageClinicSettings ? (
        <AppButton
          title="Clinic Feature Settings"
          icon="options-outline"
          variant="secondary"
          onPress={() => router.push("/settings/clinic-features")}
        />
      ) : null}

      <AppButton
        title="Subscription"
        variant="secondary"
        onPress={() => router.push("/settings/subscription")}
      />

      <AppButton
        title="Privacy Help"
        variant="secondary"
        icon="shield-checkmark-outline"
        onPress={() => router.push("/settings/privacy")}
      />

      <AppButton
        title="Terms & Conditions"
        variant="secondary"
        icon="document-text-outline"
        onPress={() => router.push("/settings/terms")}
      />

      <AppButton
        title="Delete Account & Data"
        variant="secondary"
        icon="trash-outline"
        onPress={() => router.push("/settings/delete-account")}
      />

      <AppButton
        title="Change Password"
        variant="secondary"
        onPress={() => router.push("/settings/change-password")}
      />

      <AppButton
        title="Sign out"
        variant="danger"
        onPress={() => signOut().catch((error) => Alert.alert("Sign out failed", error.message))}
      />
    </ScrollView>
  );
}
