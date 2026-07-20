import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { ActionCard } from "@/components/ActionCard";
import { AppButton } from "@/components/AppButton";
import { ClinicBrandHeader } from "@/components/ClinicBrandHeader";
import { EmptyState } from "@/components/EmptyState";
import { RescheduleAppointmentModal } from "@/components/RescheduleAppointmentModal";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { StatCard } from "@/components/StatCard";
import { WaitingAppointmentActions } from "@/components/WaitingAppointmentActions";
import { WorkflowBottomNav } from "@/components/WorkflowBottomNav";
import { colors } from "@/constants/colors";
import { receptionWorkflowNavItems } from "@/constants/workflowNav";
import { useAuth } from "@/lib/auth";
import { subscribeClinicDashboardRealtime } from "@/lib/realtime";
import {
  ClinicFeatureSettings,
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  DashboardStats,
  getDashboardStats,
  getRoleLabel,
  getWorkflowDashboardSummary,
  rescheduleAppointment,
  supabase,
  updateAppointmentStatus,
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
    photo_url?: string | null;
  } | null;
};

function money(value?: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function appointmentTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function isWaitingStatus(status?: string | null) {
  const value = String(status || "").toLowerCase();
  return ["scheduled", "waiting", "checked_in", "booked"].includes(value);
}

export default function ReceptionDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [features, setFeatures] = useState<ClinicFeatureSettings>(DEFAULT_CLINIC_FEATURE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busyAppointmentId, setBusyAppointmentId] = useState<string | null>(null);
  const [rescheduleItem, setRescheduleItem] = useState<AppointmentRow | null>(null);
  const completionLocksRef = useRef(new Set<string>());

  async function load(force = false) {
    try {
      setLoading(true);

      const [data, row, featureSettings] = await Promise.all([
        getDashboardStats({ force }),
        getWorkflowDashboardSummary({ force }),
        getClinicFeatureSettings().catch((error) => {
          console.warn("Reception optional features load failed:", error);
          return DEFAULT_CLINIC_FEATURE_SETTINGS;
        }),
      ]);

      setFeatures(featureSettings);

      const { data: appointmentRows, error: appointmentError } = await supabase
        .from("appointments")
        .select("id,patient_id,appointment_time,status,patients(id,name,phone,photo_url)")
        .gte("appointment_time", startOfToday())
        .lte("appointment_time", endOfToday())
        .in("status", ["scheduled", "waiting", "checked_in", "booked"])
        .order("appointment_time", { ascending: true });

      if (!appointmentError && Array.isArray(appointmentRows)) {
        setStats({ ...data, todayAppointmentList: appointmentRows as any });
      } else {
        if (appointmentError) console.warn("Reception photo appointment query failed:", appointmentError.message);
        setStats(data);
      }

      if (row) setSummary(row);
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
    const { data: appointmentRows, error } = await supabase
      .from("appointments")
      .select("id,patient_id,appointment_time,status,patients(id,name,phone,photo_url)")
      .gte("appointment_time", startOfToday())
      .lte("appointment_time", endOfToday())
      .in("status", ["scheduled", "waiting", "checked_in", "booked"])
      .order("appointment_time", { ascending: true });
    setStats(!error && Array.isArray(appointmentRows) ? { ...data, todayAppointmentList: appointmentRows as any } : data);
    if (row) setSummary(row);
  }

  useEffect(() => subscribeClinicDashboardRealtime({
    clinicId: profile?.clinic_id,
    channelKey: "reception-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);

  async function performReschedule(item: AppointmentRow, nextTime: Date) {
    try {
      setBusyAppointmentId(item.id);
      await rescheduleAppointment(
        item.id,
        nextTime.toISOString(),
        `Rescheduled by reception from ${appointmentDateTime(item.appointment_time)} to ${appointmentDateTime(nextTime.toISOString())}.`
      );
      setRescheduleItem(null);
      await refreshWorkflow(true);
    } catch (error) {
      Alert.alert("Reschedule failed", error instanceof Error ? error.message : "Please try again.");
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
    setSummary((current: any) => current ? {
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
    () => ((stats?.todayAppointmentList ?? []) as AppointmentRow[]),
    [stats?.todayAppointmentList]
  );
  const waiting = appointments.filter((item) => isWaitingStatus(item.status));
  const next = waiting[0];
  const appointmentCount = stats?.todayAppointments ?? appointments.length;
  const waitingCount = summary?.waiting_count ?? waiting.length;
  const completedCount = summary?.completed_count ?? 0;
  const opCheckInCount = summary?.today_patient_count ?? waitingCount + completedCount;

  return (
    <Screen
      refreshing={loading}
      onRefresh={() => load(true)}
      bottomBar={<WorkflowBottomNav items={receptionWorkflowNavItems} activeKey="home" />}
    >
      <ClinicBrandHeader subtitle={`${getRoleLabel(profile?.role ?? "receptionist")} • Reception Desk`} />

      <SectionCard>
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
            Start Here
          </Text>

          <ActionCard
            title="Check-in Patient"
            subtitle="Register/select patient, handle OP fee, send to doctor queue"
            icon="send-outline"
            onPress={() => router.push("/reception/checkin" as never)}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Book appointment"
              onPress={() => router.push("/appointment/book" as never)}
              style={{
                flex: 1,
                minHeight: 102,
                borderRadius: 22,
                padding: 13,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                justifyContent: "space-between",
              }}
            >
              <Ionicons name="calendar-number-outline" size={26} color={colors.primary} />
              <View>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>Book</Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>Appointment</Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Collect payment"
              onPress={() => router.push("/payment/fee" as never)}
              style={{
                flex: 1,
                minHeight: 102,
                borderRadius: 22,
                padding: 13,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                justifyContent: "space-between",
              }}
            >
              <Ionicons name="cash-outline" size={26} color={colors.primary} />
              <View>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>Payment</Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>Fees & dues</Text>
              </View>
            </Pressable>
          </View>
          <ActionCard
            title="Find Patient"
            subtitle="Open history, payments, files, visits, and patient actions"
            icon="search-outline"
            onPress={() => router.push("/patient" as never)}
          />
          <AppButton
            title="More Tools"
            icon="grid-outline"
            variant="secondary"
            onPress={() => router.push("/(reception)/more" as never)}
          />
        </View>
      </SectionCard>

      {next ? (
        <SectionCard>
          <View
            style={{
              borderRadius: 24,
              backgroundColor: colors.warningSoft,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <PatientAvatar
                photoUrl={features.enable_patient_photos ? next.patients?.photo_url : null}
                warning
                size={48}
              />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>
                  Next Waiting Patient
                </Text>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 }}>
                  {next.patients?.name || "Patient"}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2 }}>
                  {appointmentTime(next.appointment_time)}
                  {next.patients?.phone ? ` • ${next.patients.phone}` : ""}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <AppButton
                title="Open Patient"
                icon="person-circle-outline"
                onPress={() => router.push(`/patient/${next.patient_id}` as never)}
                style={{ flex: 1 }}
              />
              {features.enable_prescription_medications ? (
                <AppButton
                  title="Add Tablets"
                  icon="medical-outline"
                  variant="secondary"
                  onPress={() => router.push({ pathname: "/patient/medications", params: { patient_id: next.patient_id } } as never)}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>

            <View style={{ alignItems: "flex-end" }}>
              <WaitingAppointmentActions
                busy={busyAppointmentId === next.id}
                onReschedule={() => setRescheduleItem(next)}
                onCompleted={() => confirmComplete(next)}
              />
            </View>
          </View>
        </SectionCard>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatCard label="OP Check-ins" value={loading ? "..." : opCheckInCount} icon="send-outline" />
        <StatCard label="Appointments" value={loading ? "..." : appointmentCount} icon="calendar-number-outline" />
        <StatCard label="Waiting" value={loading ? "..." : waitingCount} icon="hourglass-outline" tone="warning" />
        <StatCard label="Completed" value={loading ? "..." : completedCount} icon="checkmark-done-outline" tone="success" />
        <StatCard label="Revenue" value={loading ? "..." : money(summary?.today_revenue ?? stats?.todayRevenue)} icon="cash-outline" tone="success" />
        <StatCard label="Pending" value={loading ? "..." : money(summary?.pending_payments ?? stats?.pendingPayments)} icon="wallet-outline" tone="warning" />
      </View>

      <SectionCard title="Waiting Room" subtitle={`${waiting.length} active waiting patient${waiting.length === 1 ? "" : "s"} today.`}>
        {waiting.length ? (
          <View style={{ gap: 10 }}>
            {waiting.map((item) => (
              <AppointmentItem
                key={item.id}
                item={item}
                showPhoto={features.enable_patient_photos}
                busy={busyAppointmentId === item.id}
                onPress={() => router.push(`/patient/${item.patient_id}` as never)}
                onReschedule={() => setRescheduleItem(item)}
                onCompleted={() => confirmComplete(item)}
              />
            ))}
          </View>
        ) : (
          <EmptyState title="No waiting patients" message="Use Quick Check-in to send patient to doctor queue." icon="people-outline" />
        )}
      </SectionCard>

      <RescheduleAppointmentModal
        visible={Boolean(rescheduleItem)}
        patientName={rescheduleItem?.patients?.name}
        currentAppointmentTime={rescheduleItem?.appointment_time}
        saving={Boolean(rescheduleItem && busyAppointmentId === rescheduleItem.id)}
        onClose={() => setRescheduleItem(null)}
        onConfirm={(nextTime) => {
          if (rescheduleItem) void performReschedule(rescheduleItem, nextTime);
        }}
      />
    </Screen>
  );
}

function AppointmentItem({
  item,
  onPress,
  onReschedule,
  onCompleted,
  showPhoto,
  busy,
}: {
  item: AppointmentRow;
  onPress: () => void;
  onReschedule: () => void;
  onCompleted: () => void;
  showPhoto: boolean;
  busy: boolean;
}) {
  return (
    <View
      style={{
        minHeight: 70,
        padding: 10,
        borderRadius: 18,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.patients?.name || "patient"}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          minHeight: 50,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderRadius: 14,
          backgroundColor: pressed ? colors.surfaceSoft : colors.background,
        })}
      >
        <PatientAvatar photoUrl={showPhoto ? item.patients?.photo_url : null} />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {item.patients?.name || "Patient"}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 3 }}>
            {appointmentTime(item.appointment_time)}
            {item.patients?.phone ? ` • ${item.patients.phone}` : ""}
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

function PatientAvatar({
  photoUrl,
  warning = false,
  size = 46,
}: {
  photoUrl?: string | null;
  warning?: boolean;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.37),
        backgroundColor: warning ? colors.warningSoft : colors.primarySoft,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {photoUrl ? (
        <SecureStorageImage uri={photoUrl} style={{ width: "100%", height: "100%" }} contentFit="cover" />
      ) : (
        <Ionicons name={warning ? "time-outline" : "person-outline"} size={22} color={warning ? colors.warning : colors.primary} />
      )}
    </View>
  );
}
