import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";

type PatientRow = {
  id: string;
  name: string;
  phone?: string | null;
  patient_code?: string | null;
  age?: number | null;
  gender?: string | null;
};

type DateOption = {
  key: string;
  date: Date;
  monthDay: string;
  weekday: string;
  label: string;
};

const TIME_SLOTS = [
  { label: "09:30 AM", hour: 9, minute: 30 },
  { label: "10:00 AM", hour: 10, minute: 0 },
  { label: "10:30 AM", hour: 10, minute: 30 },
  { label: "11:00 AM", hour: 11, minute: 0 },
  { label: "11:30 AM", hour: 11, minute: 30 },
  { label: "12:00 PM", hour: 12, minute: 0 },
  { label: "04:30 PM", hour: 16, minute: 30 },
  { label: "05:00 PM", hour: 17, minute: 0 },
  { label: "05:30 PM", hour: 17, minute: 30 },
  { label: "06:00 PM", hour: 18, minute: 0 },
  { label: "06:30 PM", hour: 18, minute: 30 },
  { label: "07:00 PM", hour: 19, minute: 0 },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createDateOptions(days = 90): DateOption[] {
  const now = new Date();
  const options: DateOption[] = [];

  for (let index = 0; index < days; index++) {
    const date = new Date(now);
    date.setDate(now.getDate() + index);
    date.setHours(0, 0, 0, 0);

    options.push({
      key: getDateKey(date),
      date,
      monthDay: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      weekday: date.toLocaleDateString([], { weekday: "short" }),
      label:
        index === 0
          ? "Today"
          : index === 1
            ? "Tomorrow"
            : date.toLocaleDateString([], { weekday: "short" }),
    });
  }

  return options;
}

function makeDateTime(date: Date, slot: { hour: number; minute: number }) {
  const value = new Date(date);
  value.setHours(slot.hour, slot.minute, 0, 0);
  return value;
}

function isFutureDateTime(date: Date, slot: { hour: number; minute: number }) {
  return makeDateTime(date, slot).getTime() > Date.now();
}

function formatSelectedDate(date: Date, slot: { hour: number; minute: number }) {
  return makeDateTime(date, slot).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

    return [
      err.message,
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "Unknown error";
}

export default function PatientFollowupReminderScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const patientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const dateOptions = useMemo(() => createDateOptions(90), []);

  const firstDateWithFutureSlot = useMemo(() => {
    return (
      dateOptions.find((option) =>
        TIME_SLOTS.some((slot) => isFutureDateTime(option.date, slot))
      ) || dateOptions[0]
    );
  }, [dateOptions]);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState(firstDateWithFutureSlot.key);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [notes, setNotes] = useState("Follow-up reminder");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveReminderLockRef = useRef(false);

  async function loadPatient() {
    if (!patientId) {
      Alert.alert("Patient missing", "Open follow-up from patient profile.");
      router.back();
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("patients")
        .select("id,name,phone,patient_code,age,gender")
        .eq("id", patientId)
        .maybeSingle();

      if (error) throw error;

      setPatient(data as PatientRow | null);
    } catch (error) {
      Alert.alert("Patient load failed", getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPatient();
  }, [patientId]);

  const selectedDate =
    dateOptions.find((option) => option.key === selectedDateKey) ||
    firstDateWithFutureSlot;

  const availableTimeSlots = useMemo(() => {
    return TIME_SLOTS.map((slot, index) => ({
      ...slot,
      index,
      disabled: !isFutureDateTime(selectedDate.date, slot),
    }));
  }, [selectedDate]);

  useEffect(() => {
    const currentSlot = availableTimeSlots[selectedTimeIndex];

    if (!currentSlot || currentSlot.disabled) {
      const firstAvailable = availableTimeSlots.find((slot) => !slot.disabled);
      if (firstAvailable) setSelectedTimeIndex(firstAvailable.index);
    }
  }, [selectedDateKey, availableTimeSlots, selectedTimeIndex]);

  const selectedTime = TIME_SLOTS[selectedTimeIndex] || TIME_SLOTS[0];
  const selectedDateTime = makeDateTime(selectedDate.date, selectedTime);

  async function saveReminder() {
    if (saving || saveReminderLockRef.current) return;

    if (!patientId) {
      Alert.alert("Patient missing", "Open follow-up from patient profile.");
      return;
    }

    if (selectedDateTime.getTime() <= Date.now()) {
      Alert.alert("Invalid time", "Follow-up reminder must be future date/time.");
      return;
    }

    saveReminderLockRef.current = true;
    setSaving(true);

    try {
      const { error } = await supabase.rpc("create_patient_followup_reminder", {
        p_patient_id: patientId,
        p_appointment_time: selectedDateTime.toISOString(),
        p_notes: notes.trim() || "Follow-up reminder",
      });

      if (error) throw error;

      Alert.alert(
        "Follow-up reminder saved",
        `${patient?.name || "Patient"} follow-up set for ${formatSelectedDate(
          selectedDate.date,
          selectedTime
        )}.`,
        [
          {
            text: "Open Reminders",
            onPress: () => router.replace("/reminders" as never),
          },
          {
            text: "Open Patient",
            onPress: () => router.replace(`/patient/${patientId}` as never),
          },
        ]
      );
    } catch (error) {
      Alert.alert("Follow-up save failed", getErrorMessage(error));
    } finally {
      saveReminderLockRef.current = false;
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen refreshing={loading} onRefresh={loadPatient}>
        <Text style={{ color: colors.muted }}>Loading follow-up...</Text>
      </Screen>
    );
  }

  return (
    <Screen refreshing={loading} onRefresh={loadPatient}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Follow-up Reminder
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Schedule a patient-specific review reminder so reception can follow up at the right time.
        </Text>
      </View>

      {patient ? (
        <SectionCard title="Patient" subtitle="Confirm the patient before saving a follow-up reminder.">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                backgroundColor: colors.primarySoft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="person-outline" size={25} color={colors.primary} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
                {patient.name}
              </Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>
                {patient.phone || "No phone"}
                {patient.patient_code ? ` • ${patient.patient_code}` : ""}
              </Text>
            </View>

            <StatusBadge label="Follow-up" tone="warning" />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Select Date"
        subtitle="Scroll month/day. Year is saved automatically."
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingRight: 12 }}
        >
          {dateOptions.map((option) => {
            const selected = selectedDateKey === option.key;
            const hasFutureSlot = TIME_SLOTS.some((slot) =>
              isFutureDateTime(option.date, slot)
            );

            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityLabel={`Select follow-up date ${option.date.toLocaleDateString()}`}
                accessibilityState={{ disabled: !hasFutureSlot, selected }}
                disabled={!hasFutureSlot}
                onPress={() => setSelectedDateKey(option.key)}
                style={{
                  width: 86,
                  minHeight: 88,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  opacity: hasFutureSlot ? 1 : 0.35,
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.white : colors.muted,
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {option.label}
                </Text>

                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontSize: 19,
                    fontWeight: "900",
                  }}
                >
                  {option.monthDay}
                </Text>

                <Text
                  style={{
                    color: selected ? "rgba(255,255,255,0.75)" : colors.muted,
                    fontSize: 11,
                  }}
                >
                  {option.weekday}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SectionCard>

      <SectionCard title="Select Time" subtitle="Only future time slots are enabled.">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingRight: 12 }}
        >
          {availableTimeSlots.map((slot) => {
            const selected = selectedTimeIndex === slot.index;

            return (
              <Pressable
                key={slot.label}
                accessibilityRole="button"
                accessibilityLabel={`Select follow-up time ${slot.label}`}
                accessibilityState={{ disabled: slot.disabled, selected }}
                disabled={slot.disabled}
                onPress={() => setSelectedTimeIndex(slot.index)}
                style={{
                  minWidth: 92,
                  minHeight: 48,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 12,
                  opacity: slot.disabled ? 0.32 : 1,
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontWeight: "900",
                  }}
                >
                  {slot.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={{
            padding: 14,
            borderRadius: 18,
            backgroundColor: colors.warningSoft,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 4,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Reminder Date & Time
          </Text>
          <Text style={{ color: colors.warning, fontWeight: "900", fontSize: 17 }}>
            {formatSelectedDate(selectedDate.date, selectedTime)}
          </Text>
        </View>
      </SectionCard>

      <SectionCard title="Notes" subtitle="Add a short reason so staff know why this patient should return.">
        <AppInput
          label="Reminder Note"
          value={notes}
          onChangeText={setNotes}
          placeholder="Review after RCT, cap trial, extraction follow-up..."
          multiline
        />
      </SectionCard>

      <AppButton
        title="Save Follow-up Reminder"
        icon="notifications-outline"
        onPress={saveReminder}
        loading={saving}
      />

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
