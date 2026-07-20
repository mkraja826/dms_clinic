import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { colors } from "@/constants/colors";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import { uploadPatientProfilePhoto } from "@/lib/patientProfilePhoto";
import {
  getPatientById,
  Patient,
  searchPatients,
  updatePatientWithAudit,
} from "@/lib/supabase";

type PatientWithPhoto = Patient & { photo_url?: string | null };

function ageNumber(value: string) {
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function EditPatientScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const patientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [patient, setPatient] = useState<PatientWithPhoto | null>(null);
  const [features, setFeatures] = useState(DEFAULT_CLINIC_FEATURE_SETTINGS);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    age: "",
    gender: "",
    address: "",
    reason: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

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

  async function load() {
    if (!patientId) return;

    try {
      setLoading(true);
      const [data, featureSettings] = await Promise.all([
        getPatientById(patientId),
        getClinicFeatureSettings().catch((error) => {
          console.warn("Patient edit optional features load failed:", error);
          return DEFAULT_CLINIC_FEATURE_SETTINGS;
        }),
      ]);
      const current = data.patient as PatientWithPhoto;
      setFeatures(featureSettings);
      setPatient(current);
      setPhotoUri(null);
      setForm({
        name: current.name ?? "",
        phone: current.phone ?? "",
        age: current.age ? String(current.age) : "",
        gender: current.gender ?? "",
        address: current.address ?? "",
        reason: "",
      });
    } catch (error) {
      Alert.alert("Patient load failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [patientId]);

  async function save(skipDuplicateCheck = false) {
    if (!patient) return;

    if (!form.name.trim()) {
      Alert.alert("Name required", "Patient name cannot be blank.");
      return;
    }

    const nextPhone = form.phone.trim();
    if (nextPhone && nextPhone !== (patient.phone ?? "").trim() && !skipDuplicateCheck) {
      setSaving(true);
      try {
        const matches = await searchPatients(nextPhone);
        const duplicate = matches.find(
          (row) => row.id !== patient.id && row.phone?.trim() === nextPhone
        );

        if (duplicate) {
          Alert.alert(
            "Phone already exists",
            `This phone number already belongs to ${duplicate.name}. Continue?`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Continue", onPress: () => save(true) },
            ]
          );
          return;
        }
      } catch (error) {
        Alert.alert("Duplicate check failed", error instanceof Error ? error.message : "Please try again.");
        return;
      } finally {
        setSaving(false);
      }
    }

    setSaving(true);
    try {
      await updatePatientWithAudit(
        patient.id,
        {
          name: form.name.trim(),
          phone: nextPhone || null,
          age: form.age.trim() ? ageNumber(form.age) : null,
          gender: form.gender.trim() || null,
          address: form.address.trim() || null,
        },
        form.reason.trim()
      );

      if (features.enable_patient_photos && photoUri) {
        await uploadPatientProfilePhoto(patient.id, photoUri);
      }

      Alert.alert("Patient updated", "Patient details were saved.", [
        { text: "Open Profile", onPress: () => router.replace(`/patient/${patient.id}` as never) },
      ]);
    } catch (error) {
      Alert.alert("Save failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen refreshing={loading} onRefresh={load}>
        <Text style={{ color: colors.muted }}>Loading patient...</Text>
      </Screen>
    );
  }

  if (!patient) {
    return (
      <Screen refreshing={loading} onRefresh={load}>
        <EmptyState title="Patient not found" message="Go back and search again." icon="person-circle-outline" />
      </Screen>
    );
  }

  const photoPreview = photoUri || patient.photo_url || "";

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Edit Patient Details
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Correct patient details carefully. Changes are saved with audit reason for owner review.
        </Text>
      </View>

      {features.enable_patient_photos ? (
        <SectionCard title="Patient Photo" subtitle="Optional profile photo controlled by clinic owner setting.">
          <View style={{ alignItems: "center", gap: 10 }}>
            <Pressable
              onPress={pickPatientPhoto}
              style={{
                width: 112,
                height: 112,
                borderRadius: 38,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {photoPreview ? (
                <SecureStorageImage uri={photoPreview} style={{ width: "100%", height: "100%" }} contentFit="cover" />
              ) : (
                <Text style={{ color: colors.primary, fontWeight: "900", textAlign: "center" }}>
                  Add Photo
                </Text>
              )}
            </Pressable>
            <AppButton
              title={photoPreview ? "Change Photo" : "Select Photo"}
              icon="image-outline"
              variant="secondary"
              onPress={pickPatientPhoto}
            />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Patient Details" subtitle="Update only confirmed details. Add reason when changing phone, age, or address.">
        <AppInput label="Name" placeholder="Patient full name" value={form.name} onChangeText={(value) => setField("name", value)} />
        <AppInput label="Phone" placeholder="Patient mobile number" value={form.phone} onChangeText={(value) => setField("phone", value)} keyboardType="phone-pad" />
        <AppInput label="Age" placeholder="Years" value={form.age} onChangeText={(value) => setField("age", value)} keyboardType="numeric" />
        <AppInput label="Gender" placeholder="Male / Female / Other" value={form.gender} onChangeText={(value) => setField("gender", value)} />
        <AppInput label="Address" placeholder="Patient address" value={form.address} onChangeText={(value) => setField("address", value)} multiline />
        <AppInput
          label="Reason optional"
          value={form.reason}
          onChangeText={(value) => setField("reason", value)}
          placeholder="Example: patient corrected phone number"
          multiline
        />
      </SectionCard>

      <AppButton title="Save Changes" icon="checkmark-circle-outline" onPress={() => save()} loading={saving} />
      <AppButton title="Cancel" icon="arrow-back-outline" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
