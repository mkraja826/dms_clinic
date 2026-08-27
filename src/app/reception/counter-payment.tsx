import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  createCounterPaymentCheckout,
  getCounterPaymentQr,
  getCounterPaymentStatus,
  prepareCounterPaymentRequest,
  type CounterPaymentCategory,
  type CounterPaymentQr,
} from "@/lib/counterPayments";
import { searchPatientsPage } from "@/lib/patientDirectory";
import type { Patient } from "@/lib/supabase";

const CATEGORIES: { key: CounterPaymentCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "op_fee", label: "OP", icon: "receipt-outline" },
  { key: "xray_fee", label: "X-ray", icon: "scan-outline" },
  { key: "medication_fee", label: "Medication", icon: "medical-outline" },
  { key: "treatment_fee", label: "Treatment", icon: "hammer-outline" },
  { key: "pending_collection", label: "Pending", icon: "time-outline" },
  { key: "other", label: "Other", icon: "wallet-outline" },
];

function amountValue(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTone(status: string): "primary" | "success" | "warning" | "danger" {
  if (status === "reconciled") return "success";
  if (status === "failed" || status === "expired" || status === "cancelled") return "danger";
  if (status === "reconciliation_required") return "warning";
  return "primary";
}

export default function CounterPaymentScreen() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [category, setCategory] = useState<CounterPaymentCategory>("op_fee");
  const [amount, setAmount] = useState("");
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [qr, setQr] = useState<CounterPaymentQr | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const searchSequence = useRef(0);

  async function searchPatients(text = query) {
    const sequence = searchSequence.current + 1;
    searchSequence.current = sequence;
    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({ query: text, page: 1, pageSize: 12 });
      if (sequence !== searchSequence.current) return;
      setPatients(result.rows || []);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      Alert.alert("Patient search failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (sequence === searchSequence.current) setLoadingPatients(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void searchPatients(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!qr?.paymentRequestId || paymentStatus === "reconciled") return;
    let cancelled = false;
    const check = async () => {
      try {
        const status = await getCounterPaymentStatus(qr.paymentRequestId);
        if (cancelled) return;
        setPaymentStatus(status.status);
        setFailureMessage(status.failureMessage);
      } catch {
        // Keep QR visible; transient polling errors should not interrupt reception.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [qr?.paymentRequestId, paymentStatus]);

  async function generateQr() {
    if (!selectedPatient) {
      Alert.alert("Select patient", "Choose the patient before generating a payment QR.");
      return;
    }
    const value = amountValue(amount);
    if (value <= 0) {
      Alert.alert("Enter amount", "Enter a payment amount greater than zero.");
      return;
    }

    try {
      setGenerating(true);
      setQr(null);
      setPaymentStatus("");
      setFailureMessage(null);
      const prepared = await prepareCounterPaymentRequest({
        patientId: selectedPatient.id,
        paymentCategory: category,
        amount: value,
      });
      await createCounterPaymentCheckout(prepared.paymentRequestId);
      const nextQr = await getCounterPaymentQr(prepared.paymentRequestId);
      setQr(nextQr);
      setPaymentStatus(nextQr.status);
    } catch (error) {
      Alert.alert("QR generation failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function resetPayment() {
    setQr(null);
    setPaymentStatus("");
    setFailureMessage(null);
    setAmount("");
  }

  const categoryLabel = CATEGORIES.find((item) => item.key === category)?.label || "Payment";
  const paid = paymentStatus === "reconciled";

  return (
    <Screen>
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
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>Collect by QR</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Select patient, collection type and amount. CapDent records payment only after provider verification.
          </Text>
        </View>
      </View>

      {!qr ? (
        <>
          <SectionCard title="Patient" subtitle="Search by patient name, phone or patient code.">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search patient"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={{
                minHeight: 48,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.text,
                paddingHorizontal: 14,
                fontWeight: "700",
              }}
            />

            {selectedPatient ? (
              <View style={{
                padding: 12,
                borderRadius: 18,
                backgroundColor: colors.primarySoft,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}>
                <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>{selectedPatient.name}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>
                    {selectedPatient.patient_code || "No patient code"}{selectedPatient.phone ? ` • ${selectedPatient.phone}` : ""}
                  </Text>
                </View>
                <Pressable onPress={() => setSelectedPatient(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}

            {!selectedPatient ? (
              <View style={{ gap: 8 }}>
                {patients.map((patient) => (
                  <Pressable
                    key={patient.id}
                    onPress={() => {
                      setSelectedPatient(patient);
                      setQuery("");
                    }}
                    style={({ pressed }) => ({
                      padding: 12,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                    })}
                  >
                    <Text style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                    <Text style={{ color: colors.muted, marginTop: 2 }}>
                      {patient.patient_code || "Patient"}{patient.phone ? ` • ${patient.phone}` : ""}
                    </Text>
                  </Pressable>
                ))}
                {!loadingPatients && !patients.length ? (
                  <EmptyState title="No patients found" message="Try another name, phone number or patient code." icon="search-outline" />
                ) : null}
              </View>
            ) : null}
          </SectionCard>

          <SectionCard title="Collection type" subtitle="This selection is locked into the payment record.">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {CATEGORIES.map((item) => {
                const selected = category === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setCategory(item.key)}
                    style={{
                      width: "47%",
                      minHeight: 74,
                      padding: 12,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primarySoft : colors.background,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <Ionicons name={item.icon} size={21} color={selected ? colors.primary : colors.muted} />
                    <Text style={{ flex: 1, color: colors.text, fontWeight: "900" }}>{item.label}</Text>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>

          <SectionCard title="Amount" subtitle={`Enter the ${categoryLabel} amount to collect now.`}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.muted}
              style={{
                minHeight: 58,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.text,
                paddingHorizontal: 16,
                fontSize: 24,
                fontWeight: "900",
              }}
            />
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
              CapDent will reject an amount higher than the patient&apos;s outstanding balance in the selected category.
            </Text>
          </SectionCard>

          <AppButton
            title="Generate QR"
            icon="qr-code-outline"
            onPress={() => void generateQr()}
            loading={generating}
            disabled={!selectedPatient || amountValue(amount) <= 0}
          />
        </>
      ) : (
        <>
          <SectionCard
            title={paid ? "Payment received" : "Scan to pay"}
            subtitle={`${selectedPatient?.name || "Patient"} • ${categoryLabel} • ${formatClinicMoney(qr.amount, qr.currencyCode)}`}
          >
            <View style={{ alignItems: "center", gap: 14 }}>
              {paid ? (
                <View style={{
                  width: 140,
                  height: 140,
                  borderRadius: 70,
                  backgroundColor: colors.successSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Ionicons name="checkmark-circle" size={96} color={colors.success} />
                </View>
              ) : (
                <View style={{ padding: 14, borderRadius: 20, backgroundColor: "white" }}>
                  <SvgXml xml={qr.qrSvg} width={286} height={286} />
                </View>
              )}

              <StatusBadge
                label={paid ? "Paid & recorded" : paymentStatus.replaceAll("_", " ") || "waiting for payment"}
                tone={statusTone(paymentStatus)}
              />

              <Text style={{ color: paid ? colors.success : colors.text, fontWeight: "900", fontSize: 22 }}>
                {formatClinicMoney(qr.amount, qr.currencyCode)}
              </Text>
              <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>
                {paid
                  ? `${categoryLabel} payment has been verified and recorded automatically.`
                  : "Ask the patient to scan this QR with a supported payment app. Keep this screen open until CapDent confirms payment."}
              </Text>
              {failureMessage ? (
                <Text style={{ color: colors.warning, textAlign: "center", fontWeight: "800", lineHeight: 19 }}>
                  {failureMessage}
                </Text>
              ) : null}
            </View>
          </SectionCard>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton
              title={paid ? "Collect Another" : "New QR"}
              icon={paid ? "add-circle-outline" : "refresh-outline"}
              onPress={resetPayment}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Back"
              icon="arrow-back-outline"
              variant="secondary"
              onPress={() => router.back()}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
