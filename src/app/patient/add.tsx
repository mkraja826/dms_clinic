import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import { uploadPatientProfilePhoto } from "@/lib/patientProfilePhoto";
import {
  observeCapDentPricingV2,
  type CapDentPricingV2Observation,
} from "@/lib/pricingV2";
import {
  ClinicPatientLimitStatus,
  createPatient,
  getClinicPatientLimitStatus,
  searchPatients,
} from "@/lib/supabase";

export default function AddPatientScreen() {
  const [form, setForm] = useState({
    name: "",
    gender: "",
    age: "",
    phone: "",
    email: "",
    address: "",
    emergency_contact: "",
    allergies: "",
    current_medicines: "",
    other_notes: "",
  });
  const [historyFlags, setHistoryFlags] = useState({
    heart_issue: false,
    kidney_issue: false,
    brain_issue: false,
    diabetes: false,
    blood_pressure: false,
  });
  const [features, setFeatures] = useState(DEFAULT_CLINIC_FEATURE_SETTINGS);
  const [limitStatus, setLimitStatus] = useState<ClinicPatientLimitStatus | null>(null);
  const [pricingObservation, setPricingObservation] =
    useState<CapDentPricingV2Observation | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savePatientLockRef = useRef(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadFeatures() {
    try {
      const data = await getClinicFeatureSettings();
      setFeatures(data);
    } catch (error) {
      console.warn("Clinic optional features load failed:", error);
      setFeatures(DEFAULT_CLINIC_FEATURE_SETTINGS);
    }
  }

  async function loadLimitStatus() {
    try {
      const usage = await getClinicPatientLimitStatus();
      setLimitStatus(usage);
    } catch (error) {
      console.warn("Patient limit load failed:", error);
    }
  }

  async function loadPricingObservation() {
    const observation = await observeCapDentPricingV2();
    setPricingObservation(observation);
  }

  useEffect(() => {
    loadFeatures();
    loadLimitStatus();
    loadPricingObservation();
  }, []);

  async function pickPatientPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    setPhotoUri(result.assets[0].uri);
  }

  async function save(skipDuplicateCheck = false, skipLimitWarning = false) {
    if (saving || savePatientLockRef.current) return;

    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert("Required fields", "Full name and phone are required.");
      return;
    }

    savePatientLockRef.current = true;
    setSaving(true);

    try {
      if (!skipLimitWarning) {
        const usage = await getClinicPatientLimitStatus();
        setLimitStatus(usage);

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
            { text: "Continue", onPress: () => void save(skipDuplicateCheck, true) },
          ]);
          return;
        }

        if (usage.level === "notice") {
          Alert.alert("Free patient slots", usage.message);
        }
      }

      const phone = form.phone.trim();

      if (!skipDuplicateCheck) {
        const matches = await searchPatients(phone);
        const duplicate = matches.find((patient) => patient.phone?.trim() === phone);

        if (duplicate) {
          Alert.alert(
            "Phone already exists",
            `This phone number already belongs to ${duplicate.name}. Open that patient first, or continue only if this is a different person sharing the same number.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Existing",
                onPress: () =>
                  router.push({
                    pathname: "/patient/[id]",
                    params: { id: duplicate.id },
                  }),
              },
              {
                text: "Continue Anyway",
                onPress: () => void save(true, true),
              },
            ]
          );
          return;
        }
      }

      const patient = await createPatient({
        name: form.name.trim(),
        gender: form.gender.trim(),
        age: form.age.trim() ? Number(form.age) : undefined,
        phone,
        email: form.email.trim() || undefined,
        address: form.address.trim(),
        emergency_contact: form.emergency_contact.trim(),
        medical_history: {
          ...historyFlags,
          allergies: form.allergies.trim(),
          current_medicines: form.current_medicines.trim(),
          other_notes: form.other_notes.trim(),
        },
      });

      let photoWarning = "";
      if (features.enable_patient_photos && photoUri) {
        try {
          await uploadPatientProfilePhoto(patient.id, photoUri);
        } catch (photoError) {
          console.warn("Patient saved without profile photo:", photoError);
          photoWarning =
            "Patient was created, but the profile photo could not be added. Open the patient and retry only the photo.";
        }
      }

      let nextUsage: ClinicPatientLimitStatus | null = null;
      try {
        nextUsage = await getClinicPatientLimitStatus();
        setLimitStatus(nextUsage);
      } catch (usageError) {
        console.warn("Patient saved, but updated limit status could not load:", usageError);
      }
      void loadPricingObservation();

      if (photoWarning) {
        const usageNotice =
          nextUsage &&
          !nextUsage.unlimited &&
          (nextUsage.level === "notice" || nextUsage.level === "warning")
            ? `\n\n${nextUsage.message}`
            : "";
        Alert.alert("Patient saved", `${photoWarning}${usageNotice}`, [
          { text: "Open Patient", onPress: () => router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }) },
        ]);
        return;
      }

      if (nextUsage && !nextUsage.unlimited && (nextUsage.level === "notice" || nextUsage.level === "warning")) {
        Alert.alert("Patient saved", nextUsage.message, [
          { text: "Open Patient", onPress: () => router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }) },
        ]);
        return;
      }

      router.replace({ pathname: "/patient/[id]", params: { id: patient.id } });
    } catch (error) {
      Alert.alert("Patient save failed", error instanceof Error ? error.message : "Unable to add patient.");
    } finally {
      savePatientLockRef.current = false;
      setSaving(false);
    }
  }

  const observedEntitlements = pricingObservation?.entitlements;
  const observedPatientUsage = observedEntitlements
    ? observedEntitlements.patientLimit === null
      ? `${observedEntitlements.patientCount} patients / unlimited`
      : `${observedEntitlements.patientCount} / ${observedEntitlements.patientLimit} patients`
    : null;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {pricingObservation && pricingObservation.status !== "disabled" ? (
        <SectionCard
          title="V25 Pricing Observation"
          subtitle="Internal preview only. This screen does not block patient registration."
        >
          <Text style={{ color: colors.text, fontWeight: "800" }}>
            {pricingObservation.status === "live"
              ? `${observedEntitlements?.planLabel ?? "Free"} • ${observedPatientUsage}`
              : "Safe fallback active"}
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            {pricingObservation.message}
          </Text>
          {pricingObservation.status === "live" ? (
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              Server-reported enforcement: {observedEntitlements?.patientLimitEnforced ? "enabled" : "disabled"}. Grandfathered: {observedEntitlements?.grandfathered ? "yes" : "no"}.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      {limitStatus && !limitStatus.unlimited && limitStatus.level !== "none" ? (
        <SectionCard
          title={limitStatus.level === "blocked" ? "Free Patient Limit Reached" : "Free Patient Slots"}
          subtitle={limitStatus.message}
        >
          {limitStatus.level === "blocked" ? (
            <AppButton
              title="View Plans"
              icon="card-outline"
              variant="secondary"
              onPress={() => router.push("/settings/subscription" as never)}
            />
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Patient Details" subtitle="Name and phone are required. Add age and contact details if available.">
        {features.enable_patient_photos ? (
          <View style={{ alignItems: "center", gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={photoUri ? "Change patient profile photo" : "Add patient profile photo"}
              onPress={pickPatientPhoto}
              style={{
                width: 108,
                height: 108,
                borderRadius: 36,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              ) : (
                <Text style={{ color: colors.primary, fontWeight: "900", textAlign: "center" }}>
                  Add Photo
                </Text>
              )}
            </Pressable>

            <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 19 }}>
              Optional patient profile photo. Owner can turn this off from Account Settings.
            </Text>
          </View>
        ) : null}

        <AppInput label="Full name" placeholder="Patient full name" value={form.name} onChangeText={(value) => setField("name", value)} />
        <AppInput label="Gender" placeholder="Male / Female / Other" value={form.gender} onChangeText={(value) => setField("gender", value)} />
        <AppInput label="Age" value={form.age} onChangeText={(value) => setField("age", value)} keyboardType="numeric" placeholder="Years" />
        <AppInput label="Phone" placeholder="Patient mobile number" value={form.phone} onChangeText={(value) => setField("phone", value)} keyboardType="phone-pad" />
        <AppInput label="Email optional" value={form.email} onChangeText={(value) => setField("email", value)} keyboardType="email-address" autoCapitalize="none" />
        <AppInput label="Address" value={form.address} onChangeText={(value) => setField("address", value)} multiline />
        <AppInput label="Emergency contact" placeholder="Optional emergency number" value={form.emergency_contact} onChangeText={(value) => setField("emergency_contact", value)} />
      </SectionCard>
      <SectionCard title="Medical History" subtitle="Mark important health conditions now. These can be edited later if patient reveals more.">
        {[
          ["heart_issue", "Heart issue"],
          ["kidney_issue", "Kidney issue"],
          ["brain_issue", "Brain issue"],
          ["diabetes", "Diabetes / sugar"],
          ["blood_pressure", "Blood pressure / BP"],
        ].map(([key, label]) => (
          <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityState={{ checked: historyFlags[key as keyof typeof historyFlags] }}
              value={historyFlags[key as keyof typeof historyFlags]}
              onValueChange={(value) => setHistoryFlags((current) => ({ ...current, [key]: value }))}
              trackColor={{ true: colors.primarySoft, false: colors.border }}
              thumbColor={historyFlags[key as keyof typeof historyFlags] ? colors.primary : "#FFFFFF"}
            />
          </View>
        ))}
        <AppInput label="Allergies" placeholder="Example: Penicillin, painkiller allergy" value={form.allergies} onChangeText={(value) => setField("allergies", value)} />
        <AppInput label="Current medicines" placeholder="Medicines patient is taking" value={form.current_medicines} onChangeText={(value) => setField("current_medicines", value)} />
        <AppInput label="Other notes" placeholder="Any other medical notes" value={form.other_notes} onChangeText={(value) => setField("other_notes", value)} multiline />
      </SectionCard>
      <AppButton title="Register Patient" icon="person-add-outline" onPress={() => save()} loading={saving} />
    </ScrollView>
  );
}
