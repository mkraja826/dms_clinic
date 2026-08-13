import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
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
  age?: number | null;
  gender?: string | null;
};

type MedicalHistoryRow = {
  id?: string;
  patient_id?: string;
  heart_issue?: boolean | null;
  kidney_issue?: boolean | null;
  brain_issue?: boolean | null;
  diabetes?: boolean | null;
  blood_pressure?: boolean | null;
  allergies?: string | null;
  current_medicines?: string | null;
  other_notes?: string | null;
};

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

export default function EditMedicalHistoryScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const patientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [heartIssue, setHeartIssue] = useState(false);
  const [kidneyIssue, setKidneyIssue] = useState(false);
  const [brainIssue, setBrainIssue] = useState(false);
  const [diabetes, setDiabetes] = useState(false);
  const [bloodPressure, setBloodPressure] = useState(false);

  const [allergies, setAllergies] = useState("");
  const [currentMedicines, setCurrentMedicines] = useState("");
  const [otherNotes, setOtherNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveHistoryLockRef = useRef(false);

  async function load() {
    if (!patientId) {
      Alert.alert("Patient missing", "Open this screen from patient profile or visit screen.");
      router.back();
      return;
    }

    try {
      setLoading(true);

      const { data: patientData, error: patientError } = await supabase
        .from("patients")
        .select("id,name,phone,age,gender")
        .eq("id", patientId)
        .maybeSingle();

      if (patientError) throw patientError;

      setPatient(patientData as PatientRow | null);

      const { data: historyData, error: historyError } = await supabase
        .from("medical_history")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();

      if (historyError) throw historyError;

      const history = historyData as MedicalHistoryRow | null;

      setHeartIssue(Boolean(history?.heart_issue));
      setKidneyIssue(Boolean(history?.kidney_issue));
      setBrainIssue(Boolean(history?.brain_issue));
      setDiabetes(Boolean(history?.diabetes));
      setBloodPressure(Boolean(history?.blood_pressure));

      setAllergies(history?.allergies || "");
      setCurrentMedicines(history?.current_medicines || "");
      setOtherNotes(history?.other_notes || "");
    } catch (error) {
      Alert.alert("Medical history load failed", getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [patientId]);

  async function save() {
    if (saving || saveHistoryLockRef.current) return;

    if (!patientId) {
      Alert.alert("Patient missing", "Open this screen from patient profile or visit screen.");
      return;
    }

    saveHistoryLockRef.current = true;
    setSaving(true);

    try {
      const { error } = await supabase.rpc("upsert_patient_medical_history", {
        p_patient_id: patientId,
        p_heart_issue: heartIssue,
        p_kidney_issue: kidneyIssue,
        p_brain_issue: brainIssue,
        p_diabetes: diabetes,
        p_blood_pressure: bloodPressure,
        p_allergies: allergies.trim() || null,
        p_current_medicines: currentMedicines.trim() || null,
        p_other_notes: otherNotes.trim() || null,
      });

      if (error) throw error;

      Alert.alert("Saved", "Medical history updated successfully.", [
        {
          text: "Open Patient",
          onPress: () => router.replace(`/patient/${patientId}` as never),
        },
        {
          text: "Continue Editing",
        },
      ]);
    } catch (error) {
      Alert.alert("Save failed", getErrorMessage(error));
    } finally {
      saveHistoryLockRef.current = false;
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <Text style={{ color: colors.muted }}>Loading medical history...</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Medical History
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Edit anytime when patient reveals new information to reception or doctor.
        </Text>
      </View>

      {patient ? (
        <SectionCard>
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
                {patient.age ? ` • ${patient.age} yrs` : ""}
                {patient.gender ? ` • ${patient.gender}` : ""}
              </Text>
            </View>

            <StatusBadge label="Editable" tone="success" />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Health Conditions">
        <HealthToggle
          title="Heart issue"
          subtitle="Heart disease, surgery, chest pain, blood thinner etc."
          value={heartIssue}
          onPress={() => setHeartIssue((current) => !current)}
        />

        <HealthToggle
          title="Kidney issue"
          subtitle="Kidney disease, dialysis, kidney medicines etc."
          value={kidneyIssue}
          onPress={() => setKidneyIssue((current) => !current)}
        />

        <HealthToggle
          title="Brain / neuro issue"
          subtitle="Fits, stroke, epilepsy, neurological condition etc."
          value={brainIssue}
          onPress={() => setBrainIssue((current) => !current)}
        />

        <HealthToggle
          title="Diabetes / sugar"
          subtitle="Diabetic patient or sugar medicines."
          value={diabetes}
          onPress={() => setDiabetes((current) => !current)}
        />

        <HealthToggle
          title="Blood pressure / BP"
          subtitle="High BP, low BP or BP tablets."
          value={bloodPressure}
          onPress={() => setBloodPressure((current) => !current)}
        />
      </SectionCard>

      <SectionCard title="Notes">
        <AppInput
          label="Allergies"
          value={allergies}
          onChangeText={setAllergies}
          placeholder="Medicine allergy, latex allergy, food allergy..."
          multiline
        />

        <AppInput
          label="Current medicines"
          value={currentMedicines}
          onChangeText={setCurrentMedicines}
          placeholder="BP tablets, sugar tablets, blood thinners..."
          multiline
        />

        <AppInput
          label="Other important notes"
          value={otherNotes}
          onChangeText={setOtherNotes}
          placeholder="Pregnancy, asthma, previous dental complications..."
          multiline
        />
      </SectionCard>

      <AppButton
        title="Save Medical History"
        icon="save-outline"
        onPress={save}
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

function HealthToggle({
  title,
  subtitle,
  value,
  onPress,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value }}
      onPress={onPress}
      style={{
        minHeight: 72,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: value ? colors.primary : colors.border,
        backgroundColor: value ? colors.primarySoft : colors.background,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 16,
          backgroundColor: value ? colors.primary : colors.surfaceSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={value ? "checkmark-outline" : "add-outline"}
          size={22}
          color={value ? colors.white : colors.muted}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {title}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 18 }}>
          {subtitle}
        </Text>
      </View>

      <Text
        style={{
          color: value ? colors.primary : colors.muted,
          fontWeight: "900",
        }}
      >
        {value ? "YES" : "NO"}
      </Text>
    </Pressable>
  );
}
