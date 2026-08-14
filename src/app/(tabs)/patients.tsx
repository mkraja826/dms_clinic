import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { PatientCard } from "@/components/PatientCard";
import { colors } from "@/constants/colors";
import { Patient, searchPatients } from "@/lib/supabase";

export default function PatientsScreen() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (value = query) => {
    try {
      setPatients(await searchPatients(value));
    } catch (error) {
      Alert.alert("Patients error", error instanceof Error ? error.message : "Unable to load patients.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const timer = setTimeout(() => load(query), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14 }}>
      <AppInput label="Search patients" value={query} onChangeText={setQuery} placeholder="Name or phone" />

      <AppButton title="Add Patient" onPress={() => router.push("/patient/add")} />

      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      {!loading && !patients.length ? (
        <EmptyState
          title={query.trim() ? "No matching patients" : "No patients yet"}
          body={query.trim() ? "Try a different name or phone number." : "Add your first patient to begin."}
          icon="people-outline"
        />
      ) : null}

      <View style={{ gap: 12 }}>
        {patients.map((patient) => (
          <Pressable key={patient.id} onPress={() => router.push({ pathname: "/patient/[id]", params: { id: patient.id } })}>
            <PatientCard patient={patient} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
