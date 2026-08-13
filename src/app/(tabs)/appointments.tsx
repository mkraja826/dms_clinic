import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { AppInput } from "@/components/AppInput";
import { QuickAction } from "@/components/QuickAction";
import { SectionCard } from "@/components/SectionCard";
import { StatusChip } from "@/components/StatusChip";
import { colors } from "@/constants/colors";
import { Appointment, createAppointment, getTodayAppointments, searchPatients, updateAppointmentStatus } from "@/lib/supabase";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";
import { appointmentReminderMessage, openWhatsApp } from "@/lib/whatsapp";

export default function AppointmentsScreen() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientPhone, setPatientPhone] = useState("");
  const [dateTime, setDateTime] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const createMutation = useImmediateMutationLock();
  const statusMutation = useImmediateMutationLock();

  const load = useCallback(async () => {
    try {
      const nextAppointments = await getTodayAppointments();
      setAppointments(nextAppointments);
    } catch (error) {
      Alert.alert("Appointments error", error instanceof Error ? error.message : "Unable to load appointments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    const term = patientPhone.trim();

    if (!term) {
      Alert.alert("Patient missing", "Enter exact patient phone number or name.");
      return;
    }

    if (saving || !createMutation.tryLock()) return;

    setSaving(true);
    try {
      const matches = await searchPatients(term);
      const patient = matches.find((item) => item.phone === term || item.name.toLowerCase() === term.toLowerCase());

      if (!patient) {
        Alert.alert("Patient not found", "Enter an exact patient phone number or name.");
        return;
      }

      await createAppointment({ patient_id: patient.id, appointment_time: new Date(dateTime).toISOString(), notes });
      setPatientPhone("");
      setNotes("");
      await load();
    } catch (error) {
      Alert.alert("Save failed", error instanceof Error ? error.message : "Unable to create appointment.");
    } finally {
      createMutation.release();
      setSaving(false);
    }
  }

  async function updateStatus(appointmentId: string, status: "completed" | "no_show") {
    if (updatingAppointmentId || !statusMutation.tryLock()) return;

    setUpdatingAppointmentId(appointmentId);
    try {
      await updateAppointmentStatus(appointmentId, status);
      await load();
    } catch (error) {
      Alert.alert(
        "Appointment update failed",
        error instanceof Error ? error.message : "Unable to update this appointment."
      );
    } finally {
      statusMutation.release();
      setUpdatingAppointmentId(null);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SectionCard title="Create Appointment" subtitle="Schedule a patient visit using exact phone number or patient name.">
        <AppInput label="Patient phone or exact name" value={patientPhone} onChangeText={setPatientPhone} />
        <AppInput label="Date and time" value={dateTime} onChangeText={setDateTime} placeholder="YYYY-MM-DDTHH:mm" />
        <AppInput label="Notes" value={notes} onChangeText={setNotes} multiline />
        <AppButton title="Schedule Appointment" icon="calendar-outline" onPress={save} loading={saving} />
      </SectionCard>
      <SectionCard title="Today's Appointments" subtitle="Track scheduled patients, mark completed/no-show, or send WhatsApp reminders.">
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && !appointments.length ? <EmptyState title="No appointments today" body="Schedule a patient visit from the form above." icon="calendar-clear-outline" /> : null}
        {appointments.map((item) => (
          <View key={item.id} style={{ borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 10, gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>{item.patients?.name ?? "Patient"}</Text>
                <Text selectable style={{ color: colors.muted }}>{new Date(item.appointment_time).toLocaleString()}</Text>
              </View>
              <StatusChip label={item.status} tone={item.status === "completed" ? "success" : item.status === "scheduled" ? "primary" : "warning"} />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <AppButton
                title="Done"
                variant="secondary"
                style={{ flex: 1, minHeight: 42 }}
                onPress={() => updateStatus(item.id, "completed")}
                loading={updatingAppointmentId === item.id}
                loadingTitle="Updating..."
                disabled={Boolean(updatingAppointmentId)}
              />
              <AppButton
                title="No show"
                variant="secondary"
                style={{ flex: 1, minHeight: 42 }}
                onPress={() => updateStatus(item.id, "no_show")}
                loading={updatingAppointmentId === item.id}
                loadingTitle="Updating..."
                disabled={Boolean(updatingAppointmentId)}
              />
            </View>
            <QuickAction
              icon="logo-whatsapp"
              label="WhatsApp reminder"
              onPress={() => openWhatsApp(item.patients?.phone, appointmentReminderMessage({ patientName: item.patients?.name ?? "Patient", appointmentTime: item.appointment_time }))}
            />
          </View>
        ))}
      </SectionCard>
    </ScrollView>
  );
}
