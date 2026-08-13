import { router } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

export default function ForgotPasswordScreen() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const resetMutation = useImmediateMutationLock();

  async function submit() {
    if (!email.trim()) {
      Alert.alert("Email required", "Enter your registered email.");
      return;
    }

    if (loading || !resetMutation.tryLock()) return;

    setLoading(true);
    try {
      await resetPassword(email);
      router.replace("/login" as never);
    } catch {
      Alert.alert("Check your email", "If this email is registered, reset link will be sent.");
    } finally {
      resetMutation.release();
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Forgot Password
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Enter the email used for CapDent. The message is kept private for clinic security.
        </Text>
      </View>

      <SectionCard title="Password Recovery">
        <AppInput
          label="Registered email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="doctor@clinic.com"
        />

        <AppButton
          title="Send Reset Link"
          icon="mail-outline"
          onPress={submit}
          loading={loading}
        />
      </SectionCard>

      <AppButton
        title="Back to Login"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.replace("/login" as never)}
      />
    </Screen>
  );
}
