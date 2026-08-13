import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { CAPDENT_APP_NAME, CAPDENT_SUPPORT_REQUEST_TITLE } from "@/lib/appIdentity";
import { useAuth } from "@/lib/auth";
import { getDashboardPath, getRoleLabel } from "@/lib/supabase";
import {
  CAPDENT_SUPPORT_EMAIL,
  CAPDENT_SUPPORT_SUBJECT_PREFIX,
} from "@/lib/supportContact";

type IssueCategory = "bug" | "payment" | "upload" | "login" | "suggestion" | "other";

const ISSUE_CATEGORIES: { key: IssueCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "bug", label: "Bug", icon: "bug-outline" },
  { key: "payment", label: "Payment", icon: "wallet-outline" },
  { key: "upload", label: "Upload", icon: "cloud-upload-outline" },
  { key: "login", label: "Login", icon: "lock-closed-outline" },
  { key: "suggestion", label: "Suggestion", icon: "bulb-outline" },
  { key: "other", label: "Other", icon: "help-circle-outline" },
];

function buildMailUrl(input: { subject: string; body: string }) {
  return `mailto:${CAPDENT_SUPPORT_EMAIL}?subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(input.body)}`;
}

function supportNowLabel() {
  return new Date().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReportIssueScreen() {
  const { profile } = useAuth();
  const [category, setCategory] = useState<IssueCategory>("bug");
  const [description, setDescription] = useState("");
  const [includeAppMetadata, setIncludeAppMetadata] = useState(false);
  const [sending, setSending] = useState(false);

  const categoryLabel = ISSUE_CATEGORIES.find((item) => item.key === category)?.label ?? "Issue";
  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const homePath = getDashboardPath(profile?.role ?? "receptionist");

  const supportMessage = useMemo(() => {
    const lines = [
      CAPDENT_SUPPORT_REQUEST_TITLE,
      "",
      `Issue Type: ${categoryLabel}`,
      `Reported At: ${supportNowLabel()}`,
      "",
      "Issue Details",
      description.trim() || "Please describe the issue here.",
    ];

    if (includeAppMetadata) {
      lines.push(
        "",
        "Optional App Details",
        `App Version: ${appVersion}`,
        `Platform: ${Platform.OS}`,
        `Role: ${profile?.role ? getRoleLabel(profile.role) : "not available"}`
      );
    }

    return lines.join("\n");
  }, [appVersion, categoryLabel, description, includeAppMetadata, profile?.role]);

  async function sendSupportEmail() {
    if (!description.trim()) {
      Alert.alert("Issue details required", "Write what happened before sending support request.");
      return;
    }

    try {
      setSending(true);
      const subject = `${CAPDENT_SUPPORT_SUBJECT_PREFIX} - ${categoryLabel}`;
      const url = buildMailUrl({ subject, body: supportMessage });
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "Email app not available",
        "Please copy the support details shown below and send them to support manually."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Feedback & Support
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Report a problem or suggestion without automatically attaching clinic, user, or patient identifiers.
        </Text>
      </View>

      <SectionCard title="Support Contact" subtitle="Use this for bugs, payment issues, upload problems, login help, or suggestions.">
        <View
          style={{
            padding: 14,
            borderRadius: 20,
            backgroundColor: colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 6,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {CAPDENT_APP_NAME} Support
          </Text>
          <Text selectable style={{ color: colors.primary, fontWeight: "900" }}>
            {CAPDENT_SUPPORT_EMAIL}
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            App version, platform, and role can be included to help diagnose the issue. Clinic IDs, user IDs, names, and patient data are not attached automatically.
          </Text>
        </View>
      </SectionCard>

      <SectionCard title="Issue Type" subtitle="Choose the closest category.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ISSUE_CATEGORIES.map((item) => {
            const selected = category === item.key;

            return (
              <Pressable
                key={item.key}
                onPress={() => setCategory(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  minHeight: 42,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name={item.icon} size={16} color={selected ? colors.white : colors.primary} />
                <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900", fontSize: 13 }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard title="What happened?" subtitle="Describe the screen, the action you took, and what you expected.">
        <View
          style={{
            minHeight: 150,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Example: Patient profile → upload X-ray → upload failed after retry."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            style={{
              minHeight: 130,
              color: colors.text,
              fontSize: 16,
              lineHeight: 22,
            }}
          />
        </View>

        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          Do not include patient names, phone numbers, clinical notes, diagnoses, prescriptions, X-ray identifiers, or other patient information unless support specifically requires it through an approved secure channel.
        </Text>

        <Pressable
          onPress={() => setIncludeAppMetadata((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeAppMetadata }}
          accessibilityLabel="Include optional app diagnostic details"
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
        >
          <Ionicons
            name={includeAppMetadata ? "checkbox" : "square-outline"}
            size={24}
            color={includeAppMetadata ? colors.primary : colors.muted}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Include app diagnostic details</Text>
            <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 19 }}>
              Includes app version, platform, and role only. No clinic ID, user ID, or patient information.
            </Text>
          </View>
        </Pressable>

        <AppButton
          title="Send Support Email"
          icon="mail-outline"
          onPress={() => {
            void sendSupportEmail();
          }}
          loading={sending}
        />
      </SectionCard>

      <SectionCard title="Support Details Preview" subtitle="Review exactly what will be placed into the email before it opens.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <StatusBadge label={categoryLabel} tone="warning" />
          {includeAppMetadata ? <StatusBadge label={`v${appVersion}`} /> : null}
          {includeAppMetadata ? <StatusBadge label={Platform.OS} tone="success" /> : null}
        </View>

        <Text selectable style={{ color: colors.muted, lineHeight: 20 }}>
          {supportMessage}
        </Text>
      </SectionCard>

      <AppButton
        title="Back to Dashboard"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.replace(homePath as never)}
      />
    </Screen>
  );
}
