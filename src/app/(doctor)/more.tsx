import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ComponentProps, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { WorkflowBottomNav } from "@/components/WorkflowBottomNav";
import { colors } from "@/constants/colors";
import { doctorWorkflowNavItems } from "@/constants/workflowNav";

type IconName = ComponentProps<typeof Ionicons>["name"];
type ToolTarget = string | { pathname: string; params?: Record<string, string> };

export default function DoctorMoreToolsScreen() {
  return (
    <Screen bottomBar={<WorkflowBottomNav items={doctorWorkflowNavItems} activeKey="more" />}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to doctor dashboard"
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 42,
            height: 42,
            borderRadius: 16,
            backgroundColor: colors.surfaceSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} accessible={false} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>More</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Files, follow-ups, gallery, and account.
          </Text>
        </View>
      </View>

      <ToolSection title="Clinical Files">
        <ToolRow title="Upload X-ray / Prescription" subtitle="Add files to the selected patient" icon="cloud-upload-outline" target="/patient/upload" />
        <ToolRow title="Gallery" subtitle="View X-rays, prescriptions, reports, and photos" icon="images-outline" target="/gallery" />
      </ToolSection>

      <ToolSection title="Follow-up Work">
        <ToolRow title="Follow-up Reminders" subtitle="Today and overdue review patients" icon="notifications-outline" target="/reminders" />
        <ToolRow title="Book Follow-up" subtitle="Schedule the next review appointment" icon="calendar-number-outline" target="/appointment/book" />
      </ToolSection>

      <ToolSection title="Account">
        <ToolRow title="Legal & Account" subtitle="Logout, privacy, support, and account options" icon="shield-checkmark-outline" target="/settings/legal" />
        <ToolRow title="Change Password" subtitle="Update your login password" icon="key-outline" target="/settings/change-password" />
      </ToolSection>
    </Screen>
  );
}

function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{title}</Text>
      <View
        style={{
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ToolRow({
  title,
  subtitle,
  icon,
  target,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  target: ToolTarget;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => router.push(target as never)}
      android_ripple={{ color: "rgba(15, 118, 110, 0.08)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 66,
        paddingVertical: 11,
        paddingHorizontal: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={colors.primary} accessible={false} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} accessible={false} />
    </Pressable>
  );
}
