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
import {
  analyticsPlan,
  logCapDentAnalyticsEvent,
} from "@/lib/firebaseAnalytics";
import { uploadPatientProfilePhoto } from "@/lib/patientProfilePhoto";
import {
  getCapDentEntitlementsV25,
  patientQuotaMessage,
} from "@/lib/pricingV25";
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

  useEffect(() => {
    loadFeatures();
    loadLimitStatus();
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
      const serverEntitlements = await getCapDentEntitlementsV25();
      const serverQuotaMessage = patientQuotaMessage(serverEntitlements);

      if (serverQuotaMessage) {
        void logCapDentAnalyticsEvent("capdent_quota_blocked", {
          resource: "patient",
          plan: analyticsPlan(serverEntitlements.plan),
        });
        Alert.alert("Patient capacity reached", serverQuotaMessage, [
          { text: "Cancel", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
        ]);
        return;
      }

      if (!skipLimitWarning) {
        const usage = await getClinicPatientLimitStatus();
        setLimitStatus(usage);

        if (usage.level === "blocked") {
          Alert.alert("Patient capacity reached", usage.message, [
            { text: "Cancel", style: "cancel" },
            { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
          ]);
          return;
        }

        if (usage.level === "warning") {
          Alert.alert("Patient capacity running low", usage.message, [
            { text: "Cancel", style: "cancel" },
            { text: "Continue", onPress: () => void save(skipDuplicateCheck, true) },
          ]);
          return;
        }

        if (usage.level === "notice") {
          Alert.alert("Patient capacity", usage.message);
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

      const profilePhotoRequested = Boolean(features.enable_patient_photos && photoUri);
      void logCapDentAnalyticsEvent("capdent_patient_registered", {
        profile_photo_requested: profilePhotoRequested,
      });

      let photoWarning = "";
      if (profilePhotoRequested && photoUri) {
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

      if (photoWarning) {
        const usageNotice =
          nextUsage &&
          !nextUsage.unlimited &&
          (nextUsage.level === "notice" || nextUsage.level === "warning")
            ? `\n\n${nextUsage.message}`
            : "";
        Alert.alert("Patient saved", `${photoWarning}${usageNotice}`, [
          {
            text: "Open Patient",
            onPress: () =>
              router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }),
          },
        ]);
        return;
      }

      if (
        nextUsage &&
        !nextUsage.unlimited &&
        (nextUsage.level === "notice" || nextUsage.level === "warning")
      ) {
        Alert.alert("Patient saved", nextUsage.message, [
          {
            text: "Open Patient",
            onPress: () =>
              router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }),
          },
        ]);
        return;
      }

      router.replace({ pathname: "/patient/[id]", params: { id: patient.id } });
    } catch (error) {
      Alert.alert(
        "Patient save failed",
        error instanceof Error ? error.message : "Unable to add patient."
      );
    } finally {
      savePatientLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      {limitStatus && !limitStatus.unlimited && limitStatus.level !== "none" ? (
        <SectionCard
          title={limitStatus.level === "blocked" ? "Patient Capacity Reached" : "Patient Capacity"}
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

      <SectionCard
        title="Patient Details"
        subtitle="Only name and phone are required. Clinical details can be added now or during the visit."
      >
        <AppInput
          label="Full name *"
          value={form.name}
          onChangeText={(value) => setField("name", value)}
          autoCapitalize="words"
          placeholder="Patient name"
        />

        <AppInput
          label="Phone *"
          value={form.phone}
          onChangeText={(value) => setField("phone", value)}
          keyboardType="phone-pad"
          placeholder="Phone number"
        />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <AppInput
              label="Age"
              value={form.age}
              onChangeText={(value) => setField("age", value.replace(/[^0-9]/g, "").slice(0, 3))}
              keyboardType="number-pad"
              placeholder="Age"
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppInput
              label="Gender"
              value={form.gender}
              onChangeText={(value) => setField("gender", value)}
              placeholder="Gender"
            />
          </View>
        </View>

        <AppInput
          label="Email"
          value={form.email}
          onChangeText={(value) => setField("email", value)}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="Optional email"
        />

        <AppInput
          label="Address"
          value={form.address}
          onChangeText={(value) => setField("address", value)}
          placeholder="Address"
          multiline
        />

        <AppInput
          label="Emergency contact"
          value={form.emergency_contact}
          onChangeText={(value) => setField("emergency_contact", value)}
          keyboardType="phone-pad"
          placeholder="Optional contact"
        />
      </SectionCard>

      <SectionCard
        title="Medical History"
        subtitle="Quick flags plus optional notes for allergies and current medicines."
      >
        {(
          [
            ["heart_issue", "Heart issue"],
            ["kidney_issue", "Kidney issue"],
            ["brain_issue", "Brain issue"],
            ["diabetes", "Diabetes"],
            ["blood_pressure", "Blood pressure"],
          ] as const
        ).map(([key, label]) => (
          <View
            key={key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: 48,
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", flex: 1 }}>{label}</Text>
            <Switch
              value={historyFlags[key]}
              onValueChange={(value) =>
                setHistoryFlags((current) => ({ ...current, [key]: value }))
              }
              trackColor={{ false: colors.border, true: colors.primarySoft }}
              thumbColor={historyFlags[key] ? colors.primary : colors.muted}
            />
          </View>
        ))}

        <AppInput
          label="Allergies"
          value={form.allergies}
          onChangeText={(value) => setField("allergies", value)}
          placeholder="Allergies or none known"
          multiline
        />

        <AppInput
          label="Current medicines"
          value={form.current_medicines}
          onChangeText={(value) => setField("current_medicines", value)}
          placeholder="Current medicines"
          multiline
        />

        <AppInput
          label="Other notes"
          value={form.other_notes}
          onChangeText={(value) => setField("other_notes", value)}
          placeholder="Optional medical notes"
          multiline
        />
      </SectionCard>

      {features.enable_patient_photos ? (
        <SectionCard
          title="Profile Photo"
          subtitle="Optional. The patient record saves even if the photo upload fails."
        >
          {photoUri ? (
            <View style={{ gap: 10 }}>
              <Image
                source={{ uri: photoUri }}
                style={{ width: 132, height: 132, borderRadius: 28, alignSelf: "center" }}
              />
              <AppButton
                title="Change Photo"
                icon="images-outline"
                variant="secondary"
                onPress={pickPatientPhoto}
              />
              <Pressable onPress={() => setPhotoUri(null)} style={{ alignItems: "center", padding: 8 }}>
                <Text style={{ color: colors.danger, fontWeight: "900" }}>Remove Photo</Text>
              </Pressable>
            </View>
          ) : (
            <AppButton
              title="Choose Profile Photo"
              icon="images-outline"
              variant="secondary"
              onPress={pickPatientPhoto}
            />
          )}
        </SectionCard>
      ) : null}

      <AppButton
        title="Save Patient"
        icon="save-outline"
        onPress={() => void save()}
        loading={saving}
      />
    </ScrollView>
  );
}
