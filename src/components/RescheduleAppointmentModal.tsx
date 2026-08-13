import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { colors } from "@/constants/colors";
import {
  formatClinicTime,
  getDefaultClinicPreferences,
  normalizeClinicTime,
} from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";

type DateOption = {
  key: string;
  date: Date;
  monthDay: string;
  weekday: string;
  label: string;
};

type TimeSlot = {
  label: string;
  hour: number;
  minute: number;
  dayOffset: number;
};

type Props = {
  visible: boolean;
  patientName?: string | null;
  currentAppointmentTime?: string | null;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (nextTime: Date) => void;
};

const SLOT_INTERVAL_MINUTES = 30;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createDateOptions(days = 90): DateOption[] {
  const now = new Date();
  const options: DateOption[] = [];

  for (let index = 0; index < days; index += 1) {
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

function timeToMinutes(value: string, fallback: string) {
  const normalized = normalizeClinicTime(value, fallback);
  const [hourText, minuteText] = normalized.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function formatSlotLabel(totalMinutes: number) {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  const date = new Date(2000, 0, 1, hour, minute);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildUsualTimeSlots(openingTime: string, closingTime: string): TimeSlot[] {
  const start = timeToMinutes(openingTime, "09:00");
  let end = timeToMinutes(closingTime, "21:00");

  if (end <= start) end += 1440;

  const slots: TimeSlot[] = [];
  for (
    let totalMinutes = start;
    totalMinutes < end && slots.length < 48;
    totalMinutes += SLOT_INTERVAL_MINUTES
  ) {
    const minutesInDay = totalMinutes % 1440;
    const dayOffset = Math.floor(totalMinutes / 1440);

    slots.push({
      label: `${formatSlotLabel(totalMinutes)}${dayOffset ? " · next day" : ""}`,
      hour: Math.floor(minutesInDay / 60),
      minute: minutesInDay % 60,
      dayOffset,
    });
  }

  return slots;
}

function buildEmergencyTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];

  for (let totalMinutes = 0; totalMinutes < 1440; totalMinutes += SLOT_INTERVAL_MINUTES) {
    slots.push({
      label: formatSlotLabel(totalMinutes),
      hour: Math.floor(totalMinutes / 60),
      minute: totalMinutes % 60,
      dayOffset: 0,
    });
  }

  return slots;
}

function makeDateTime(date: Date, slot: TimeSlot) {
  const value = new Date(date);
  value.setDate(value.getDate() + slot.dayOffset);
  value.setHours(slot.hour, slot.minute, 0, 0);
  return value;
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RescheduleAppointmentModal({
  visible,
  patientName,
  currentAppointmentTime,
  saving = false,
  onClose,
  onConfirm,
}: Props) {
  const defaults = useMemo(() => getDefaultClinicPreferences(), []);
  const dateOptions = useMemo(() => createDateOptions(90), [visible]);
  const emergencyTimeSlots = useMemo(() => buildEmergencyTimeSlots(), []);
  const [openingTime, setOpeningTime] = useState(defaults.openingTime);
  const [closingTime, setClosingTime] = useState(defaults.closingTime);
  const [loadingHours, setLoadingHours] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const confirmLockRef = useRef(false);

  const usualTimeSlots = useMemo(
    () => buildUsualTimeSlots(openingTime, closingTime),
    [openingTime, closingTime]
  );
  const timeSlots = emergencyMode ? emergencyTimeSlots : usualTimeSlots;

  useEffect(() => {
    if (!visible || !saving) confirmLockRef.current = false;
  }, [visible, saving]);

  useEffect(() => {
    if (!visible) return;

    let active = true;
    setEmergencyMode(false);
    setLoadingHours(true);

    getClinicPreferences({ force: true })
      .then((preferences) => {
        if (!active) return;
        setOpeningTime(preferences.openingTime);
        setClosingTime(preferences.closingTime);
      })
      .catch(() => {
        if (!active) return;
        setOpeningTime(defaults.openingTime);
        setClosingTime(defaults.closingTime);
      })
      .finally(() => {
        if (active) setLoadingHours(false);
      });

    return () => {
      active = false;
    };
  }, [visible, defaults.closingTime, defaults.openingTime]);

  useEffect(() => {
    if (!visible || loadingHours || !dateOptions.length || !timeSlots.length) return;

    const currentTime = currentAppointmentTime
      ? new Date(currentAppointmentTime).getTime()
      : Number.NaN;

    for (const option of dateOptions) {
      const firstValidSlotIndex = timeSlots.findIndex((slot) => {
        const candidate = makeDateTime(option.date, slot).getTime();
        return candidate > Date.now() && candidate !== currentTime;
      });

      if (firstValidSlotIndex >= 0) {
        setSelectedDateKey(option.key);
        setSelectedTimeIndex(firstValidSlotIndex);
        return;
      }
    }

    setSelectedDateKey(dateOptions[0].key);
    setSelectedTimeIndex(0);
  }, [
    visible,
    loadingHours,
    currentAppointmentTime,
    dateOptions,
    timeSlots,
  ]);

  const selectedDate =
    dateOptions.find((option) => option.key === selectedDateKey) || dateOptions[0];

  const availableTimeSlots = useMemo(() => {
    if (!selectedDate) return [];

    return timeSlots.map((slot, index) => ({
      ...slot,
      index,
      disabled: makeDateTime(selectedDate.date, slot).getTime() <= Date.now(),
    }));
  }, [selectedDate, timeSlots]);

  useEffect(() => {
    const selectedSlot = availableTimeSlots[selectedTimeIndex];
    if (selectedSlot && !selectedSlot.disabled) return;

    const firstAvailable = availableTimeSlots.find((slot) => !slot.disabled);
    if (firstAvailable) setSelectedTimeIndex(firstAvailable.index);
  }, [availableTimeSlots, selectedTimeIndex]);

  const selectedTime = timeSlots[selectedTimeIndex] || timeSlots[0];
  const selectedDateTime = selectedDate && selectedTime
    ? makeDateTime(selectedDate.date, selectedTime)
    : null;
  const currentTime = currentAppointmentTime
    ? new Date(currentAppointmentTime).getTime()
    : Number.NaN;
  const unchanged = selectedDateTime?.getTime() === currentTime;
  const canConfirm = Boolean(
    selectedDateTime &&
      selectedDateTime.getTime() > Date.now() &&
      !unchanged &&
      !saving &&
      !loadingHours
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => {
        if (!saving) onClose();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(15, 23, 42, 0.48)",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 680,
            maxHeight: "92%",
            alignSelf: "center",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              paddingHorizontal: 18,
              paddingTop: 16,
              paddingBottom: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primarySoft,
              }}
            >
              <Ionicons name="calendar-number-outline" size={24} color={colors.primary} />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
                Choose Date & Time
              </Text>
              <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2 }}>
                {patientName || "Patient"}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close reschedule"
              disabled={saving}
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                opacity: saving ? 0.5 : 1,
              })}
            >
              <Ionicons name="close" size={23} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 18, gap: 18, paddingBottom: 24 }}
          >
            {currentAppointmentTime ? (
              <View
                style={{
                  padding: 13,
                  borderRadius: 18,
                  backgroundColor: colors.warningSoft,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 4,
                }}
              >
                <Text style={{ color: colors.warning, fontSize: 12, fontWeight: "900" }}>
                  CURRENT APPOINTMENT
                </Text>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {formatDateTime(currentAppointmentTime)}
                </Text>
              </View>
            ) : null}

            <View
              style={{
                padding: 13,
                borderRadius: 18,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                gap: 5,
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "900" }}>
                USUAL CLINIC HOURS
              </Text>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                {loadingHours
                  ? "Loading clinic hours..."
                  : `${formatClinicTime(openingTime)} to ${formatClinicTime(closingTime)}`}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
                Appointment slots automatically follow this clinic's saved hours.
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                emergencyMode
                  ? "Return to usual clinic hours"
                  : "Show emergency times outside usual clinic hours"
              }
              disabled={saving || loadingHours}
              onPress={() => setEmergencyMode((current) => !current)}
              style={({ pressed }) => ({
                minHeight: 58,
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderWidth: 1,
                borderColor: emergencyMode ? colors.warning : colors.border,
                backgroundColor: emergencyMode
                  ? colors.warningSoft
                  : pressed
                    ? colors.surfaceSoft
                    : colors.background,
                opacity: loadingHours ? 0.55 : 1,
              })}
            >
              <Ionicons
                name={emergencyMode ? "time" : "alert-circle-outline"}
                size={22}
                color={emergencyMode ? colors.warning : colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {emergencyMode ? "Showing all-day emergency times" : "Emergency / outside usual hours"}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
                  {emergencyMode
                    ? "Tap again to return to the clinic's usual hours."
                    : "Use only when the doctor accepts an appointment outside normal hours."}
                </Text>
              </View>
              <Ionicons name="swap-horizontal-outline" size={20} color={colors.muted} />
            </Pressable>

            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>Date</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingRight: 12 }}
              >
                {dateOptions.map((option) => {
                  const selected = option.key === selectedDateKey;
                  const hasFutureSlot = timeSlots.some(
                    (slot) => makeDateTime(option.date, slot).getTime() > Date.now()
                  );

                  return (
                    <Pressable
                      key={option.key}
                      disabled={!hasFutureSlot || saving || loadingHours}
                      onPress={() => setSelectedDateKey(option.key)}
                      style={{
                        width: 86,
                        minHeight: 86,
                        borderRadius: 21,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary : colors.background,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        opacity: hasFutureSlot && !loadingHours ? 1 : 0.32,
                      }}
                    >
                      <Text
                        style={{
                          color: selected ? colors.white : colors.muted,
                          fontSize: 11,
                          fontWeight: "900",
                        }}
                      >
                        {option.label}
                      </Text>
                      <Text
                        style={{
                          color: selected ? colors.white : colors.text,
                          fontSize: 18,
                          fontWeight: "900",
                        }}
                      >
                        {option.monthDay}
                      </Text>
                      <Text
                        style={{
                          color: selected ? "rgba(255,255,255,0.78)" : colors.muted,
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
                {emergencyMode ? "Emergency time" : "Time"}
              </Text>
              {loadingHours ? (
                <View style={{ minHeight: 80, alignItems: "center", justifyContent: "center" }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                  {availableTimeSlots.map((slot) => {
                    const selected = slot.index === selectedTimeIndex;

                    return (
                      <Pressable
                        key={`${slot.label}-${slot.index}`}
                        disabled={slot.disabled || saving}
                        onPress={() => setSelectedTimeIndex(slot.index)}
                        style={{
                          minWidth: 94,
                          minHeight: 46,
                          paddingHorizontal: 12,
                          borderRadius: 999,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : colors.background,
                          opacity: slot.disabled ? 0.3 : 1,
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
                </View>
              )}
            </View>

            {selectedDateTime ? (
              <View
                style={{
                  padding: 13,
                  borderRadius: 18,
                  backgroundColor: unchanged ? colors.warningSoft : colors.successSoft,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    color: unchanged ? colors.warning : colors.success,
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {unchanged
                    ? "CHOOSE A DIFFERENT TIME"
                    : emergencyMode
                      ? "NEW EMERGENCY APPOINTMENT"
                      : "NEW APPOINTMENT"}
                </Text>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {formatDateTime(selectedDateTime)}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              padding: 16,
              paddingBottom: 20,
              flexDirection: "row",
              gap: 10,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reschedule"
              disabled={saving}
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 52,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                opacity: saving ? 0.5 : 1,
              })}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>Cancel</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm new appointment date and time"
              accessibilityState={{ disabled: !canConfirm, busy: saving }}
              disabled={!canConfirm}
              onPress={() => {
                if (!selectedDateTime || confirmLockRef.current) return;
                confirmLockRef.current = true;
                onConfirm(selectedDateTime);
              }}
              style={({ pressed }) => ({
                flex: 1.4,
                minHeight: 52,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                backgroundColor: canConfirm
                  ? pressed
                    ? colors.primaryDark
                    : colors.primary
                  : colors.border,
              })}
            >
              {saving ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="calendar-number-outline" size={19} color={colors.white} />
                  <Text style={{ color: colors.white, fontWeight: "900" }}>Confirm</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}