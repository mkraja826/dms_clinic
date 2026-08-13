import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { searchPatientsPage } from "@/lib/patientDirectory";
import {
  createAppointment,
  createPatient,
  Patient,
  supabase,
} from "@/lib/supabase";

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
  { label: "07:30 PM", hour: 19, minute: 30 },
];

const REASONS = [
  "Pain",
  "Swelling",
  "Cap issue",
  "Wisdom tooth",
  "Broken tooth",
  "Review",
  "Cleaning",
  "Other",
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

    const isToday = index === 0;
    const isTomorrow = index === 1;

    options.push({
      key: getDateKey(date),
      date,
      monthDay: date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      }),
      weekday: date.toLocaleDateString([], {
        weekday: "short",
      }),
      label: isToday ? "Today" : isTomorrow ? "Tomorrow" : date.toLocaleDateString([], { weekday: "short" }),
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

function formatSelectedDate(date: Date, slot: { label: string; hour: number; minute: number }) {
  const full = makeDateTime(date, slot);

  return full.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BookAppointmentScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const incomingPatientId = typeof params.patient_id === "string" ? params.patient_id : "";
  const dateOptions = useMemo(() => createDateOptions(90), []);
  const firstDateWithFutureSlot = useMemo(() => {
    return (
      dateOptions.find((option) =>
        TIME_SLOTS.some((slot) => isFutureDateTime(option.date, slot))
      ) || dateOptions[0]
    );
  }, [dateOptions]);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [patientSearch, setPatientSearch] = useState("");

  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");

  const [selectedReason, setSelectedReason] = useState("Pain");
  const [otherReason, setOtherReason] = useState("");
  const [selectedDateKey, setSelectedDateKey] = useState(firstDateWithFutureSlot.key);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [onlineSource, setOnlineSource] = useState("WhatsApp / Call");

  const [loadingPatients, setLoadingPatients] = useState(true);
  const [saving, setSaving] = useState(false);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const appointmentSaveLockRef = useRef(false);

  async function loadPatients(searchText = patientSearch) {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({
        query: searchText,
        page: 1,
        pageSize: 10,
      });

      if (requestId === patientRequestRef.current) {
        setPatients(result.patients);
      }

      return result.patients;
    } catch (error) {
      Alert.alert(
        "Patients load failed",
        error instanceof Error ? error.message : "Please try again."
      );

      return [];
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }

  async function selectPatientById(patientId: string) {
    try {
      const rows = await loadPatients("");
      const found = rows.find((patient) => patient.id === patientId);

      if (found) {
        setSelectedPatientId(found.id);
        return;
      }

      const { data, error } = await supabase
        .from("patients")
        .select("id,clinic_id,patient_code,name,gender,age,dob,phone,email,address,emergency_contact,created_at")
        .eq("id", patientId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        Alert.alert("Patient not found", "Open appointment booking from the patient profile again.");
        return;
      }

      const patient = data as Patient;
      setPatients((current) => (current.some((item) => item.id === patient.id) ? current : [patient, ...current]));
      setSelectedPatientId(patient.id);
    } catch (error) {
      Alert.alert(
        "Patient load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    }
  }

  useEffect(() => {
    if (incomingPatientId) {
      void selectPatientById(incomingPatientId);
      return;
    }

    void loadPatients("");
  }, [incomingPatientId]);

  useEffect(() => {
    if (!patientSearchMountedRef.current) {
      patientSearchMountedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      void loadPatients(patientSearch);
    }, 260);

    return () => clearTimeout(timeout);
  }, [patientSearch]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  const filteredPatients = patients;

  const selectedDate =
    dateOptions.find((option) => option.key === selectedDateKey) || firstDateWithFutureSlot;

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

  const reasonText =
    selectedReason === "Other"
      ? otherReason.trim() || "Other"
      : selectedReason;

  async function saveAppointment() {
    if (saving || appointmentSaveLockRef.current) return;

    let patientId = selectedPatientId;
    let createdPatient: Patient | null = null;

    if (!patientId) {
      if (!newPatientName.trim() || !newPatientPhone.trim()) {
        Alert.alert(
          "Patient missing",
          "Select an existing patient or enter new patient name and phone."
        );
        return;
      }
    }

    if (selectedReason === "Other" && !otherReason.trim()) {
      Alert.alert("Reason missing", "Type the appointment reason.");
      return;
    }

    const appointmentDateTime = makeDateTime(selectedDate.date, selectedTime);

    if (appointmentDateTime.getTime() <= Date.now()) {
      Alert.alert(
        "Invalid appointment",
        "Appointments can only be booked for a future date and time."
      );
      return;
    }

    appointmentSaveLockRef.current = true;
    setSaving(true);

    try {
      if (!patientId) {
        const newPatient = await createPatient({
          name: newPatientName.trim(),
          phone: newPatientPhone.trim(),
        });

        patientId = newPatient.id;
        createdPatient = newPatient;
        setPatients((current) =>
          current.some((patient) => patient.id === newPatient.id)
            ? current
            : [newPatient, ...current]
        );
        setSelectedPatientId(newPatient.id);
      }

      await createAppointment({
        patient_id: patientId,
        appointment_time: appointmentDateTime.toISOString(),
        notes: `Source: ${onlineSource}. Reason: ${reasonText}`,
      });

      Alert.alert(
        "Appointment booked",
        `Appointment booked for ${formatSelectedDate(selectedDate.date, selectedTime)}.`,
        [
          {
            text: "Open Patient",
            onPress: () => router.replace(`/patient/${patientId}` as never),
          },
          {
            text: "Dashboard",
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error) {
      if (createdPatient) {
        Alert.alert(
          "Patient saved; appointment failed",
          `${createdPatient.name} was registered, but the appointment was not booked. Retry the appointment for the now-selected patient; do not register the patient again.\n\n${
            error instanceof Error ? error.message : "Please try again."
          }`
        );
        return;
      }

      Alert.alert(
        "Booking failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      appointmentSaveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen refreshing={loadingPatients} onRefresh={loadPatients}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Book Appointment
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Book appointments from WhatsApp, phone calls, website, Instagram, or online enquiries.
        </Text>
      </View>

      <SectionCard title="Patient" subtitle="Search existing patient first. If not found, register the new enquiry patient below.">
        {selectedPatient ? (
          <View
            style={{
              padding: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.primarySoft,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 17 }}>
                  {selectedPatient.name}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>
                  {selectedPatient.phone || "No phone"}
                </Text>
              </View>
              <StatusBadge label="Existing" tone="success" />
            </View>

            <AppButton
              title="Change Patient"
              icon="swap-horizontal-outline"
              variant="secondary"
              onPress={() => setSelectedPatientId("")}
            />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <View
              style={{
                minHeight: 54,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                gap: 10,
              }}
            >
              <Ionicons name="search-outline" size={21} color={colors.muted} />
              <TextInput
                accessibilityLabel="Search existing patients"
                value={patientSearch}
                onChangeText={setPatientSearch}
                placeholder="Search existing patient"
                placeholderTextColor={colors.muted}
                style={{
                  flex: 1,
                  minHeight: 54,
                  color: colors.text,
                  fontSize: 16,
                }}
              />
            </View>

            {patientSearch.trim() ? (
              loadingPatients ? (
                <Text style={{ color: colors.muted }}>Loading patients...</Text>
              ) : filteredPatients.length ? (
                <View style={{ gap: 10 }}>
                  {filteredPatients.map((patient) => (
                    <Pressable
                      key={patient.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Select patient ${patient.name}`}
                      onPress={() => setSelectedPatientId(patient.id)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        padding: 12,
                        borderRadius: 18,
                        backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                      })}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 16,
                          backgroundColor: colors.primarySoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="person-outline" size={21} color={colors.primary} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "900" }}>
                          {patient.name}
                        </Text>
                        <Text style={{ color: colors.muted, marginTop: 2 }}>
                          {patient.phone || "No phone"}
                        </Text>
                      </View>

                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.muted }}>
                  No existing patient found. Enter new patient details below.
                </Text>
              )
            ) : null}

            <View
              style={{
                paddingTop: 4,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                gap: 10,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                New online/call patient
              </Text>

              <AppInput
                label="Patient name"
                value={newPatientName}
                onChangeText={setNewPatientName}
                placeholder="Enter name"
              />

              <AppInput
                label="Phone number"
                value={newPatientPhone}
                onChangeText={setNewPatientPhone}
                placeholder="Enter phone"
                keyboardType="phone-pad"
              />
            </View>
          </View>
        )}
      </SectionCard>

      <SectionCard title="Appointment Reason" subtitle="Pick the main complaint and source so staff understand why the patient is visiting.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
          {REASONS.map((reason) => {
            const selected = selectedReason === reason;

            return (
              <Pressable
                key={reason}
                accessibilityRole="button"
                accessibilityLabel={`Select appointment reason ${reason}`}
                accessibilityState={{ selected }}
                onPress={() => setSelectedReason(reason)}
                style={{
                  paddingHorizontal: 13,
                  paddingVertical: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontWeight: "900",
                    fontSize: 13,
                  }}
                >
                  {reason}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {selectedReason === "Other" ? (
          <AppInput
            label="Reason"
            value={otherReason}
            onChangeText={setOtherReason}
            placeholder="Type short reason"
          />
        ) : null}

        <AppInput
          label="Source"
          value={onlineSource}
          onChangeText={setOnlineSource}
          placeholder="WhatsApp / Call / Instagram / Website"
          helper="This is stored inside appointment notes."
        />
      </SectionCard>

      <SectionCard
        title="Select Date & Time"
        subtitle="Scroll date and time. Only future appointment slots are allowed."
      >
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Date
          </Text>

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
                  accessibilityLabel={`Select appointment date ${option.date.toLocaleDateString()}`}
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
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Time
          </Text>

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
                  accessibilityLabel={`Select appointment time ${slot.label}`}
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
        </View>

        <View
          style={{
            padding: 12,
            borderRadius: 16,
            backgroundColor: colors.successSoft,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 4,
          }}
        >
          <Text style={{ color: colors.success, fontWeight: "900" }}>
            Appointment selected
          </Text>
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            {formatSelectedDate(selectedDate.date, selectedTime)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
            Year is saved automatically in database even though UI shows only month and day.
          </Text>
        </View>
      </SectionCard>

      <AppButton
        title="Confirm Appointment"
        icon="calendar-number-outline"
        onPress={saveAppointment}
        loading={saving}
      />

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="secondary"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
