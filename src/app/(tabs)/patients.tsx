import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { PatientCard } from "@/components/PatientCard";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import {
  getCapDentEntitlementsV25,
  type CapDentEntitlementsV25,
} from "@/lib/pricingV25";
import { Patient, searchPatients } from "@/lib/supabase";

export default function PatientsScreen() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [entitlements, setEntitlements] = useState<CapDentEntitlementsV25 | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingCapacity, setLoadingCapacity] = useState(true);

  const load = useCallback(async (value = query) => {
    try {
      setPatients(await searchPatients(value));
    } catch (error) {
      Alert.alert("Patients error", error instanceof Error ? error.message : "Unable to load patients.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadCapacity = useCallback(async () => {
    try {
      setEntitlements(await getCapDentEntitlementsV25());
    } catch (error) {
      console.warn("Patient capacity load failed:", error);
    } finally {
      setLoadingCapacity(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadCapacity();
    }, [load, loadCapacity])
  );

  useEffect(() => {
    const timer = setTimeout(() => load(query), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  const patientLimit = entitlements?.patientLimit ?? null;
  const patientCount = entitlements?.patientCount ?? 0;
  const patientsRemaining = entitlements?.remainingPatients ?? null;
  const patientBlocked =
    entitlements?.patientLimitEnforced === true &&
    entitlements.canAddPatient === false;
  const patientWarning =
    entitlements?.patientLimitEnforced === true &&
    patientsRemaining !== null &&
    patientsRemaining > 0 &&
    patientsRemaining <= 10;
  const capacityText = entitlements
    ? patientLimit === null
      ? `${patientCount} patients • Unlimited capacity`
      : `${patientCount} of ${patientLimit} patients used`
    : "Checking clinic capacity...";

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14 }}>
      <SectionCard
        title="Plan & Patient Capacity"
        subtitle={
          entitlements
            ? `${entitlements.planLabel} plan • ${capacityText}`
            : "Loading the clinic's current patient allowance."
        }
      >
        {loadingCapacity ? <ActivityIndicator color={colors.primary} /> : null}

        {!loadingCapacity && entitlements ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 17 }}>
              {capacityText}
            </Text>

            {patientBlocked ? (
              <Text style={{ color: colors.danger, lineHeight: 20, fontWeight: "700" }}>
                Patient capacity has been reached. Existing patient records remain available; upgrade the clinic plan to register another patient.
              </Text>
            ) : patientWarning ? (
              <Text style={{ color: colors.warning, lineHeight: 20, fontWeight: "700" }}>
                {patientsRemaining} patient slot{patientsRemaining === 1 ? "" : "s"} remaining on the current plan.
              </Text>
            ) : patientLimit !== null && entitlements.patientLimitEnforced ? (
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                {patientsRemaining} patient slot{patientsRemaining === 1 ? "" : "s"} available.
              </Text>
            ) : (
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Patient registration is available for this clinic.
              </Text>
            )}

            {patientBlocked ? (
              <AppButton
                title="View Plans"
                icon="card-outline"
                variant="secondary"
                onPress={() => router.push("/settings/subscription" as never)}
              />
            ) : null}
          </View>
        ) : null}
      </SectionCard>

      <AppInput label="Search patients" value={query} onChangeText={setQuery} placeholder="Name or phone" />

      <AppButton
        title={patientBlocked ? "Patient Limit Reached" : "Add Patient"}
        icon={patientBlocked ? "lock-closed-outline" : "person-add-outline"}
        disabled={patientBlocked}
        onPress={() => router.push("/patient/add")}
      />

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
