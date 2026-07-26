import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  DEFAULT_OP_FEE_AMOUNT,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import { searchPatientsPage } from "@/lib/patientDirectory";
import { uploadPatientProfilePhoto } from "@/lib/patientProfilePhoto";
import { getClinicPatientLimitStatus, Patient, supabase } from "@/lib/supabase";

type Mode = "existing" | "new";
type OpFeeStatus = "paid" | "pending" | "waived";

const PAYMENT_METHODS = ["Cash", "UPI", "Card"];
const WAIVER_REASONS = ["Known person", "Review patient", "Doctor waived", "Free camp", "Other"];

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function money(value: string | number) {
  return `Rs. ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const err = error as { message?: string; details?: string; hint?: string; code?: string };
    return [err.message, err.details, err.hint, err.code ? `Code: ${err.code}` : ""].filter(Boolean).join("\n");
  }

  return "Unknown error";
}

export default function ReceptionCheckinScreen() {
  const [mode, setMode] = useState<Mode>("existing");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [patientPhotosEnabled, setPatientPhotosEnabled] = useState(
    DEFAULT_CLINIC_FEATURE_SETTINGS.enable_patient_photos
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [clinicOpFee, setClinicOpFee] = useState(DEFAULT_OP_FEE_AMOUNT);
  const [opAmount, setOpAmount] = useState(String(DEFAULT_OP_FEE_AMOUNT));
  const [opStatus, setOpStatus] = useState<OpFeeStatus>("paid");
  const [waiverReason, setWaiverReason] = useState("Doctor waived");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const [loadingPatients, setLoadingPatients] = useState(true);
  const [saving, setSaving] = useState(false);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const checkInLockRef = useRef(false);

  async function loadPatients(searchText = patientSearch, refreshSettings = false) {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const [patientResult, clinicSettings] = await Promise.all([
        searchPatientsPage({
          query: searchText,
          page: 1,
          pageSize: 12,
        }),
        refreshSettings
          ? getClinicFeatureSettings().catch(() => DEFAULT_CLINIC_FEATURE_SETTINGS)
          : Promise.resolve(null),
      ]);

      if (requestId !== patientRequestRef.current) return;

      if (clinicSettings) {
        const nextOpFee = Math.round(Number(clinicSettings.op_fee_amount || DEFAULT_OP_FEE_AMOUNT));
        setClinicOpFee(nextOpFee);
        setOpAmount(String(nextOpFee));
        setPatientPhotosEnabled(Boolean(clinicSettings.enable_patient_photos));
      }

      setPatients(patientResult.patients);
    } catch (error) {
      Alert.alert("Patients load failed", getErrorMessage(error));
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }

  useEffect(() => {
    void loadPatients("", true);
  }, []);

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

  async function pickPatientPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;
    setPhotoUri(result.assets[0].uri);
  }

  function resetPatientSelection(nextMode: Mode) {
    setMode(nextMode);
    setSelectedPatientId("");
    setPatientSearch("");
    setPhotoUri(null);
  }

  function clearForm() {
    setSelectedPatientId("");
    setPatientSearch("");
    setName("");
    setPhone("");
    setAge("");
    setGender("");
    setAddress("");
    setPhotoUri(null);
    setOpAmount(String(clinicOpFee));
    setOpStatus("paid");
    setWaiverReason("Doctor waived");
    setPaymentMethod("Cash");
    void loadPatients("", true);
  }

  async function checkIn(skipLimitWarning = false) {
    if (saving || checkInLockRef.current) return;

    const fee = toNumber(opAmount);

    if (opStatus !== "waived" && fee <= 0) {
      Alert.alert("Invalid OP fee", "Enter OP fee amount or mark it waived.");
      return;
    }

    if (opStatus === "waived" && !waiverReason.trim()) {
      Alert.alert("Waiver reason required", "Select why OP fee is waived.");
      return;
    }

    if (mode === "existing" && !selectedPatientId) {
      Alert.alert("Patient missing", "Select an existing patient first.");
      return;
    }

    if (mode === "new" && !name.trim()) {
      Alert.alert("Name required", "Enter patient name.");
      return;
    }

    checkInLockRef.current = true;
    setSaving(true);

    try {
      if (mode === "new" && !skipLimitWarning) {
        const usage = await getClinicPatientLimitStatus();

        if (usage.level === "blocked") {
          Alert.alert("Free patient limit reached", usage.message, [
            { text: "Cancel", style: "cancel" },
            { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
          ]);
          return;
        }

        if (usage.level === "warning") {
          Alert.alert("Free patient slots low", usage.message, [
            { text: "Cancel", style: "cancel" },
            { text: "Continue", onPress: () => void checkIn(true) },
          ]);
          return;
        }

        if (usage.level === "notice") {
          Alert.alert("Free patient slots", usage.message);
        }
      }

      setSaving(true);
      const { data, error } = await supabase.rpc("reception_quick_checkin", {
        p_patient_id: mode === "existing" ? selectedPatientId : null,
        p_name: mode === "new" ? name.trim() : null,
        p_phone: mode === "new" ? phone.trim() || null : null,
        p_age: mode === "new" && age ? Number(age) : null,
        p_gender: mode === "new" ? gender.trim() || null : null,
        p_address: mode === "new" ? address.trim() || null : null,
        p_op_amount: opStatus === "waived" ? 0 : fee,
        p_op_status: opStatus,
        p_waiver_reason: opStatus === "waived" ? waiverReason.trim() : null,
        p_payment_method: opStatus === "paid" ? paymentMethod : null,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const patientId = result?.patient_id || selectedPatientId;
      let limitNotice = "";
      let photoNotice = "";

      if (mode === "new" && patientPhotosEnabled && photoUri && patientId) {
        try {
          await uploadPatientProfilePhoto(patientId, photoUri);
          photoNotice = "\n\nPatient photo added.";
        } catch (photoError) {
          console.warn("Reception patient photo upload failed:", photoError);
          photoNotice = "\n\nPatient checked in, but the photo could not upload. Add it later from Edit details.";
        }
      }

      if (mode === "new") {
        const nextUsage = await getClinicPatientLimitStatus();
        if (!nextUsage.unlimited && (nextUsage.level === "notice" || nextUsage.level === "warning")) {
          limitNotice = `\n\n${nextUsage.message}`;
        }
      }

      const message =
        opStatus === "paid"
          ? `OP fee ${money(fee)} collected. Patient is now in doctor's waiting queue.${photoNotice}${limitNotice}`
          : opStatus === "pending"
          ? `OP fee ${money(fee)} marked pending. Patient is now in doctor's waiting queue.${photoNotice}${limitNotice}`
          : `OP fee waived: ${waiverReason}. Patient is now in doctor's waiting queue.${photoNotice}${limitNotice}`;

      Alert.alert("Patient checked in", message, [
        {
          text: "Open Patient",
          onPress: () => router.replace(`/patient/${patientId}` as never),
        },
        {
          text: "Check-in Another",
          onPress: clearForm,
        },
      ]);
    } catch (error) {
      Alert.alert("Check-in failed", getErrorMessage(error));
    } finally {
      checkInLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen refreshing={loadingPatients} onRefresh={() => loadPatients(patientSearch, true)}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>Quick Check-in</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Register or select patient, handle OP fee, and send to doctor queue.
        </Text>
      </View>

      <SectionCard title="Patient Type" subtitle="Choose existing patient for repeat visit or quickly register a new patient.">
        <View style={{ flexDirection: "row", gap: 10 }}>
          <ModeButton title="Existing" icon="search-outline" selected={mode === "existing"} onPress={() => resetPatientSelection("existing")} />
          <ModeButton title="New Patient" icon="person-add-outline" selected={mode === "new"} onPress={() => resetPatientSelection("new")} />
        </View>
      </SectionCard>

      {mode === "existing" ? (
        <SectionCard title="Select Patient" subtitle="Search existing patients by name, phone, or patient ID.">
          {selectedPatient ? (
            <View style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>{selectedPatient.name}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>{selectedPatient.phone || "No phone"}</Text>
                </View>
                <StatusBadge label="Selected" tone="success" />
              </View>
              <AppButton title="Change Patient" icon="swap-horizontal-outline" variant="secondary" onPress={() => setSelectedPatientId("")} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ minHeight: 54, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 }}>
                <Ionicons name="search-outline" size={21} color={colors.muted} />
                <TextInput
                  value={patientSearch}
                  onChangeText={setPatientSearch}
                  placeholder="Search patient name, phone, or ID"
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, minHeight: 54, color: colors.text, fontSize: 16 }}
                />
              </View>

              {loadingPatients ? (
                <Text style={{ color: colors.muted }}>Loading patients...</Text>
              ) : filteredPatients.length ? (
                <View style={{ gap: 10 }}>
                  {filteredPatients.map((patient) => (
                    <Pressable
                      key={patient.id}
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
                      <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="person-outline" size={21} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                        <Text style={{ color: colors.muted, marginTop: 2 }}>{patient.phone || "No phone"}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <EmptyState title="No patients found" message="Switch to New Patient to register quickly." icon="search-outline" />
              )}
            </View>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Register New Patient" subtitle="Enter only the minimum details needed for quick clinic entry.">
          {patientPhotosEnabled ? (
            <View style={{ alignItems: "flex-end" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={photoUri ? "Change patient photo" : "Add patient photo"}
                onPress={pickPatientPhoto}
                style={({ pressed }) => ({
                  width: 52,
                  height: 52,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: photoUri ? colors.primary : colors.border,
                  backgroundColor: pressed ? colors.surfaceSoft : colors.primarySoft,
                  overflow: "hidden",
                  alignItems: "center",
                  justifyContent: "center",
                })}
              >
                {photoUri ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="person-add-outline" size={25} color={colors.primary} />
                )}
              </Pressable>
            </View>
          ) : null}
          <AppInput label="Patient Name" value={name} onChangeText={setName} placeholder="Patient name" />
          <AppInput label="Phone" value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" />
          <AppInput label="Age" value={age} onChangeText={setAge} placeholder="Age" keyboardType="numeric" />
          <AppInput label="Gender" value={gender} onChangeText={setGender} placeholder="Optional" />
          <AppInput label="Address" value={address} onChangeText={setAddress} placeholder="Optional" multiline />
        </SectionCard>
      )}

      <SectionCard title="OP Fee" subtitle="Default amount comes from clinic settings. Reception can still edit per patient.">
        <View style={{ padding: 16, borderRadius: 24, backgroundColor: opStatus === "waived" ? colors.warningSoft : colors.successSoft, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.muted, fontWeight: "800" }}>OP Fee</Text>
          <Text style={{ color: colors.text, fontSize: 42, fontWeight: "900" }}>
            {opStatus === "waived" ? "Waived" : money(opAmount)}
          </Text>
          <Text style={{ color: opStatus === "waived" ? colors.warning : colors.success, fontWeight: "900" }}>
            {opStatus === "paid" ? `Clinic default: ${money(clinicOpFee)}` : opStatus === "pending" ? "Creates pending OP balance" : "Recorded with waiver reason"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          {(["paid", "pending", "waived"] as OpFeeStatus[]).map((status) => {
            const selected = opStatus === status;
            return (
              <Pressable
                key={status}
                onPress={() => setOpStatus(status)}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>
                  {status[0].toUpperCase() + status.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {opStatus !== "waived" ? (
          <AppInput
            label="OP Amount"
            value={opAmount}
            onChangeText={setOpAmount}
            keyboardType="numeric"
            placeholder={String(clinicOpFee)}
            helper="Default comes from clinic settings, but reception can edit it for this patient."
          />
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.text, fontWeight: "900" }}>Waiver Reason</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {WAIVER_REASONS.map((reason) => {
                const selected = waiverReason === reason;
                return (
                  <Pressable
                    key={reason}
                    onPress={() => setWaiverReason(reason)}
                    style={{
                      minHeight: 40,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : colors.background,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "900", fontSize: 12 }}>{reason}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {opStatus === "paid" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            {PAYMENT_METHODS.map((method) => {
              const selected = paymentMethod === method;
              return (
                <Pressable
                  key={method}
                  onPress={() => setPaymentMethod(method)}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.background,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>{method}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <AppButton
          title={opStatus === "paid" ? "Collect OP Fee & Send to Doctor" : opStatus === "pending" ? "Mark OP Pending & Send to Doctor" : "Waive OP Fee & Send to Doctor"}
          icon="send-outline"
          onPress={checkIn}
          loading={saving}
        />
      </SectionCard>

      <AppButton title="Back" icon="arrow-back-outline" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function ModeButton({
  title,
  icon,
  selected,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 74,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : colors.background,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Ionicons name={icon} size={23} color={selected ? colors.white : colors.primary} />
      <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>{title}</Text>
    </Pressable>
  );
}
