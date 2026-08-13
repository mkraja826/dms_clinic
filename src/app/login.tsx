import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

type SignupType = "clinic" | "employee";

export default function LoginScreen() {
  const { signIn, signInWithGoogle, signUpOwner, signUpStaff } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupType, setSignupType] = useState<SignupType>("clinic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const authMutation = useImmediateMutationLock();

  async function submit() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing details", "Enter email and password.");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    if (loading || googleLoading || !authMutation.tryLock()) return;

    setLoading(true);

    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        if (signupType === "clinic") {
          await signUpOwner(email, password);
        } else {
          await signUpStaff(email, password);
        }

        Alert.alert(
          "Verify your email",
          signupType === "clinic"
            ? "We sent a verification link. Verify your email, then login and create the clinic workspace."
            : "We sent a verification link. Verify your email, then login and join your clinic using the invite code."
        );
        setMode("login");
        setPassword("");
      }
    } catch (error) {
      Alert.alert(
        mode === "login" ? "Login failed" : "Signup failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      authMutation.release();
      setLoading(false);
    }
  }

  async function submitGoogle() {
    if (googleLoading || loading || !authMutation.tryLock()) return;

    try {
      setGoogleLoading(true);
      await signInWithGoogle();
    } catch (error) {
      Alert.alert(
        "Google login failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      authMutation.release();
      setGoogleLoading(false);
    }
  }

  function SignupChoice({
    type,
    title,
    subtitle,
    icon,
  }: {
    type: SignupType;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
  }) {
    const selected = signupType === type;

    return (
      <Pressable
        onPress={() => setSignupType(type)}
        style={{
          flex: 1,
          borderRadius: 18,
          padding: 12,
          gap: 8,
          borderWidth: 1,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.background,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name={icon} size={20} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "900", flex: 1 }}>{title}</Text>
          <Ionicons
            name={selected ? "checkmark-circle" : "ellipse-outline"}
            size={19}
            color={selected ? colors.primary : colors.muted}
          />
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
          {subtitle}
        </Text>
      </Pressable>
    );
  }

  const signupTitle = signupType === "clinic" ? "Create Clinic Account" : "Create Employee Account";
  const signupSubtitle =
    signupType === "clinic"
      ? "Create the first owner account. After email verification, start a simple clinic workspace on the Free plan."
      : "Create a staff account. After email verification, join your clinic using the invite code from the owner.";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 22,
          gap: 24,
        }}
      >
        <View style={{ alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 78,
              height: 78,
              borderRadius: 26,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: colors.primary,
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 4,
            }}
          >
            <Ionicons name="medical-outline" color={colors.white} size={40} />
          </View>

          <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "900" }}>
            CapDent
          </Text>

          <Text
            style={{
              color: colors.text,
              fontSize: 32,
              fontWeight: "900",
              textAlign: "center",
            }}
          >
            {mode === "login" ? "Clinic Login" : signupTitle}
          </Text>

          <Text
            style={{
              color: colors.muted,
              fontSize: 16,
              textAlign: "center",
              lineHeight: 22,
              maxWidth: 330,
            }}
          >
            {mode === "login"
              ? "Simple dental clinic management for single-owner clinics and growing teams."
              : signupSubtitle}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 30,
            padding: 18,
            gap: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={googleLoading || loading}
            onPress={submitGoogle}
            style={({ pressed }) => ({
              minHeight: 56,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceSoft : colors.background,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 11,
              opacity: googleLoading || loading ? 0.65 : 1,
            })}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name="logo-google" size={22} color="#4285F4" />
            )}
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
              {googleLoading ? "Opening Google..." : "Continue with Google"}
            </Text>
          </Pressable>

          <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 17 }}>
            New Google users choose Clinic or Employee after signing in. Existing users return to their dashboard.
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ height: 1, backgroundColor: colors.border, flex: 1 }} />
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "900" }}>
              OR USE EMAIL
            </Text>
            <View style={{ height: 1, backgroundColor: colors.border, flex: 1 }} />
          </View>

          {mode === "signup" ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Account type
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <SignupChoice
                  type="clinic"
                  title="Clinic"
                  icon="business-outline"
                  subtitle="Start owner workspace"
                />
                <SignupChoice
                  type="employee"
                  title="Employee"
                  icon="people-outline"
                  subtitle="Join using staff invite code"
                />
              </View>
            </View>
          ) : null}

          <AppInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="doctor@clinic.com"
          />

          <AppInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Minimum 6 characters"
          />

          <AppButton
            title={mode === "login" ? "Login" : "Create Account"}
            icon={mode === "login" ? "log-in-outline" : "person-add-outline"}
            onPress={submit}
            loading={loading}
          />

          <AppButton
            title={mode === "login" ? "Create new account" : "Back to login"}
            icon={mode === "login" ? "person-add-outline" : "arrow-back-outline"}
            variant="secondary"
            onPress={() => {
              setMode(mode === "login" ? "signup" : "login");
              setPassword("");
            }}
          />

          {mode === "login" ? (
            <Pressable onPress={() => router.push("/auth/forgot-password" as never)} style={{ alignItems: "center", padding: 8 }}>
              <Text style={{ color: colors.primary, fontWeight: "900" }}>
                Forgot password?
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
          Clinic / Owner → Employee / Staff access with invite code
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
