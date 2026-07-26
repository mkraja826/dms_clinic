import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Alert,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ClinicBrandHeader } from "@/components/ClinicBrandHeader";
import { EmptyState } from "@/components/EmptyState";
import { RescheduleAppointmentModal } from "@/components/RescheduleAppointmentModal";
import { Screen } from "@/components/Screen";
import { WaitingAppointmentActions } from "@/components/WaitingAppointmentActions";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { subscribeClinicDashboardRealtime } from "@/lib/realtime";
import {
  formatClinicMoney,
  getDefaultClinicPreferences,
} from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import {
  DashboardStats,
  WorkflowDashboardSummary,
  getDashboardStats,
  getRoleLabel,
  getWorkflowDashboardSummary,
  rescheduleAppointment,
  updateAppointmentStatus,
} from "@/lib/supabase";

type AppointmentRow = {
  id: string;
  patient_id: string;
  appointment_time: string;
  status?: string | null;
  patients?: {
    name?: string | null;
    phone?: string | null;
  } | null;
};
type IconName = ComponentProps<typeof Ionicons>["name"];

function appointmentTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appointmentDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isWaitingStatus(status?: string | null) {
  const value = String(status || "").toLowerCase();
  return ["scheduled", "waiting", "checked_in", "booked"].includes(value);
}

