import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { getDashboardPath } from "@/lib/supabase";

export default function Index() {
  const { loading, session, profile } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
        }}
      >
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Opening CapDent clinic workspace"
        />
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.muted, fontWeight: "800" }}
        >
          Opening clinic...
        </Text>
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;

  if (!profile) return <Redirect href="/onboarding" />;

  return <Redirect href={getDashboardPath(profile.role) as never} />;
}
