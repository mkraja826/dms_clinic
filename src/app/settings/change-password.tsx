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

export default function ChangePasswordScreen() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordMutation = useImmediateMutationLock();

  async function submit() {
    if (!passwordMutation.tryLock()) return;

    if (password.length < 6) {
      passwordMutation.release();
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      passwordMutation.release();
      Alert.alert("Password mismatch", "Enter the same password twice.");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      Alert.alert("Password changed", "Your CapDent password was updated.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert("Password change failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      passwordMutation.release();
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Change Password
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Update the password for the currently logged-in clinic account. Use a strong password and do not share it.
        </Text>
      </View>

      <SectionCard title="New Password" subtitle="Password must be at least 6 characters and should be known only to this account owner.">
        <AppInput label="New password" placeholder="Enter new password" value={password} onChangeText={setPassword} secureTextEntry />
        <AppInput label="Confirm password" placeholder="Re-enter new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        <AppButton title="Update Password" icon="key-outline" onPress={submit} loading={loading} />
      </SectionCard>
    </Screen>
  );
}
