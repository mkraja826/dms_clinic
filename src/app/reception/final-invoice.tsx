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
import {
  finalizeConsolidatedInvoice,
  getConsolidatedInvoiceCandidates,
  type ConsolidatedInvoiceCandidate,
  type FinalizedConsolidatedBill,
} from "@/lib/consolidatedBilling";
import { formatClinicMoney } from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import { searchPatientsPage } from "@/lib/patientDirectory";
import type { Patient } from "@/lib/supabase";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: string; details?: string; hint?: string };
    return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join("\n") || "Please try again.";
  }
  return "Please try again.";
}

export default function ReceptionFinalInvoiceScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const incomingPatientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [candidates, setCandidates] = useState<ConsolidatedInvoiceCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");
  const [backendReady, setBackendReady] = useState(true);
  const [backendReason, setBackendReason] = useState<string | null>(null);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState<FinalizedConsolidatedBill | null>(null);
  const searchRequestRef = useRef(0);
  const finalizeLockRef = useRef(false);

  const money = (value: number) => formatClinicMoney(value, finalized?.currency_code || currencyCode);

  async function loadPatients(query = search) {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const [result, preferences] = await Promise.all([
        searchPatientsPage({ query, page: 1, pageSize: 12 }),
        getClinicPreferences().catch(() => null),
      ]);
      if (requestId !== searchRequestRef.current) return [];
      if (preferences?.currencyCode) setCurrencyCode(preferences.currencyCode);
      setPatients(result.patients);
      return result.patients;
    } catch (error) {
      Alert.alert("Patients load failed", getErrorMessage(error));
      return [];
    } finally {
      if (requestId === searchRequestRef.current) setLoadingPatients(false);
    }
  }

  async function loadCharges(patient: Patient) {
    try {
      setLoadingCharges(true);
      setFinalized(null);
      setSelectedIds([]);
      const result = await getConsolidatedInvoiceCandidates(patient.id);
      setBackendReady(result.backendReady);
      setBackendReason(result.reason || null);
      setCandidates(result.candidates);
    } catch (error) {
      setCandidates([]);
      setBackendReady(true);
      Alert.alert("Charges load failed", getErrorMessage(error));
    } finally {
      setLoadingCharges(false);
    }
  }

  function choosePatient(patient: Patient) {
    setSelectedPatient(patient);
    setSearch("");
    void loadCharges(patient);
  }

  async function selectIncomingPatient(patientId: string) {
    try {
      setLoadingPatients(true);
      const { patients: rows } = await searchPatientsPage({ page: 1, pageSize: 50 });
      const found = rows.find((patient) => patient.id === patientId);
      if (found) {
        choosePatient(found);
        return;
      }

      // The normal search helper is intentionally clinic scoped. If the patient
      // is older than the first page, search by ID is not exposed to end users,
      // so fall back to opening the patient directory rather than guessing.
      Alert.alert("Patient not loaded", "Search the patient by name, phone, or patient ID and select them again.");
    } catch (error) {
      Alert.alert("Patient load failed", getErrorMessage(error));
    } finally {
      setLoadingPatients(false);
    }
  }

  useEffect(() => {
    void loadPatients("");
  }, []);

  useEffect(() => {
    if (incomingPatientId) void selectIncomingPatient(incomingPatientId);
  }, [incomingPatientId]);

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.includes(candidate.invoice_id)),
    [candidates, selectedIds]
  );

  const totals = useMemo(
    () =>
      selectedCandidates.reduce(
        (sum, item) => ({
          total: sum.total + Number(item.total_amount || 0),
          paid: sum.paid + Number(item.paid_amount || 0),
          due: sum.due + Number(item.due_amount || 0),
        }),
        { total: 0, paid: 0, due: 0 }
      ),
    [selectedCandidates]
  );

  function toggleCandidate(invoiceId: string) {
    setSelectedIds((current) =>
      current.includes(invoiceId)
        ? current.filter((id) => id !== invoiceId)
        : [...current, invoiceId]
    );
  }

  async function finalize() {
    if (finalizing || finalizeLockRef.current) return;
    if (!selectedPatient) {
      Alert.alert("Patient missing", "Select the patient first.");
      return;
    }
    if (!selectedIds.length) {
      Alert.alert("Charges missing", "Select at least one charge for the final invoice.");
      return;
    }

    Alert.alert(
      "Finalize patient invoice?",
      `This will freeze ${selectedIds.length} selected charge${selectedIds.length === 1 ? "" : "s"} into one patient-facing invoice. Nothing will be sent automatically.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finalize",
          onPress: async () => {
            finalizeLockRef.current = true;
            setFinalizing(true);
            try {
              const result = await finalizeConsolidatedInvoice({
                patientId: selectedPatient.id,
                sourceInvoiceIds: selectedIds,
                notes,
              });
              setFinalized(result);
              setCandidates((current) => current.filter((item) => !selectedIds.includes(item.invoice_id)));
              setSelectedIds([]);
              Alert.alert(
                "Invoice finalized",
                `${result.invoice_number} is ready for receptionist review/share. Nothing has been sent to the patient.`
              );
            } catch (error) {
              Alert.alert("Finalization failed", getErrorMessage(error));
            } finally {
              finalizeLockRef.current = false;
              setFinalizing(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Screen refreshing={loadingPatients || loadingCharges} onRefresh={() => selectedPatient ? loadCharges(selectedPatient) : loadPatients(search)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 42,
            height: 42,
            borderRadius: 16,
            backgroundColor: colors.surfaceSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>Review Final Invoice</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Combine selected OP, X-ray, medication, treatment, and other charges into one patient-facing invoice.
          </Text>
        </View>
      </View>

      {!backendReady ? (
        <SectionCard title="V28 backend pending">
          <Text style={{ color: colors.warning, fontWeight: "900", lineHeight: 20 }}>
            {backendReason || "Consolidated billing has not been deployed to this environment."}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 6, lineHeight: 20 }}>
            Existing CapDent fee collection and invoice/payment workflows are unchanged.
          </Text>
        </SectionCard>
      ) : null}

      {!selectedPatient ? (
        <SectionCard title="Select Patient" subtitle="Search by name, phone, or patient ID. Nothing is selected automatically.">
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
              value={search}
              onChangeText={setSearch}
              placeholder="Search patient"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, minHeight: 54, color: colors.text, fontSize: 16 }}
              returnKeyType="search"
              onSubmitEditing={() => void loadPatients(search)}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton title="Search" icon="search-outline" onPress={() => void loadPatients(search)} style={{ flex: 1 }} />
            <AppButton
              title="Clear"
              icon="close-circle-outline"
              variant="secondary"
              onPress={() => {
                setSearch("");
                void loadPatients("");
              }}
              style={{ flex: 1 }}
            />
          </View>

          {patients.length ? (
            <View style={{ gap: 9 }}>
              {patients.map((patient) => (
                <Pressable
                  key={patient.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${patient.name}`}
                  onPress={() => choosePatient(patient)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    borderRadius: 18,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                  })}
                >
                  <Ionicons name="person-circle-outline" size={34} color={colors.primary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2 }}>
                      {patient.phone || "No phone"}{patient.patient_code ? ` • ${patient.patient_code}` : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          ) : loadingPatients ? (
            <Text style={{ color: colors.muted }}>Loading patients…</Text>
          ) : (
            <EmptyState title="No patients found" message="Try another patient name, phone, or ID." icon="people-outline" />
          )}
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Patient" subtitle="Only charges belonging to this patient and the current clinic can be finalized.">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Ionicons name="person-circle-outline" size={40} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>{selectedPatient.name}</Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>
                  {selectedPatient.phone || "No phone"}{selectedPatient.patient_code ? ` • ${selectedPatient.patient_code}` : ""}
                </Text>
              </View>
              <AppButton
                title="Change"
                variant="ghost"
                onPress={() => {
                  setSelectedPatient(null);
                  setCandidates([]);
                  setSelectedIds([]);
                  setFinalized(null);
                }}
              />
            </View>
          </SectionCard>

          {finalized ? (
            <SectionCard title="Finalized" subtitle="This invoice is frozen. Patient sharing is a separate receptionist action.">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>{finalized.invoice_number}</Text>
                  <Text style={{ color: colors.muted, marginTop: 3 }}>{formatDate(finalized.finalized_at)}</Text>
                </View>
                <StatusBadge label={finalized.due_amount > 0 ? "Balance due" : "Paid"} tone={finalized.due_amount > 0 ? "warning" : "success"} />
              </View>
              <View style={{ gap: 6 }}>
                <Text style={{ color: colors.text, fontWeight: "800" }}>Total: {money(finalized.total_amount)}</Text>
                <Text style={{ color: colors.text, fontWeight: "800" }}>Paid: {money(finalized.paid_amount)}</Text>
                <Text style={{ color: finalized.due_amount > 0 ? colors.warning : colors.success, fontWeight: "900" }}>
                  Balance: {money(finalized.due_amount)}
                </Text>
              </View>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Nothing has been sent automatically. WhatsApp/print/share will be enabled from this finalized snapshot in the next integration layer.
              </Text>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Available Charges"
            subtitle="Last 30 days by default. Select only the charges that belong on this final patient invoice."
          >
            {loadingCharges ? (
              <Text style={{ color: colors.muted }}>Loading invoice candidates…</Text>
            ) : candidates.length ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <AppButton
                    title="Select All"
                    icon="checkmark-done-outline"
                    variant="secondary"
                    onPress={() => setSelectedIds(candidates.map((candidate) => candidate.invoice_id))}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    title="Clear"
                    icon="close-outline"
                    variant="ghost"
                    onPress={() => setSelectedIds([])}
                    style={{ flex: 1 }}
                  />
                </View>

                {candidates.map((candidate) => {
                  const selected = selectedIds.includes(candidate.invoice_id);
                  return (
                    <Pressable
                      key={candidate.invoice_id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`${candidate.label}, ${money(candidate.total_amount)}`}
                      onPress={() => toggleCandidate(candidate.invoice_id)}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.background,
                        borderRadius: 18,
                        padding: 13,
                        gap: 7,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons
                          name={selected ? "checkbox" : "square-outline"}
                          size={24}
                          color={selected ? colors.primary : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: "900" }}>{candidate.label}</Text>
                          <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>{formatDate(candidate.created_at)}</Text>
                        </View>
                        <Text style={{ color: colors.text, fontWeight: "900" }}>{money(candidate.total_amount)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        <StatusBadge label={`Paid ${money(candidate.paid_amount)}`} tone={candidate.paid_amount > 0 ? "success" : "primary"} />
                        <StatusBadge label={`Due ${money(candidate.due_amount)}`} tone={candidate.due_amount > 0 ? "warning" : "success"} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : backendReady ? (
              <EmptyState
                title="No unfinalized charges"
                message="No eligible recent charge invoices are available for this patient."
                icon="receipt-outline"
              />
            ) : null}
          </SectionCard>

          <SectionCard title="Final Review" subtitle="The selected source invoices stay unchanged; this creates a separate immutable patient-facing snapshot.">
            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: colors.muted, fontWeight: "800" }}>Selected charges</Text>
                <Text style={{ color: colors.text, fontWeight: "900" }}>{selectedIds.length}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: colors.muted, fontWeight: "800" }}>Total</Text>
                <Text style={{ color: colors.text, fontWeight: "900" }}>{money(totals.total)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: colors.muted, fontWeight: "800" }}>Already paid</Text>
                <Text style={{ color: colors.success, fontWeight: "900" }}>{money(totals.paid)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: colors.muted, fontWeight: "800" }}>Balance</Text>
                <Text style={{ color: totals.due > 0 ? colors.warning : colors.success, fontWeight: "900" }}>{money(totals.due)}</Text>
              </View>
            </View>

            <AppInput
              label="Invoice note (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Patient-facing billing note"
              multiline
            />

            <AppButton
              title="Finalize Invoice"
              icon="document-text-outline"
              onPress={() => void finalize()}
              loading={finalizing}
              loadingTitle="Finalizing invoice…"
              disabled={!backendReady || !selectedIds.length}
            />
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
              Finalizing does not send WhatsApp, email, notification, or payment request. Reception decides separately when to share the invoice.
            </Text>
          </SectionCard>
        </>
      )}
    </Screen>
  );
}