export default function HeadDashboard() {
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<WorkflowDashboardSummary | null>(null);
  const [currencyCode, setCurrencyCode] = useState(
    getDefaultClinicPreferences().currencyCode
  );
  const [loading, setLoading] = useState(true);
  const [busyAppointmentId, setBusyAppointmentId] = useState<string | null>(null);
  const [rescheduleItem, setRescheduleItem] = useState<AppointmentRow | null>(null);
  const completionLocksRef = useRef(new Set<string>());
  const metricBasis = width < 380 ? "100%" : "47%";
  const money = (value?: number | null) =>
    formatClinicMoney(value, currencyCode);

  async function load(force = false) {
    try {
      setLoading(true);
      const [data, row, clinicPreferences] = await Promise.all([
        getDashboardStats({ force }),
        getWorkflowDashboardSummary({ force }),
        getClinicPreferences({ force }).catch(() =>
          getDefaultClinicPreferences()
        ),
      ]);

      setStats(data);
      setSummary(row);
      setCurrencyCode(clinicPreferences.currencyCode);
    } catch (error) {
      Alert.alert(
        "Dashboard load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshWorkflow(force = false) {
    const [data, row] = await Promise.all([
      getDashboardStats({ force }),
      getWorkflowDashboardSummary({ force }),
    ]);
    setStats(data);
    setSummary(row);
  }

  useEffect(() => subscribeClinicDashboardRealtime({
    clinicId: profile?.clinic_id,
    channelKey: "head-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);

  async function performReschedule(item: AppointmentRow, nextTime: Date) {
    try {
      setBusyAppointmentId(item.id);
      await rescheduleAppointment(
        item.id,
        nextTime.toISOString(),
        `Rescheduled by owner from ${appointmentDateTime(
          item.appointment_time
        )} to ${appointmentDateTime(nextTime.toISOString())}.`
      );
      setRescheduleItem(null);
      await refreshWorkflow(true);
    } catch (error) {
      Alert.alert(
        "Reschedule failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setBusyAppointmentId(null);
    }
  }

  async function performComplete(item: AppointmentRow) {
    if (completionLocksRef.current.has(item.id)) return;
    completionLocksRef.current.add(item.id);
    const previousStats = stats;
    const previousSummary = summary;
    setBusyAppointmentId(item.id);
    setStats((current) => current ? {
      ...current,
      todayAppointmentList: ((current.todayAppointmentList ?? []) as AppointmentRow[]).filter((row) => row.id !== item.id) as any,
    } : current);
    setSummary((current) => current ? {
      ...current,
      waiting_count: Math.max(Number(current.waiting_count || 0) - 1, 0),
      completed_count: Number(current.completed_count || 0) + 1,
    } : current);
    try {
      await updateAppointmentStatus(item.id, "completed");
      await refreshWorkflow(true);
    } catch (error) {
      setStats(previousStats);
      setSummary(previousSummary);
      Alert.alert("Complete failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      completionLocksRef.current.delete(item.id);
      setBusyAppointmentId(null);
    }
  }

  function confirmComplete(item: AppointmentRow) {
    const name = item.patients?.name || "this patient";

    Alert.alert(
      "Mark completed?",
      `${name} will be removed from the waiting room and counted as completed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Completed",
          onPress: () => void performComplete(item),
        },
      ]
    );
  }

  const appointments = useMemo<AppointmentRow[]>(
    () => (stats?.todayAppointmentList ?? []) as AppointmentRow[],
    [stats?.todayAppointmentList]
  );
  const waiting = appointments.filter((item) => isWaitingStatus(item.status));
  const todayRevenue = summary?.today_revenue ?? stats?.todayRevenue ?? 0;
  const pendingPayments =
    summary?.pending_payments ?? stats?.pendingPayments ?? 0;
  const waitingCount = summary?.waiting_count ?? waiting.length;
  const completedCount = summary?.completed_count ?? 0;
  const patientCount =
    summary?.today_patient_count ?? waitingCount + completedCount;

  const breakdownRows = [
    {
      label: "OP consultation",
      value: summary?.op_fee_revenue_today,
      icon: "receipt-outline" as IconName,
    },
    {
      label: "Treatments",
      value: summary?.treatment_revenue_today,
      icon: "construct-outline" as IconName,
    },
    {
      label: "Medication",
      value: summary?.medication_revenue_today,
      icon: "medical-outline" as IconName,
    },
    {
      label: "X-ray",
      value: summary?.xray_revenue_today,
      icon: "scan-outline" as IconName,
    },
    {
      label: "Pending collected",
      value: summary?.pending_collected_today,
      icon: "wallet-outline" as IconName,
    },
    {
      label: "Other",
      value: summary?.other_revenue_today,
      icon: "cash-outline" as IconName,
    },
  ].filter((row) => Number(row.value || 0) > 0 || row.label !== "Other");

  return (
    <Screen refreshing={loading} onRefresh={() => load(true)}>
      <ClinicBrandHeader
        showManage
        subtitle={`${getRoleLabel(
          profile?.role ?? "head_doctor"
        )} - Owner Dashboard`}
      />

      <OwnerSummary
        loading={loading}
        revenue={todayRevenue}
        pending={pendingPayments}
        waiting={waitingCount}
        completed={completedCount}
        currencyCode={currencyCode}
      />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <CompactMetric
          basis={metricBasis}
          label="Patients Today"
          value={loading ? "..." : patientCount}
          icon="people-outline"
        />
        <CompactMetric
          basis={metricBasis}
          label="Waiting"
          value={loading ? "..." : waitingCount}
          icon="hourglass-outline"
          tone="warning"
        />
        <CompactMetric
          basis={metricBasis}
          label="Completed"
          value={loading ? "..." : completedCount}
          icon="checkmark-done-outline"
          tone="success"
        />
        <CompactMetric
          basis={metricBasis}
          label="Total Patients"
          value={loading ? "..." : stats?.totalPatients ?? 0}
          icon="person-outline"
        />
      </View>

      <DashboardSection
        title="Collections"
        subtitle="Today's split, kept simple for closing review."
      >
        {summary ? (
          <FlatListPanel>
            {breakdownRows.map((row, index) => (
              <DashboardRow
                key={row.label}
                title={row.label}
                subtitle="Collected today"
                value={money(row.value)}
                icon={row.icon}
                isLast={index === breakdownRows.length - 1}
                onPress={() => router.push("/reports/payments" as never)}
              />
            ))}
          </FlatListPanel>
        ) : (
          <EmptyState
            title="Collection split loading"
            message="Revenue totals are visible above. Detailed split appears when workflow summary is available."
            icon="analytics-outline"
          />
        )}
      </DashboardSection>

      <DashboardSection
        title="Owner Priorities"
        subtitle="The few actions that matter during a working day."
      >
        <FlatListPanel>
          <DashboardRow
            title="Payment Review"
            subtitle="Collections, dues, and pending amount follow-up"
            icon="wallet-outline"
            tone="warning"
            onPress={() => router.push("/reports/payments" as never)}
          />
          <DashboardRow
            title="Clinic Intelligence"
            subtitle="Owner insight preview now, deeper analytics later"
            icon="sparkles-outline"
            tone="success"
            onPress={() => router.push("/reports/owner-review" as never)}
          />
          <DashboardRow
            title="Patient Search"
            subtitle="Open profile, history, visits, files, and payment status"
            icon="search-outline"
            onPress={() => router.push("/patient" as never)}
          />
          <DashboardRow
            title="Ongoing Treatments"
            subtitle="Review active treatment work and completion status"
            icon="git-branch-outline"
            onPress={() => router.push("/treatments/ongoing" as never)}
          />
          <DashboardRow
            title="Staff"
            subtitle="Invite staff and manage clinic access"
            icon="people-circle-outline"
            onPress={() => router.push("/staff" as never)}
            isLast
          />
        </FlatListPanel>
      </DashboardSection>

      <DashboardSection
        title="Waiting Room"
        subtitle={`${waiting.length} active waiting patient${
          waiting.length === 1 ? "" : "s"
        } today.`}
      >
        {waiting.length ? (
          <FlatListPanel>
            {waiting.map((item, index) => (
              <WaitingRow
                key={item.id}
                item={item}
                busy={busyAppointmentId === item.id}
                isLast={index === waiting.length - 1}
                onReschedule={() => setRescheduleItem(item)}
                onCompleted={() => confirmComplete(item)}
              />
            ))}
          </FlatListPanel>
        ) : (
          <EmptyState
            title="No waiting patients"
            message="Reception check-ins will appear here."
            icon="checkmark-done-outline"
          />
        )}
      </DashboardSection>

      <RescheduleAppointmentModal
        visible={Boolean(rescheduleItem)}
        patientName={rescheduleItem?.patients?.name}
        currentAppointmentTime={rescheduleItem?.appointment_time}
        saving={Boolean(
          rescheduleItem && busyAppointmentId === rescheduleItem.id
        )}
        onClose={() => setRescheduleItem(null)}
        onConfirm={(nextTime) => {
          if (rescheduleItem) void performReschedule(rescheduleItem, nextTime);
        }}
      />
    </Screen>
  );
}

function OwnerSummary({
  loading,
  revenue,
  pending,
  waiting,
  completed,
  currencyCode,
}: {
  loading: boolean;
  revenue: number;
  pending: number;
  waiting: number;
  completed: number;
  currencyCode: string;
}) {
  const { width } = useWindowDimensions();
  const stackPills = width < 360;
  const money = (value?: number | null) =>
    formatClinicMoney(value, currencyCode);

  return (
    <View
      style={{
        borderRadius: 28,
        padding: 18,
        backgroundColor: colors.primary,
        gap: 16,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: "rgba(255,255,255,0.76)",
              fontSize: 12,
              fontWeight: "900",
              textTransform: "uppercase",
            }}
          >
            Today at the clinic
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.74}
            style={{
              color: colors.white,
              fontSize: 32,
              fontWeight: "900",
              marginTop: 8,
            }}
          >
            {loading ? "Loading..." : money(revenue)}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.76)",
              lineHeight: 20,
              marginTop: 4,
              fontWeight: "700",
            }}
          >
            {waiting ? `${waiting} waiting now` : "Queue clear"} - {completed}{" "}
            completed today
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open clinic report"
          onPress={() => router.push("/reports/clinic" as never)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 18,
            backgroundColor: pressed
              ? "rgba(255,255,255,0.24)"
              : "rgba(255,255,255,0.16)",
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <Ionicons
            name="analytics-outline"
            size={24}
            color={colors.white}
          />
        </Pressable>
      </View>

      <View
        style={{ flexDirection: stackPills ? "column" : "row", gap: 10 }}
      >
        <SummaryPill
          label="Collected"
          value={loading ? "..." : money(revenue)}
          icon="cash-outline"
        />
        <SummaryPill
          label="Pending"
          value={loading ? "..." : money(pending)}
          icon="wallet-outline"
          warning
        />
      </View>
    </View>
  );
}

function SummaryPill({
  label,
  value,
  icon,
  warning,
}: {
  label: string;
  value: string;
  icon: IconName;
  warning?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 76,
        borderRadius: 20,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.13)",
        justifyContent: "space-between",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <Text
          style={{
            color: "rgba(255,255,255,0.74)",
            fontSize: 11,
            fontWeight: "900",
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
        <Ionicons
          name={icon}
          size={17}
          color={warning ? colors.warningSoft : "rgba(255,255,255,0.82)"}
        />
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={{
          color: colors.white,
          fontSize: 18,
          fontWeight: "900",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function CompactMetric({
  basis,
  label,
  value,
  icon,
  tone = "primary",
}: {
  basis: "47%" | "100%";
  label: string;
  value: string | number;
  icon: IconName;
  tone?: "primary" | "success" | "warning";
}) {
  const bg =
    tone === "success"
      ? colors.successSoft
      : tone === "warning"
      ? colors.warningSoft
      : colors.surface;
  const fg =
    tone === "success"
      ? colors.success
      : tone === "warning"
      ? colors.warning
      : colors.primary;

  return (
    <View
      style={{
        flexGrow: 1,
        flexShrink: 0,
        flexBasis: basis,
        minHeight: 82,
        borderRadius: 20,
        padding: 12,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: "space-between",
      }}
    >
      <Ionicons name={icon} size={20} color={fg} />
      <View>
        <Text
          numberOfLines={1}
          style={{
            color: colors.text,
            fontSize: 20,
            fontWeight: "900",
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: colors.muted,
            fontSize: 11,
            fontWeight: "900",
            marginTop: 2,
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function DashboardSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.muted, lineHeight: 19 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function FlatListPanel({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderRadius: 20,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function DashboardRow({
  title,
  subtitle,
  icon,
  value,
  onPress,
  tone = "primary",
  isLast = false,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  value?: string;
  onPress: () => void;
  tone?: "primary" | "success" | "warning";
  isLast?: boolean;
}) {
  const iconColor =
    tone === "success"
      ? colors.success
      : tone === "warning"
      ? colors.warning
      : colors.primary;
  const iconBg =
    tone === "success"
      ? colors.successSoft
      : tone === "warning"
      ? colors.warningSoft
      : colors.primarySoft;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      android_ripple={{
        color: "rgba(15, 118, 110, 0.08)",
        borderless: false,
      }}
      style={({ pressed }) => ({
        minHeight: 70,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={iconColor} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.text, fontSize: 15, fontWeight: "900" }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}
        >
          {subtitle}
        </Text>
      </View>

      {value ? (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.76}
          style={{
            color: colors.text,
            fontSize: 15,
            fontWeight: "900",
            fontVariant: ["tabular-nums"],
            maxWidth: 116,
            textAlign: "right",
          }}
        >
          {value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function WaitingRow({
  item,
  busy,
  isLast,
  onReschedule,
  onCompleted,
}: {
  item: AppointmentRow;
  busy: boolean;
  isLast: boolean;
  onReschedule: () => void;
  onCompleted: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 74,
        paddingHorizontal: 14,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.patients?.name || "patient"}`}
        onPress={() => router.push(`/patient/${item.patient_id}` as never)}
        android_ripple={{
          color: "rgba(15, 118, 110, 0.08)",
          borderless: false,
        }}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          minHeight: 52,
          borderRadius: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
        })}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 15,
            backgroundColor: colors.warningSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="time-outline" size={21} color={colors.warning} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}
          >
            {item.patients?.name || "Patient"}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.muted, marginTop: 3 }}
          >
            {appointmentTime(item.appointment_time)}
            {item.patients?.phone ? ` - ${item.patients.phone}` : ""}
          </Text>
        </View>
      </Pressable>

      <WaitingAppointmentActions
        busy={busy}
        onReschedule={onReschedule}
        onCompleted={onCompleted}
      />
    </View>
  );
}
