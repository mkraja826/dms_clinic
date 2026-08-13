import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

function paramsFromUrl(url: string) {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : "";
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const params = new URLSearchParams(query);

  new URLSearchParams(hash).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  return params;
}

async function applyAuthLink(url: string | null) {
  if (!url) {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  }

  const params = paramsFromUrl(url);
  const errorDescription = params.get("error_description") || params.get("error");
  const code = params.get("code");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (errorDescription) {
    throw new Error(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) throw error;
    return true;
  }

  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export default function ResetPasswordScreen() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const resetMutation = useImmediateMutationLock();

  useEffect(() => {
    let mounted = true;

    async function handleResetUrl(url: string | null) {
      try {
        if (mounted) setCheckingLink(true);
        const ready = await applyAuthLink(url);
        if (mounted) setLinkReady(ready);
      } catch (error) {
        if (mounted) {
          setLinkReady(false);
          Alert.alert(
            "Invalid reset link",
            error instanceof Error ? error.message : "Open the latest reset email and try again."
          );
        }
      } finally {
        if (mounted) setCheckingLink(false);
      }
    }

    Linking.getInitialURL().then(handleResetUrl).catch(() => {
      if (mounted) setCheckingLink(false);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleResetUrl(url).catch(() => undefined);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  async function submit() {
    if (!linkReady) {
      Alert.alert("Open reset link", "Open the latest reset link from your email before setting a new password.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Password mismatch", "Enter the same new password twice.");
      return;
    }

    if (loading || !resetMutation.tryLock()) return;

    setLoading(true);
    try {
      await updatePassword(password);
      await supabase.auth.signOut();
      Alert.alert("Password updated", "Login with your new password.", [
        { text: "Login", onPress: () => router.replace("/login" as never) },
      ]);
    } catch (error) {
      Alert.alert("Reset failed", error instanceof Error ? error.message : "Open the latest reset link and try again.");
    } finally {
      resetMutation.release();
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Reset Password
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          {checkingLink
            ? "Checking your secure reset link..."
            : linkReady
              ? "Set a new password for this CapDent account."
              : "Open the latest reset link from your email to continue."}
        </Text>
      </View>

      <SectionCard title="New Password">
        <AppInput
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Minimum 6 characters"
        />
        <AppInput
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Repeat password"
        />
        <AppButton
          title={checkingLink ? "Checking Link..." : "Update Password"}
          icon="key-outline"
          onPress={submit}
          loading={loading || checkingLink}
        />
      </SectionCard>
    </Screen>
  );
}
