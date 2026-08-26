import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ComponentProps, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { WorkflowBottomNav } from "@/components/WorkflowBottomNav";
import { colors } from "@/constants/colors";
import { headWorkflowNavItems } from "@/constants/workflowNav";

type IconName = ComponentProps<typeof Ionicons>["name"];
type ToolTarget = string | { pathname: string; params?: Record<string, string> };

export default function HeadMoreToolsScreen() {
  return (
    <Screen bottomBar={<WorkflowBottomNav items={headWorkflowNavItems} activeKey="more" />}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to owner dashboard"
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
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>More</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Owner tools, reports, staff, plans, and account.
          </Text>
        </View>
      </View>

      <ToolSection title="Owner Review">
        <ToolRow title="Clinic Report" subtitle="Daily closing summary and owner export" icon="analytics-outline" target="/reports/clinic" />
        <ToolRow title="Clinic Intelligence" subtitle="Owner insight preview, clinic flow, and future analytics" icon="sparkles-outline" target="/reports/owner-review" />
        <ToolRow title="Owner Review" subtitle="Follow-ups, dues, and attention items" icon="clipboard-outline" target="/reports/owner-review" />
        <ToolRow title="Treatment Report" subtitle="Planned, ongoing, complete, and pending value" icon="construct-outline" target="/reports/treatments" />
      </ToolSection>

      <ToolSection title="Clinic Control">
        <ToolRow title="Check-in" subtitle="Register walk-ins and send patients to waiting" icon="send-outline" target="/reception/checkin" />
        <ToolRow title="Book Appointment" subtitle="Schedule patient visits and follow-ups" icon="calendar-number-outline" target="/appointment/book" />
        <ToolRow title="Reminders" subtitle="Follow-ups and payment reminders" icon="notifications-outline" target="/reminders" />
        <ToolRow title="Gallery" subtitle="X-rays, prescriptions, reports, and photos" icon="images-outline" target="/gallery" />
      </ToolSection>

      <ToolSection title="Admin">
        <ToolRow title="Clinic Health" subtitle="V28 plan usage, quota, billing, and notification readiness" icon="pulse-outline" target="/settings/clinic-health" />
        <ToolRow title="Patient Payments" subtitle="Connect the clinic receiving account for finalized patient invoices" icon="wallet-outline" target="/settings/patient-payments" />
        <ToolRow title="Staff" subtitle="Invite and manage clinic access" icon="people-circle-outline" target="/staff" />
        <ToolRow title="Clinic Branding" subtitle="Logo and clinic identity" icon="brush-outline" target="/clinic/branding" />
        <ToolRow title="Clinic Feature Settings" subtitle="Dental chart, payment push, photos, and prescription features" icon="options-outline" target="/settings/clinic-features" />
        <ToolRow title="Notification Health" subtitle="Permission, device registration, and payment push delivery" icon="notifications-circle-outline" target="/settings/notification-health" />
        <ToolRow title="View Plans" subtitle="Free, Cloud, and Clinic Intelligence" icon="card-outline" target="/settings/subscription" />
        <ToolRow title="Billing Recovery" subtitle="Restore or recheck an existing Google Play subscription" icon="refresh-circle-outline" target="/settings/subscription-recovery" />
        <ToolRow title="App Guide" subtitle="Clinic setup and workflow help" icon="book-outline" target="/settings/guide" />
        <ToolRow title="Feedback & Support" subtitle="Report an issue or send product feedback" icon="chatbox-ellipses-outline" target="/settings/report-issue" />
        <ToolRow title="Legal & Account" subtitle="Logout, support, privacy, and account settings" icon="shield-checkmark-outline" target="/settings/legal" />
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
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.muted}
        accessible={false}
        importantForAccessibility="no"
      />
    </Pressable>
  );
}
