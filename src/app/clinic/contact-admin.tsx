import { router } from "expo-router";
import { Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

export default function ContactAdminScreen() {
  const { profile, signOut } = useAuth();
  const logoutMutation = useImmediateMutationLock();

  async function logout() {
    if (!logoutMutation.tryLock()) return;

    try {
      await signOut();
    } finally {
      logoutMutation.release();
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Clinic Access Needed
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          This staff account is active, but not connected to any clinic workspace yet.
        </Text>
      </View>

      <SectionCard title="Contact Owner" subtitle="Ask clinic owner or head doctor for the correct invite code.">
        <Text selectable style={{ color: colors.muted, lineHeight: 21 }}>
          Ask the clinic owner or head doctor to create/share a fresh staff invite code. Then enter that code from onboarding.
        </Text>
        <Text selectable style={{ color: colors.muted, lineHeight: 21 }}>
          Account: {profile?.email || "current user"}
        </Text>
        <AppButton title="Enter Staff Invite Code" icon="key-outline" onPress={() => router.replace("/onboarding" as never)} />
      </SectionCard>

      <AppButton title="Logout" icon="log-out-outline" variant="ghost" onPress={logout} />
    </Screen>
  );
}
