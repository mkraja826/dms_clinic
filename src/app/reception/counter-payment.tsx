import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  cancelCounterPaymentRequest,
  createCounterPaymentCheckout,
  getCounterPaymentQr,
  getCounterPaymentStatus,
  prepareCounterPaymentRequest,
  type CounterPaymentCategory,
  type CounterPaymentQr,
} from "@/lib/counterPayments";
import { searchPatientsPage } from "@/lib/patientDirectory";
import type { Patient } from "@/lib/supabase";

const CATEGORIES: {
  key: CounterPaymentCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
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
  if (status === "reconciliation_required" || status === "partially_reconciled_excess") {
    return "warning";
  }
  if (["failed", "expired", "cancelled", "superseded"].includes(status)) return "danger";
  return "primary";
}

function statusLabel(status: string, locallyExpired: boolean) {
  if (status === "reconciled") return "Paid & recorded";
  if (status === "reconciliation_required" || status === "partially_reconciled_excess") {
    return "Needs review";
  }
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

function StepPill({
  number,
  label,
  active,
  done,
}: {
  number: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  const highlighted = active || done;
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? colors.successSoft : highlighted ? colors.primarySoft : colors.surfaceSoft,
          borderWidth: 1,
          borderColor: done ? colors.success : highlighted ? colors.primary : colors.border,
        }}
      >
        {done ? (
          <Ionicons name="checkmark" size={18} color={colors.success} />
        ) : (
          <Text style={{ color: highlighted ? colors.primary : colors.muted, fontWeight: "900" }}>{number}</Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{ color: highlighted ? colors.text : colors.muted, fontSize: 11, fontWeight: "800" }}
      >
        {label}
      </Text>
    </View>
  );
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
      setPatients(result.patients || []);
    } catch (error) {
      if (sequence !== searchSequence.current) return;
      Alert.alert(
        "Patient search failed",
        error instanceof Error ? error.message : "Please try again."
      );
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
      Alert.alert(
        "QR generation failed",
        error instanceof Error ? error.message : "Please try again."
      );
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

  async function retireCurrentQr() {
    if (!qr?.paymentRequestId) {
      resetPayment({ keepAmount: true });
      return;
    }
    try {
      setGenerating(true);
      await cancelCounterPaymentRequest(qr.paymentRequestId);
      resetPayment({ keepAmount: true });
    } catch (error) {
      Alert.alert(
        "Could not retire QR",
        error instanceof Error ? error.message : "Refresh payment status and try again."
      );
    } finally {
      setGenerating(false);
    }
  }

  const categoryLabel = CATEGORIES.find((item) => item.key === category)?.label || "Payment";
  const paid = paymentStatus === "reconciled";
  const needsReview =
    paymentStatus === "reconciliation_required" || paymentStatus === "partially_reconciled_excess";
  const providerExpiry = qr?.expiresAt ? new Date(qr.expiresAt).getTime() : 0;
  const expiryRemaining = providerExpiry > 0 ? providerExpiry - clock : Number.POSITIVE_INFINITY;
  const locallyExpired = Boolean(
    qr && providerExpiry > 0 && expiryRemaining <= 0 && !paid && !needsReview
  );
  const unusable =
    locallyExpired || ["failed", "expired", "cancelled", "superseded"].includes(paymentStatus);
  const qrPayable = Boolean(
    qr && !paid && !needsReview && !unusable && paymentStatus !== "provider_verified"
  );
  const displayStatus = statusLabel(paymentStatus, locallyExpired);
  const hasAmount = amountValue(amount) > 0;

  const statusBackground = paid
    ? colors.successSoft
    : needsReview
      ? colors.warningSoft
      : unusable
        ? colors.dangerSoft
        : colors.primarySoft;

  const statusIconColor = paid
    ? colors.success
    : needsReview
      ? colors.warning
      : unusable
        ? colors.danger
        : colors.primary;

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
            Patient pays the clinic directly. CapDent records only verified payments.
          </Text>
        </View>
      </View>

      {!qr ? (
        <>
          <View
            style={{
              flexDirection: "row",
              paddingVertical: 4,
              paddingHorizontal: 6,
              alignItems: "flex-start",
            }}
          >
            <StepPill number={1} label="Patient" active={!selectedPatient} done={Boolean(selectedPatient)} />
            <StepPill number={2} label="Type" active={Boolean(selectedPatient)} done={Boolean(selectedPatient)} />
            <StepPill number={3} label="Amount" active={Boolean(selectedPatient && !hasAmount)} done={hasAmount} />
            <StepPill number={4} label="QR" active={Boolean(selectedPatient && hasAmount)} done={false} />
          </View>

          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 15,
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
              1. Select patient
            </Text>

            {selectedPatient ? (
              <View
                style={{
                  padding: 13,
                  borderRadius: 18,
                  backgroundColor: colors.primarySoft,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 11,
                }}
              >
                <Ionicons name="person-circle-outline" size={32} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                    {selectedPatient.name}
                  </Text>
                  <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
                    {selectedPatient.patient_code || "No patient code"}
                    {selectedPatient.phone ? ` • ${selectedPatient.phone}` : ""}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change patient"
                  onPress={() => setSelectedPatient(null)}
                  hitSlop={8}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="swap-horizontal-outline" size={23} color={colors.primary} />
                </Pressable>
              </View>
            ) : (
              <>
                <View
                  style={{
                    minHeight: 52,
                    borderRadius: 17,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 14,
                    gap: 10,
                  }}
                >
                  <Ionicons name="search-outline" size={20} color={colors.muted} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Name, phone or patient code"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    style={{ flex: 1, color: colors.text, fontWeight: "700", minHeight: 50 }}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  {patients.map((patient) => (
                    <Pressable
                      key={patient.id}
                      onPress={() => {
                        setSelectedPatient(patient);
                        setQuery("");
                      }}
                      style={({ pressed }) => ({
                        minHeight: 58,
                        paddingHorizontal: 13,
                        paddingVertical: 10,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                        justifyContent: "center",
                      })}
                    >
                      <Text style={{ color: colors.text, fontWeight: "900" }}>{patient.name}</Text>
                      <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
                        {patient.patient_code || "Patient"}
                        {patient.phone ? ` • ${patient.phone}` : ""}
                      </Text>
                    </Pressable>
                  ))}
                  {!loadingPatients && !patients.length ? (
                    <EmptyState
                      title="No patients found"
                      message="Try another name, phone number or patient code."
                      icon="search-outline"
                    />
                  ) : null}
                </View>
              </>
            )}
          </View>

          {selectedPatient ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 15,
                gap: 13,
              }}
            >
              <View>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
                  2. Collection type
                </Text>
                <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>
                  The selected type is locked into the payment record.
                </Text>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                {CATEGORIES.map((item) => {
                  const selected = category === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setCategory(item.key)}
                      style={{
                        width: "47%",
                        minHeight: 76,
                        padding: 12,
                        borderRadius: 18,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.background,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <Ionicons name={item.icon} size={23} color={selected ? colors.primary : colors.muted} />
                      <Text style={{ color: selected ? colors.primaryDark : colors.text, fontWeight: "900" }}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {selectedPatient ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: hasAmount ? colors.primary : colors.border,
                padding: 15,
                gap: 11,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
                3. Amount to collect
              </Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.muted}
                accessibilityLabel={`${categoryLabel} amount to collect`}
                style={{
                  minHeight: 70,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: hasAmount ? colors.primary : colors.border,
                  backgroundColor: colors.background,
                  color: colors.text,
                  paddingHorizontal: 18,
                  fontSize: 32,
                  fontWeight: "900",
                  textAlign: "center",
                }}
              />
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
                {categoryLabel} • CapDent checks this against the patient&apos;s outstanding category balance.
              </Text>
            </View>
          ) : null}

          <AppButton
            title={hasAmount ? "Generate Payment QR" : "Enter Amount to Continue"}
            icon="qr-code-outline"
            onPress={() => void generateQr()}
            loading={generating}
            disabled={!selectedPatient || !hasAmount}
          />
        </>
      ) : (
        <>
          <View
            style={{
              backgroundColor: statusBackground,
              borderRadius: 26,
              borderWidth: 1,
              borderColor: statusIconColor,
              padding: 18,
              alignItems: "center",
              gap: 13,
            }}
          >
            <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
                  {selectedPatient?.name || "Patient"}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2, fontWeight: "700" }}>
                  {categoryLabel}
                </Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 24, fontWeight: "900" }}>
                {formatClinicMoney(qr.amount, qr.currencyCode)}
              </Text>
            </View>

            {paid ? (
              <View
                style={{
                  width: 154,
                  height: 154,
                  borderRadius: 77,
                  backgroundColor: colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="checkmark-circle" size={108} color={colors.success} />
              </View>
            ) : qrPayable ? (
              <View
                style={{
                  padding: 14,
                  borderRadius: 22,
                  backgroundColor: colors.white,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <SvgXml xml={qr.qrSvg} width={286} height={286} />
              </View>
            ) : (
              <View
                style={{
                  width: 154,
                  height: 154,
                  borderRadius: 77,
                  backgroundColor: colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={
                    paid
                      ? "checkmark-circle"
                      : needsReview
                        ? "warning-outline"
                        : paymentStatus === "provider_verified"
                          ? "shield-checkmark-outline"
                          : unusable
                            ? "close-circle-outline"
                            : "qr-code-outline"
                  }
                  size={86}
                  color={statusIconColor}
                />
              </View>
            )}

            <Text
              accessibilityLiveRegion="polite"
              style={{ color: statusIconColor, fontSize: 24, fontWeight: "900", textAlign: "center" }}
            >
              {displayStatus}
            </Text>
            <StatusBadge label={displayStatus} tone={statusTone(locallyExpired ? "expired" : paymentStatus)} />

            {qrPayable && Number.isFinite(expiryRemaining) ? (
              <View
                style={{
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  backgroundColor: expiryRemaining <= 120000 ? colors.warningSoft : colors.surface,
                }}
              >
                <Text
                  style={{
                    color: expiryRemaining <= 120000 ? colors.warning : colors.text,
                    fontWeight: "900",
                    fontSize: 15,
                  }}
                >
                  QR expires in {formatCountdown(expiryRemaining)}
                </Text>
              </View>
            ) : null}

            <Text style={{ color: colors.text, textAlign: "center", lineHeight: 21, maxWidth: 330 }}>
              {paid
                ? `${categoryLabel} payment verified and recorded automatically.`
                : needsReview
                  ? "Money was verified, but CapDent held this payment for owner/head doctor review instead of applying it automatically."
                  : unusable
                    ? "This QR must not be used. Generate a fresh QR if payment is still required."
                    : paymentStatus === "provider_verified"
                      ? "Payment confirmed by the provider. CapDent is completing the ledger update."
                      : "Ask the patient to scan now. Keep this screen open until CapDent confirms payment."}
            </Text>

            {failureMessage ? (
              <Text style={{ color: colors.warning, textAlign: "center", fontWeight: "800", lineHeight: 19 }}>
                {failureMessage}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton
              title={
                paid
                  ? "Collect Another"
                  : needsReview
                    ? "Close"
                    : unusable
                      ? "Generate New QR"
                      : "Cancel / New QR"
              }
              icon={paid ? "add-circle-outline" : needsReview ? "close-circle-outline" : "refresh-outline"}
              onPress={() => {
                if (paid || needsReview || unusable) resetPayment({ keepAmount: !paid });
                else void retireCurrentQr();
              }}
              loading={generating}
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
