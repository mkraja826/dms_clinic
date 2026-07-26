import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { ClinicBrandHeader } from "@/components/ClinicBrandHeader";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkflowBottomNav } from "@/components/WorkflowBottomNav";
import { colors } from "@/constants/colors";
import { doctorWorkflowNavItems } from "@/constants/workflowNav";
import { useAuth } from "@/lib/auth";
import { subscribeClinicDashboardRealtime } from "@/lib/realtime";
import {
  DashboardStats,
  WorkflowDashboardSummary,
  getDashboardStats,
  getRoleLabel,
  getWorkflowDashboardSummary,
} from "@/lib/supabase";

type AppointmentRow = {
  id: string;
  patient_id: string;
  appointment_time: string;
  status?: string | null;
  patients?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
  } | null;
};

type IconName = ComponentProps<typeof Ionicons>["name"];

function appointmentTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isWaitingStatus(status?: string | null) {
  const value = String(status || "").toLowerCase();
  return ["scheduled", "waiting", "checked_in", "booked"].includes(value);
}

function openVisit(patientId?: string | null) {
  if (patientId) {
    router.push({ pathname: "/patient/visit", params: { patient_id: patientId } } as never);
    return;
  }

  router.push("/patient/visit" as never);
}

export default function DoctorDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<WorkflowDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(force = false) {
    try {
      setLoading(true);
      const [data, row] = await Promise.all([
        getDashboardStats({ force }),
        getWorkflowDashboardSummary({ force }),
      ]);

      setStats(data);
      setSummary(row);
    } catch (error) {
      Alert.alert("Dashboard load failed", error instanceof Error ? error.message : "Please try again.");
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
    channelKey: "doctor-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);

  const appointments = useMemo<AppointmentRow[]>(
    () => ((stats?.todayAppointmentList ?? []) as AppointmentRow[]),
    [stats?.todayAppointmentList]
  );
  const waiting = appointments.filter((item) => isWaitingStatus(item.status));
  const current = waiting[0];
  const waitingCount = summary?.waiting_count ?? waiting.length;
  const completedCount = summary?.completed_count ?? 0;
  const patientCount = summary?.today_patient_count ?? waitingCount + completedCount;

  return (
    <Screen
      refreshing={loading}
      onRefresh={() => load(true)}
      bottomBar={<WorkflowBottomNav items={doctorWorkflowNavItems} activeKey="home" />}
    >
      <ClinicBrandHeader subtitle={`${getRoleLabel(profile?.role ?? "working_doctor")} - Doctor Desk`} />

      <View
        style={{
          borderRadius: 28,
          backgroundColor: colors.primary,
          padding: 18,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: "rgba(255,255,255,0.76)", fontSize: 12, fontWeight: "900", textTransform: "uppercase" }}>
              Today
            </Text>
            <Text
              numberOfLines={2}
              style={{ color: colors.white, fontSize: 26, fontWeight: "900", lineHeight: 31 }}
            >
              {loading ? "Loading clinical flow" : waitingCount ? `${waitingCount} waiting now` : "Queue clear"}
            </Text>
          </View>

          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.16)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={waitingCount ? "pulse-outline" : "checkmark-done-outline"} size={28} color={colors.white} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 9 }}>
          <FlowMetric label="Patients" value={loading ? "..." : patientCount} icon="people-outline" />
          <FlowMetric label="Waiting" value={loading ? "..." : waitingCount} icon="hourglass-outline" />
          <FlowMetric label="Done" value={loading ? "..." : completedCount} icon="checkmark-done-outline" />
        </View>
      </View>

      <CurrentPatientPanel current={current} />

      <View style={{ gap: 10 }}>
        <SectionTitle
          title="Waiting Queue"
          subtitle={`${waiting.length} active patient${waiting.length === 1 ? "" : "s"} today`}
        />

        {waiting.length ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: colors.border,
            }}
          >
            {waiting.map((item, index) => (
              <QueueRow key={item.id} item={item} index={index} isLast={index === waiting.length - 1} />
            ))}
          </View>
        ) : (
          <EmptyState
            title="No waiting patients"
            message="Reception check-ins will appear here."
            icon="checkmark-done-outline"
          />
        )}
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title="Clinical Actions" subtitle="Common doctor work" />
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <ToolRow
            title="Add Visit"
            subtitle="Clinical notes, treatment, payment due, and follow-up"
            icon="create-outline"
            onPress={() => openVisit()}
          />
          <ToolRow
            title="Find Patient"
            subtitle="History, previous visits, files, and payments"
            icon="search-outline"
            onPress={() => router.push("/patient" as never)}
          />
          <ToolRow
            title="Ongoing Treatments"
            subtitle="Planned, active, complete, and pending treatment work"
            icon="git-branch-outline"
            onPress={() => router.push("/treatments/ongoing" as never)}
            isLast
          />
        </View>
      </View>
    </Screen>
  );
}

function FlowMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: IconName;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 76,
        borderRadius: 20,
        padding: 11,
        backgroundColor: "rgba(255,255,255,0.14)",
        justifyContent: "space-between",
      }}
    >
      <Ionicons name={icon} size={19} color="rgba(255,255,255,0.86)" />
      <View>
        <Text style={{ color: colors.white, fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
        <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.74)", fontSize: 11, fontWeight: "800" }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function CurrentPatientPanel({ current }: { current?: AppointmentRow }) {
  if (!current) {
    return (
      <View
        style={{
          borderRadius: 26,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <PatientMark icon="checkmark-done-outline" tone="success" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>No patient waiting</Text>
            <Text style={{ color: colors.muted, marginTop: 3 }}>The doctor queue is clear.</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        borderRadius: 26,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <PatientMark icon="person-outline" tone="primary" />

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.muted, fontWeight: "900", fontSize: 12, textTransform: "uppercase" }}>
            Now Serving
          </Text>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }}>
            {current.patients?.name || "Patient"}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2 }}>
            {appointmentTime(current.appointment_time)}
            {current.patients?.phone ? ` - ${current.patients.phone}` : ""}
          </Text>
        </View>

        <StatusBadge label="Waiting" tone="warning" />
      </View>

      <AppButton
        title="Start Visit"
        icon="create-outline"
        onPress={() => openVisit(current.patient_id)}
      />

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="History"
          icon="folder-open-outline"
          variant="secondary"
          onPress={() => router.push(`/patient/${current.patient_id}` as never)}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Files"
          icon="cloud-upload-outline"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: "/patient/upload", params: { patient_id: current.patient_id } } as never)
          }
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

function QueueRow({
  item,
  index,
  isLast,
}: {
  item: AppointmentRow;
  index: number;
  isLast: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open visit for ${item.patients?.name || "patient"}`}
      onPress={() => openVisit(item.patient_id)}
      android_ripple={{ color: "rgba(15, 118, 110, 0.08)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 72,
        paddingVertical: 11,
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
          borderRadius: 16,
          backgroundColor: index === 0 ? colors.warningSoft : colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: index === 0 ? colors.warning : colors.primary, fontWeight: "900" }}>
          {index + 1}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
          {item.patients?.name || "Patient"}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 3 }}>
          {appointmentTime(item.appointment_time)}
          {item.patients?.phone ? ` - ${item.patients.phone}` : ""}
        </Text>
      </View>

      <StatusBadge label={index === 0 ? "Next" : item.status || "Waiting"} tone="warning" />
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.muted, lineHeight: 19 }}>{subtitle}</Text> : null}
    </View>
  );
}

function ToolRow({
  title,
  subtitle,
  icon,
  onPress,
  isLast = false,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      android_ripple={{ color: "rgba(15, 118, 110, 0.08)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 68,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
      })}
    >
      <PatientMark icon={icon} tone="primary" size={42} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: "900" }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function PatientMark({
  icon,
  tone,
  size = 50,
}: {
  icon: IconName;
  tone: "primary" | "success";
  size?: number;
}) {
  const bg = tone === "success" ? colors.successSoft : colors.primarySoft;
  const fg = tone === "success" ? colors.success : colors.primary;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.38),
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </View>
  );
}
