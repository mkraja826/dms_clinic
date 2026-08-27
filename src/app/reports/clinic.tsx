import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { colors } from "@/constants/colors";
import {
  formatClinicMoney,
  getDefaultClinicPreferences,
} from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import {
  DashboardStats,
  getDashboardStats,
  getWorkflowDashboardSummary,
} from "@/lib/supabase";

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type ReportLink = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  tone?: "primary" | "warning" | "success";
};

function ReportLinkCard({ item }: { item: ReportLink }) {
  const backgroundColor =
    item.tone === "warning"
      ? colors.warningSoft
      : item.tone === "success"
        ? colors.successSoft
        : colors.background;
  const iconColor =
    item.tone === "warning"
      ? colors.warning
      : item.tone === "success"
        ? colors.success
        : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={() => router.push(item.route as never)}
      style={{
        flex: 1,
        minWidth: "47%",
        minHeight: 116,
        padding: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface,
        }}
      >
        <Ionicons name={item.icon} size={21} color={iconColor} />
      </View>
      <View style={{ gap: 3 }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {item.title}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 18, fontSize: 12 }}>
          {item.subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

export default function ClinicReportScreen() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [currencyCode, setCurrencyCode] = useState(
    getDefaultClinicPreferences().currencyCode
  );
  const [loading, setLoading] = useState(true);
  const money = (value?: number | string | null) =>
    formatClinicMoney(value, currencyCode);

  async function load() {
    try {
      setLoading(true);
      const [data, row, preferences] = await Promise.all([
        getDashboardStats(),
        getWorkflowDashboardSummary(),
        getClinicPreferences().catch(() => getDefaultClinicPreferences()),
      ]);
      setStats(data);
      if (row) setSummary(row);
      setCurrencyCode(preferences.currencyCode);
    } catch (error) {
      Alert.alert(
        "Report load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const todayAppointments = useMemo(
    () => stats?.todayAppointmentList ?? [],
    [stats?.todayAppointmentList]
  );

  const revenueRows = [
    {
      label: "OP Fees",
      value: summary?.op_fee_revenue_today,
      icon: "receipt-outline" as const,
    },
    {
      label: "X-ray",
      value: summary?.xray_revenue_today,
      icon: "scan-outline" as const,
    },
    {
      label: "Medication",
      value: summary?.medication_revenue_today,
      icon: "medical-outline" as const,
    },
    {
      label: "Treatment",
      value: summary?.treatment_revenue_today,
      icon: "hammer-outline" as const,
    },
    {
      label: "Pending Paid",
      value: summary?.pending_collected_today,
      icon: "checkmark-circle-outline" as const,
    },
    {
      label: "Other",
      value: summary?.other_revenue_today,
      icon: "wallet-outline" as const,
    },
  ];

  const moneyLinks: ReportLink[] = [
    {
      title: "Payment Review",
      subtitle: "Closing totals, methods, categories, staff and dues.",
      icon: "card-outline",
      route: "/reports/payments",
      tone: "success",
    },
    {
      title: "Verified Online",
      subtitle: "Provider-verified payments and receiving accounts.",
      icon: "shield-checkmark-outline",
      route: "/reports/online-payments",
      tone: "success",
    },
    {
      title: "Reconciliation",
      subtitle: "Resolve verified payments held for owner review.",
      icon: "warning-outline",
      route: "/reports/reconciliation-required",
      tone: "warning",
    },
  ];

  const operationsLinks: ReportLink[] = [
    {
      title: "Owner Review Board",
      subtitle: "Missed follow-ups, treatment and patient-detail exceptions.",
      icon: "clipboard-outline",
      route: "/reports/owner-review",
      tone: "warning",
    },
    {
      title: "Follow-ups",
      subtitle: "Review due and missed patient follow-ups.",
      icon: "repeat-outline",
      route: "/reports/followups",
    },
    {
      title: "Treatments",
      subtitle: "Track open, completed and paid treatment work.",
      icon: "hammer-outline",
      route: "/reports/treatments",
    },
  ];

  const teamLinks: ReportLink[] = [
    {
      title: "Staff Performance",
      subtitle: "Collections, work and clinic responsibility by staff.",
      icon: "people-circle-outline",
      route: "/reports/staff-performance",
    },
  ];

  const recordLinks: ReportLink[] = [
    {
      title: "Activity Log",
      subtitle: "Review important clinic actions and changes.",
      icon: "pulse-outline",
      route: "/reports/activity",
    },
    {
      title: "Excel Export",
      subtitle: "Download owner-friendly clinic data for records.",
      icon: "download-outline",
      route: "/reports/export",
    },
  ];

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Clinic Report
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Owner summary for {todayLabel()}. Use this before closing the clinic day.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatCard
          label="Today Revenue"
          value={loading ? "..." : money(summary?.today_revenue ?? stats?.todayRevenue)}
          icon="cash-outline"
          tone="success"
        />
        <StatCard
          label="Pending Due"
          value={loading ? "..." : money(summary?.pending_payments ?? stats?.pendingPayments)}
          icon="wallet-outline"
          tone="warning"
        />
        <StatCard
          label="Patients Today"
          value={loading ? "..." : summary?.today_patient_count ?? 0}
          icon="people-outline"
        />
        <StatCard
          label="Completed"
          value={loading ? "..." : summary?.completed_count ?? 0}
          icon="checkmark-done-outline"
          tone="success"
        />
      </View>

      <SectionCard
        title="Revenue Breakdown"
        subtitle="Check each collection type before closing daily accounts."
      >
        <View style={{ gap: 10 }}>
          {revenueRows.map((row) => (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 18,
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.primarySoft,
                }}
              >
                <Ionicons name={row.icon} size={20} color={colors.primary} />
              </View>
              <Text style={{ flex: 1, color: colors.text, fontWeight: "900" }}>
                {row.label}
              </Text>
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                {loading ? "..." : money(row.value)}
              </Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard
        title="Daily Workflow"
        subtitle="Quick health check for queue, visits, appointments, and patient load."
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatCard
            label="Waiting"
            value={loading ? "..." : summary?.waiting_count ?? 0}
            icon="hourglass-outline"
            tone="warning"
          />
          <StatCard
            label="Appointments"
            value={loading ? "..." : todayAppointments.length}
            icon="calendar-number-outline"
          />
          <StatCard
            label="Total Patients"
            value={loading ? "..." : stats?.totalPatients ?? 0}
            icon="person-outline"
          />
          <StatCard
            label="Old Pending"
            value={loading ? "..." : money(summary?.pending_payments ?? stats?.pendingPayments)}
            icon="alert-circle-outline"
            tone="warning"
          />
        </View>
      </SectionCard>

      <SectionCard
        title="Reports & Controls"
        subtitle="Everything the owner needs for closing, review and clinic records."
      >
        <View style={{ gap: 18 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
              Money
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {moneyLinks.map((item) => (
                <ReportLinkCard key={item.title} item={item} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
              Operations
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {operationsLinks.map((item) => (
                <ReportLinkCard key={item.title} item={item} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
              Team
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {teamLinks.map((item) => (
                <ReportLinkCard key={item.title} item={item} />
              ))}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
              Records
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {recordLinks.map((item) => (
                <ReportLinkCard key={item.title} item={item} />
              ))}
            </View>
          </View>
        </View>
      </SectionCard>

      <SectionCard
        title="Closing Checklist"
        subtitle="Use this every evening before leaving the clinic."
      >
        <View style={{ gap: 10 }}>
          {[
            "Reception OP fees checked",
            "Doctor queue completed",
            "Owner Review Board checked",
            "Pending payments reviewed",
            "Follow-up review checked",
            "Treatment review checked",
            "Staff performance reviewed",
          ].map((item) => (
            <View
              key={item}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={21}
                color={colors.success}
              />
              <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard
        title="Export Privacy"
        subtitle="Owner-facing exports should look human-readable and clinic-friendly."
      >
        <EmptyState
          title="No technical IDs in owner tools"
          message="Exports and owner views use patient names, phone numbers, patient codes, visit dates, staff names, and amounts. Internal database IDs, UUIDs, clinic IDs, file IDs, and user IDs stay hidden."
          icon="shield-checkmark-outline"
        />
      </SectionCard>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="Refresh"
          icon="refresh-outline"
          variant="secondary"
          onPress={load}
          loading={loading}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Dashboard"
          icon="home-outline"
          variant="ghost"
          onPress={() => router.replace("/(head)/dashboard" as never)}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}
