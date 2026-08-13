import { router } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { createStaffInvite } from "@/lib/supabase";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

type StaffRole = "working_doctor" | "receptionist";

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";

  if (error instanceof Error) return error.message;

  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const err = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    const parts = [
      err.message,
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ].filter(Boolean);

    if (parts.length) return parts.join("\n");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export default function AddStaffScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("working_doctor");
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const inviteMutation = useImmediateMutationLock();

  async function createInvite() {
    if (!name.trim()) {
      Alert.alert("Name required", "Enter staff name.");
      return;
    }

    if (!inviteMutation.tryLock()) return;

    setLoading(true);
    setInviteCode("");

    try {
      const invite = await createStaffInvite({
        name: name.trim(),
        email: email.trim() || null,
        role,
      });

      const code = invite.invite_code || "";

      setInviteCode(code);

      Alert.alert(
        "Invite created",
        code
          ? `Share this code with staff: ${code}`
          : "Invite created successfully."
      );
    } catch (error) {
      Alert.alert("Invite failed", getErrorMessage(error));
    } finally {
      inviteMutation.release();
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Invite Staff
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Create a staff invite code with the correct clinic role. Share it only with trusted staff.
        </Text>
      </View>

      <SectionCard title="Staff Details" subtitle="Enter staff name, optional email, and choose the exact role before creating code.">
        <AppInput
          label="Staff Name"
          value={name}
          onChangeText={setName}
          placeholder="Example: Dr. Kumar"
        />

        <AppInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="Optional"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <AppButton
            title="Doctor"
            icon="medical-outline"
            variant={role === "working_doctor" ? "primary" : "secondary"}
            onPress={() => setRole("working_doctor")}
            style={{ flex: 1 }}
          />

          <AppButton
            title="Reception"
            icon="desktop-outline"
            variant={role === "receptionist" ? "primary" : "secondary"}
            onPress={() => setRole("receptionist")}
            style={{ flex: 1 }}
          />
        </View>

        <AppButton
          title="Create Invite Code"
          icon="mail-outline"
          onPress={createInvite}
          loading={loading}
        />
      </SectionCard>

      {inviteCode ? (
        <SectionCard title="Invite Code Created" subtitle="This code gives staff access after onboarding, so share carefully.">
          <Text
            selectable
            style={{
              color: colors.text,
              fontSize: 32,
              fontWeight: "900",
              textAlign: "center",
              letterSpacing: 1,
            }}
          >
            {inviteCode}
          </Text>

          <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 21 }}>
            Ask staff to sign up or login, open onboarding, and enter this invite code. Do not share this code publicly.
          </Text>

          <AppButton
            title="Back to Staff"
            icon="people-outline"
            variant="secondary"
            onPress={() => router.replace("/staff" as never)}
          />
        </SectionCard>
      ) : null}

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
