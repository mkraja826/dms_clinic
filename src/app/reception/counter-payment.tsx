import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  confirmManualQrCollection,
  listManualPaymentQrAccounts,
  type ManualPaymentQrAccount,
} from "@/lib/manualPaymentQr";
import { searchPatientsPage } from "@/lib/patientDirectory";
import type { Patient } from "@/lib/supabase";

type ManualQrCategory = "op_fee" | "xray_fee" | "medication_fee" | "treatment_fee" | "other";

const CATEGORIES: {
  key: ManualQrCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "op_fee", label: "OP", icon: "receipt-outline" },
  { key: "xray_fee", label: "X-ray", icon: "scan-outline" },
  { key: "medication_fee", label: "Medication", icon: "medical-outline" },
  { key: "treatment_fee", label: "Treatment", icon: "hammer-outline" },
  { key: "other", label: "Other", icon: "wallet-outline" },
];

function amountValue(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function CounterPaymentScreen() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [category, setCategory] = useState<ManualQrCategory>("op_fee");
  const [amount, setAmount] = useState("");
  const [qrAccounts, setQrAccounts] = useState<ManualPaymentQrAccount[]>([]);
  const [selectedQr, setSelectedQr] = useState<ManualPaymentQrAccount | null>(null);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [loadingQr, setLoadingQr] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const searchSequence = useRef(0);
  const confirmLock = useRef(false);

  async function searchPatients(text = query) {
    const sequence = searchSequence.current + 1;
    searchSequence.current = sequence;
    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({ query: text, page: 1, pageSize: 12 });
      if (sequence !== searchSequence.current) return;
      setPatients(result.patients || []);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      Alert.alert("Patient search failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (sequence === searchSequence.current) setLoadingPatients(false);
    }
  }

  async function loadQrAccounts() {
    try {
      setLoadingQr(true);
      const accounts = await listManualPaymentQrAccounts({ activeOnly: true });
      setQrAccounts(accounts);
      setSelectedQr(accounts.find((item) => item.isDefault) || accounts[0] || null);
    } catch (error) {
      Alert.alert("Payment QR load failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoadingQr(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void searchPatients(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void loadQrAccounts();
  }, []);

  function resetCollection() {
    setSelectedPatient(null);
    setQuery("");
    setAmount("");
    setShowQr(false);
    setRecorded(false);
    setCategory("op_fee");
    setSelectedQr(qrAccounts.find((item) => item.isDefault) || qrAccounts[0] || null);
  }

  async function confirmReceipt() {
    if (confirmLock.current || confirming) return;
    if (!selectedPatient || !selectedQr) {
      Alert.alert("Missing details", "Select a patient and clinic payment QR first.");
      return;
    }
    const value = amountValue(amount);
    if (value <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }

    Alert.alert(
      "Confirm payment received?",
      `Confirm only after you have checked that ${formatClinicMoney(value)} was actually received in ${selectedQr.label}. This action records the payment in CapDent.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Received & Record",
          onPress: async () => {
            if (confirmLock.current) return;
            confirmLock.current = true;
            setConfirming(true);
            try {
              await confirmManualQrCollection({
                patientId: selectedPatient.id,
                qrAccountId: selectedQr.id,
                feeType: category,
                amount: value,
                note: `Reception confirmed payment to ${selectedQr.label}`,
              });
              setRecorded(true);
              Alert.alert(
                "Payment recorded",
                `${formatClinicMoney(value)} was added to the patient's ledger and today's revenue.`,
                [
                  { text: "Collect Another", onPress: resetCollection },
                  { text: "Open Patient", onPress: () => router.replace(`/patient/${selectedPatient.id}` as never) },
                ]
              );
            } catch (error) {
              Alert.alert("Could not record payment", error instanceof Error ? error.message : "Please try again.");
            } finally {
              confirmLock.current = false;
              setConfirming(false);
            }
          },
        },
      ]
    );
  }

  const categoryLabel = CATEGORIES.find((item) => item.key === category)?.label || "Payment";
  const value = amountValue(amount);

  return (
    <Screen refreshing={loadingQr} onRefresh={loadQrAccounts}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={{ width: 42, height: 42, borderRadius: 16, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>Collect by QR</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Show the clinic&apos;s saved QR. Record payment only after reception verifies the money was received.
          </Text>
        </View>
      </View>

      {recorded ? (
        <View style={{ padding: 18, borderRadius: 22, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.success, alignItems: "center", gap: 10 }}>
          <Ionicons name="checkmark-circle" size={72} color={colors.success} />
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Paid & recorded</Text>
          <Text style={{ color: colors.muted, textAlign: "center" }}>Reception confirmation has been written to the patient ledger and QR audit trail.</Text>
          <AppButton title="Collect Another" icon="add-circle-outline" onPress={resetCollection} />
        </View>
      ) : null}

      {!recorded ? (
        <>
          <View style={{ backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 15, gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>1. Select patient</Text>
            {selectedPatient ? (
              <View style={{ padding: 13, borderRadius: 18, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 11 }}>
                <Ionicons name="person-circle-outline" size={32} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{selectedPatient.name}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
                    {selectedPatient.patient_code || "No patient code"}{selectedPatient.phone ? ` • ${selectedPatient.phone}` : ""}
                  </Text>
                </View>
                <Pressable onPress={() => setSelectedPatient(null)} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="swap-horizontal-outline" size={23} color={colors.primary} />
                </Pressable>
              </View>
            ) : (
              <>
                <View style={{ minHeight: 52, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 }}>
                  <Ionicons name="search-outline" size={20} color={colors.muted} />
                  <TextInput value={query} onChangeText={setQuery} placeholder="Name, phone or patient code" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontWeight: "700", minHeight: 50 }} />
                </View>
                <View style={{ gap: 8 }}>
                  {patients.map((patient) => (
                    <Pressable key={patient.id} onPress={() => { setSelectedPatient(patient); setQuery(""); }} style={({ pressed }) => ({ minHeight: 58, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceSoft : colors.background, justifyContent: "center" })}>
                      <Text style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                      <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>{patient.patient_code || "Patient"}{patient.phone ? ` • ${patient.phone}` : ""}</Text>
                    </Pressable>
                  ))}
                  {!loadingPatients && !patients.length ? <EmptyState title="No patients found" message="Try another name, phone number or patient code." icon="search-outline" /> : null}
                </View>
              </>
            )}
          </View>

          <View style={{ backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 15, gap: 13 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>2. Collection type</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              {CATEGORIES.map((item) => {
                const selected = category === item.key;
                return (
                  <Pressable key={item.key} onPress={() => setCategory(item.key)} style={{ width: "47%", minHeight: 72, padding: 12, borderRadius: 18, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.background, alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <Ionicons name={item.icon} size={22} color={selected ? colors.primary : colors.muted} />
                    <Text style={{ color: selected ? colors.primaryDark : colors.text, fontWeight: "900" }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 15, gap: 11 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>3. Amount</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} style={{ minHeight: 70, borderRadius: 18, borderWidth: 1, borderColor: value > 0 ? colors.primary : colors.border, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 18, fontSize: 32, fontWeight: "900", textAlign: "center" }} />
            <Text style={{ color: colors.muted, textAlign: "center" }}>{categoryLabel} • {formatClinicMoney(value)}</Text>
          </View>

          <View style={{ backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 15, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>4. Clinic payment QR</Text>
                <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>Choose where this patient should pay.</Text>
              </View>
              {selectedQr?.isDefault ? <StatusBadge label="Default" tone="primary" /> : null}
            </View>

            {!loadingQr && !qrAccounts.length ? (
              <EmptyState title="No payment QR configured" message="Ask the clinic owner or head doctor to add a payment QR in Patient Payments settings." icon="qr-code-outline" />
            ) : (
              <View style={{ gap: 9 }}>
                {qrAccounts.map((account) => {
                  const selected = selectedQr?.id === account.id;
                  return (
                    <Pressable key={account.id} onPress={() => { setSelectedQr(account); setShowQr(false); }} style={{ padding: 13, borderRadius: 17, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.background, flexDirection: "row", alignItems: "center", gap: 11 }}>
                      <Ionicons name="qr-code-outline" size={26} color={selected ? colors.primary : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "900" }}>{account.label}</Text>
                        <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>{account.accountName || account.upiId || "Clinic QR"}</Text>
                      </View>
                      {selected ? <Ionicons name="checkmark-circle" size={23} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {selectedQr && value > 0 ? (
              <AppButton title={showQr ? "Hide QR" : "Show QR to Patient"} icon="qr-code-outline" onPress={() => setShowQr((current) => !current)} />
            ) : null}
          </View>

          {showQr && selectedQr ? (
            <View style={{ backgroundColor: colors.primarySoft, borderRadius: 26, borderWidth: 1, borderColor: colors.primary, padding: 18, alignItems: "center", gap: 13 }}>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>{formatClinicMoney(value)}</Text>
              <Text style={{ color: colors.primary, fontWeight: "900" }}>{selectedQr.label}</Text>
              {selectedQr.signedUrl ? (
                <View style={{ padding: 12, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border }}>
                  <Image source={{ uri: selectedQr.signedUrl }} resizeMode="contain" style={{ width: 286, height: 286 }} />
                </View>
              ) : (
                <EmptyState title="QR image unavailable" message="Refresh this screen. If it still fails, ask the owner to re-upload this QR." icon="image-outline" />
              )}
              {selectedQr.upiId ? <Text style={{ color: colors.muted, fontWeight: "800" }}>{selectedQr.upiId}</Text> : null}
              <Text style={{ color: colors.text, textAlign: "center", lineHeight: 20 }}>After the patient pays, verify the amount in the clinic&apos;s payment app or bank notification. CapDent does not auto-detect this payment.</Text>
              <AppButton title="I Verified Payment Received" icon="checkmark-circle-outline" onPress={() => void confirmReceipt()} loading={confirming} disabled={!selectedQr.signedUrl || value <= 0} />
              <Text style={{ color: colors.warning, textAlign: "center", fontSize: 12, lineHeight: 18, fontWeight: "800" }}>Do not tap confirm based only on a patient screenshot. Confirm against the clinic receiving account.</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
