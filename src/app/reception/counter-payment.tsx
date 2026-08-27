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

const POLL_TERMINAL_STATUSES = new Set([
  "reconciled",
  "reconciliation_required",
  "partially_reconciled_excess",
  "failed",
  "expired",
  "cancelled",
  "superseded",
]);

function amountValue(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTone(status: string): "primary" | "success" | "warning" | "danger" {
  if (status === "reconciled") return "success";
  if (status === "reconciliation_required" || status === "partially_reconciled_excess") return "warning";
  if (["failed", "expired", "cancelled", "superseded"].includes(status)) return "danger";
  return "primary";
}

function statusLabel(status: string, locallyExpired: boolean) {
  if (status === "reconciled") return "Paid & recorded";
  if (status === "reconciliation_required" || status === "partially_reconciled_excess") return "Needs review";
  if (status === "failed") return "Payment failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "superseded") return "QR replaced";
  if (status === "expired" || locallyExpired) return "QR expired";
  if (status === "provider_verified") return "Verifying payment";
  return "Waiting for payment";
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  const [clock, setClock] = useState(Date.now());
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
    if (!qr?.expiresAt || POLL_TERMINAL_STATUSES.has(paymentStatus)) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [qr?.expiresAt, paymentStatus]);

  useEffect(() => {
    if (!qr?.paymentRequestId || POLL_TERMINAL_STATUSES.has(paymentStatus)) return;
    let cancelled = false;
    const check = async () => {
      try {
        const status = await getCounterPaymentStatus(qr.paymentRequestId);
        if (cancelled) return;
        setPaymentStatus(status.status);
        setFailureMessage(status.failureMessage);
      } catch {
        // A transient polling failure must not mark or mutate a payment locally.
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
      setClock(Date.now());
      setQr(nextQr);
      setPaymentStatus(nextQr.status);
    } catch (error) {
      Alert.alert("QR generation failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function resetPayment(options?: { keepAmount?: boolean }) {
    setQr(null);
    setPaymentStatus("");
    setFailureMessage(null);
    if (!options?.keepAmount) setAmount("");
    setClock(Date.now());
  }

  const categoryLabel = CATEGORIES.find((item) => item.key === category)?.label || "Payment";
  const paid = paymentStatus === "reconciled";
  const needsReview = paymentStatus === "reconciliation_required" || paymentStatus === "partially_reconciled_excess";
  const providerExpiry = qr?.expiresAt ? new Date(qr.expiresAt).getTime() : 0;
  const expiryRemaining = providerExpiry > 0 ? providerExpiry - clock : Number.POSITIVE_INFINITY;
  const locallyExpired = Boolean(qr && providerExpiry > 0 && expiryRemaining <= 0 && !paid && !needsReview);
  const unusable = locallyExpired || ["failed", "expired", "cancelled", "superseded"].includes(paymentStatus);
  const qrPayable = Boolean(qr && !paid && !needsReview && !unusable && paymentStatus !== "provider_verified");
  const displayStatus = statusLabel(paymentStatus, locallyExpired);

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
            title={paid ? "Payment received" : needsReview ? "Payment needs review" : unusable ? "QR unavailable" : "Scan to pay"}
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
              ) : qrPayable ? (
                <View style={{ padding: 14, borderRadius: 20, backgroundColor: "white" }}>
                  <SvgXml xml={qr.qrSvg} width={286} height={286} />
                </View>
              ) : (
                <View style={{
                  width: 140,
                  height: 140,
                  borderRadius: 70,
                  backgroundColor: needsReview ? colors.warningSoft : colors.surfaceSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Ionicons
                    name={needsReview ? "warning-outline" : paymentStatus === "provider_verified" ? "shield-checkmark-outline" : "qr-code-outline"}
                    size={76}
                    color={needsReview ? colors.warning : colors.muted}
                  />
                </View>
              )}

              <StatusBadge label={displayStatus} tone={statusTone(locallyExpired ? "expired" : paymentStatus)} />

              {qrPayable && Number.isFinite(expiryRemaining) ? (
                <Text style={{ color: expiryRemaining <= 120000 ? colors.warning : colors.muted, fontWeight: "900" }}>
                  QR expires in {formatCountdown(expiryRemaining)}
                </Text>
              ) : null}

              <Text style={{ color: paid ? colors.success : colors.text, fontWeight: "900", fontSize: 22 }}>
                {formatClinicMoney(qr.amount, qr.currencyCode)}
              </Text>
              <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>
                {paid
                  ? `${categoryLabel} payment has been verified and recorded automatically.`
                  : needsReview
                    ? "The provider confirmed money was received, but CapDent did not auto-apply it. Owner/head doctor must review the reconciliation case."
                    : paymentStatus === "provider_verified"
                      ? "Payment was verified by the provider. CapDent is completing ledger reconciliation; do not collect the amount again."
                      : unusable
                        ? "Do not ask the patient to scan this QR. Generate a new QR only if payment has not already been made."
                        : "Ask the patient to scan this QR with a supported payment app. Keep this screen open until CapDent confirms payment."}
              </Text>
              {failureMessage ? (
                <Text style={{ color: needsReview ? colors.warning : colors.muted, textAlign: "center", fontWeight: "800", lineHeight: 19 }}>
                  {failureMessage}
                </Text>
              ) : null}
            </View>
          </SectionCard>

          <View style={{ flexDirection: "row", gap: 10 }}>
            {paid ? (
              <AppButton
                title="Collect Another"
                icon="add-circle-outline"
                onPress={() => resetPayment()}
                style={{ flex: 1 }}
              />
            ) : needsReview || paymentStatus === "provider_verified" ? (
              <AppButton
                title="Refresh Status"
                icon="refresh-outline"
                variant="secondary"
                onPress={async () => {
                  try {
                    const status = await getCounterPaymentStatus(qr.paymentRequestId);
                    setPaymentStatus(status.status);
                    setFailureMessage(status.failureMessage);
                  } catch (error) {
                    Alert.alert("Status unavailable", error instanceof Error ? error.message : "Please try again.");
                  }
                }}
                style={{ flex: 1 }}
              />
            ) : unusable ? (
              <AppButton
                title="Generate New QR"
                icon="refresh-outline"
                onPress={() => resetPayment({ keepAmount: true })}
                style={{ flex: 1 }}
              />
            ) : (
              <AppButton
                title="Cancel / New QR"
                icon="refresh-outline"
                variant="secondary"
                onPress={() => {
                  Alert.alert(
                    "Replace this QR?",
                    "Generate a new QR only if the patient has not already completed payment. If they already paid, keep this screen and wait for verification.",
                    [
                      { text: "Keep QR", style: "cancel" },
                      { text: "Prepare New QR", onPress: () => resetPayment({ keepAmount: true }) },
                    ]
                  );
                }}
                style={{ flex: 1 }}
              />
            )}
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
