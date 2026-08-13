import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  getMedicationSuggestions,
  getRecentPatientMedications,
  MedicationSuggestion,
  PatientMedicationEntry,
  savePatientMedication,
} from "@/lib/patientMedications";
import { searchPatientsPage } from "@/lib/patientDirectory";
import { getDashboardPath, Patient, supabase } from "@/lib/supabase";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "Please try again.";
}

export default function PatientMedicationsScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const incomingPatientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [enabled, setEnabled] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(incomingPatientId);
  const [patientSearch, setPatientSearch] = useState("");
  const [suggestions, setSuggestions] = useState<MedicationSuggestion[]>([]);
  const [recent, setRecent] = useState<PatientMedicationEntry[]>([]);

  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [saving, setSaving] = useState(false);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const saveMedicationLockRef = useRef(false);

  const homePath = getDashboardPath(profile?.role ?? "receptionist");

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  const filteredPatients = patients;

  function exitScreen() {
    if (selectedPatientId) {
      router.replace(`/patient/${selectedPatientId}` as never);
      return;
    }

    router.replace(homePath as never);
  }

  async function loadPatientOptions(searchText = patientSearch) {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({
        query: searchText,
        page: 1,
        pageSize: 12,
      });
      let rows = result.patients;

      if (incomingPatientId && !rows.some((patient) => patient.id === incomingPatientId)) {
        const { data, error } = await supabase
          .from("patients")
          .select("*")
          .eq("id", incomingPatientId)
          .maybeSingle<Patient>();

        if (error) throw error;
        if (data) rows = [data, ...rows];
      }

      if (requestId === patientRequestRef.current) {
        setPatients(rows);
        if (incomingPatientId) setSelectedPatientId(incomingPatientId);
      }
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }

  async function load() {
    try {
      setLoading(true);
      const [featureSettings, suggestionRows, recentRows] = await Promise.all([
        getClinicFeatureSettings().catch(() => DEFAULT_CLINIC_FEATURE_SETTINGS),
        getMedicationSuggestions(),
        getRecentPatientMedications(incomingPatientId || undefined),
      ]);

      setEnabled(featureSettings.enable_prescription_medications);
      setSuggestions(suggestionRows);
      setRecent(recentRows);
      await loadPatientOptions(patientSearch);
    } catch (error) {
      Alert.alert("Medication screen failed", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [incomingPatientId]);

  useEffect(() => {
    if (!patientSearchMountedRef.current) {
      patientSearchMountedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      void loadPatientOptions(patientSearch).catch((error) => {
        Alert.alert("Patients load failed", errorMessage(error));
      });
    }, 260);

    return () => clearTimeout(timeout);
  }, [patientSearch]);

  async function refreshSuggestions(nextName = medicationName) {
    try {
      const rows = await getMedicationSuggestions(nextName);
      setSuggestions(rows);
    } catch (error) {
      console.warn("Medication suggestions failed:", error);
    }
  }

  function pickSuggestion(item: MedicationSuggestion) {
    setMedicationName(item.name);
  }

  function clearForm(keepPatient = true) {
    setMedicationName("");
    setDosage("");
    setFrequency("");
    setDuration("");
    setInstructions("");
    if (!keepPatient) {
      setSelectedPatientId("");
      setPatientSearch("");
    }
  }

  async function save() {
    if (saving || saveMedicationLockRef.current) return;

    if (!enabled) {
      Alert.alert("Disabled by owner", "Clinic owner has turned off prescribed tablets section.");
      return;
    }

    if (!selectedPatientId) {
      Alert.alert("Patient missing", "Select patient first.");
      return;
    }

    if (!medicationName.trim()) {
      Alert.alert("Tablet name required", "Enter tablet or medicine name.");
      return;
    }

    saveMedicationLockRef.current = true;
    setSaving(true);

    try {
      await savePatientMedication({
        patient_id: selectedPatientId,
        medication_name: medicationName,
        dosage,
        frequency,
        duration,
        instructions,
      });

      Alert.alert("Medication saved", "Prescribed tablet entry was saved for this patient.", [
        { text: "Open Patient", onPress: () => router.push(`/patient/${selectedPatientId}` as never) },
        { text: "Add Another", onPress: () => clearForm(true) },
      ]);

      clearForm(true);
      try {
        const [suggestionRows, recentRows] = await Promise.all([
          getMedicationSuggestions(),
          getRecentPatientMedications(selectedPatientId),
        ]);
        setSuggestions(suggestionRows);
        setRecent(recentRows);
      } catch (refreshError) {
        console.warn("Medication saved, but recent entries could not refresh:", refreshError);
      }
    } catch (error) {
      Alert.alert("Save failed", errorMessage(error));
    } finally {
      saveMedicationLockRef.current = false;
      setSaving(false);
    }
  }

  if (!loading && !enabled) {
    return (
      <Screen refreshing={loading} onRefresh={load}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
            Prescribed Tablets
          </Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
            This optional section is controlled by the clinic owner.
          </Text>
        </View>

        <SectionCard>
          <EmptyState
            title="Medication section is off"
            message="Ask the clinic owner to enable Prescribed tablets section in Account Settings. Medication fee collection is still separate."
            icon="medical-outline"
          />
        </SectionCard>

        <AppButton title="Back" icon="arrow-back-outline" variant="ghost" onPress={exitScreen} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Prescribed Tablets
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Receptionist can enter tablets prescribed by the doctor. Repeated medicines appear below for quick selection.
        </Text>
      </View>

      <SectionCard title="Select Patient" subtitle="Confirm the patient before adding prescribed tablets.">
        {selectedPatient ? (
          <View style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="person-circle-outline" size={30} color={colors.primary} />
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
              <TextInput accessibilityLabel="Search patients" value={patientSearch} onChangeText={setPatientSearch} placeholder="Search patient name, phone, or ID" placeholderTextColor={colors.muted} style={{ flex: 1, minHeight: 54, color: colors.text, fontSize: 16 }} />
            </View>

            {loadingPatients ? (
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
                    <Ionicons name="person-outline" size={22} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                      <Text style={{ color: colors.muted, marginTop: 2 }}>{patient.phone || "No phone"}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyState title="No patients found" message="Register the patient first, then add prescribed tablets." icon="search-outline" />
            )}
          </View>
        )}
      </SectionCard>

      <SectionCard title="Tablet / Medicine" subtitle="Repeated medicine names will appear as quick choices after use.">
        {suggestions.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {suggestions.slice(0, 12).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Use medicine ${item.name}`}
                onPress={() => pickSuggestion(item)}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: colors.primarySoft,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: "900" }}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            No repeated medicines yet. After a few entries, common tablet names will show here.
          </Text>
        )}

        <AppInput
          label="Tablet / medicine name"
          value={medicationName}
          onChangeText={(value) => {
            setMedicationName(value);
            refreshSuggestions(value);
          }}
          placeholder="Example: Amoxicillin 500mg"
        />
        <AppInput label="Dosage optional" value={dosage} onChangeText={setDosage} placeholder="Example: 1 tablet" />
        <AppInput label="Frequency optional" value={frequency} onChangeText={setFrequency} placeholder="Example: Morning and night" />
        <AppInput label="Duration optional" value={duration} onChangeText={setDuration} placeholder="Example: 3 days" />
        <AppInput label="Instructions optional" value={instructions} onChangeText={setInstructions} placeholder="Example: After food" multiline />

        <AppButton
          title="Save Prescribed Tablet"
          icon="save-outline"
          onPress={save}
          loading={saving}
          loadingTitle="Saving..."
        />
      </SectionCard>

      <SectionCard title="Recent Entries" subtitle={selectedPatient ? "Latest tablets saved for this patient." : "Latest tablets saved in this clinic."}>
        {recent.length ? (
          <View style={{ gap: 10 }}>
            {recent.slice(0, 10).map((entry) => (
              <View key={entry.id} style={{ padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 4 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{entry.medication_name}</Text>
                <Text style={{ color: colors.muted }}>
                  {[entry.dosage, entry.frequency, entry.duration].filter(Boolean).join(" • ") || "No dosage details"}
                </Text>
                {entry.instructions ? <Text style={{ color: colors.muted }}>{entry.instructions}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{entry.patients?.name ? `${entry.patients.name} • ` : ""}{formatDate(entry.created_at)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState title="No medication entries yet" message="Saved prescribed tablets will appear here." icon="medical-outline" />
        )}
      </SectionCard>

      <AppButton title="Back" icon="arrow-back-outline" variant="ghost" onPress={exitScreen} />
    </Screen>
  );
}
