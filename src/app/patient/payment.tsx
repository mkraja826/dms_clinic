import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { PaymentCategory, supabase } from "@/lib/supabase";

type PendingPatient = {
  patient_id: string;
  patient_name: string;
  patient_phone?: string | null;
  patient_code?: string | null;
  pending_amount: number;
  invoice_count: number;
  last_invoice_id?: string | null;
  last_invoice_date?: string | null;
};

type PendingInvoice = {
  invoice_id: string;
  invoice_type?: string | null;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  created_at: string;
};

const PAYMENT_METHODS = ["Cash", "UPI", "Card"];
const PAYMENT_CATEGORIES: { key: PaymentCategory; label: string }[] = [
  { key: "pending_collection", label: "Pending" },
  { key: "op_fee", label: "OP Fee" },
  { key: "xray_fee", label: "X-ray" },
  { key: "medication_fee", label: "Medication" },
  { key: "treatment_fee", label: "Treatment" },
  { key: "other", label: "Other" },
];

function money(value?: number | string | null) {
  return `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function invoiceTypeLabel(type?: string | null) {
  switch (type) {
    case "op_fee":
    case "consultation_fee":
      return "OP Fee";
    case "xray_fee":
      return "X-ray Fee";
    case "medication_fee":
      return "Medication Fee";
    case "treatment_fee":
    case "treatment":
      return "Treatment";
    case "pending_collection":
      return "Pending Collection";
    case "other":
      return "Other Fee";
    default:
      return "Treatment / Other";
  }
}

function normalizePaymentCategory(type?: string | null): PaymentCategory {
  if (
    type === "op_fee" ||
    type === "xray_fee" ||
    type === "medication_fee" ||
    type === "treatment_fee" ||
    type === "pending_collection" ||
    type === "other"
  ) {
    return type;
  }

  return "pending_collection";
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 12000): Promise<T> {
  return await Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Request timed out. Please check network and try again.")), timeoutMs);
    }),
  ]);
}

export default function CollectPendingPaymentScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const incomingPatientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [patients, setPatients] = useState<PendingPatient[]>([]);
  const [invoices, setInvoices] = useState<PendingInvoice[]>([]);

  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PendingPatient | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentCategory, setPaymentCategory] = useState<PaymentCategory>("pending_collection");
  const [notes, setNotes] = useState("Pending amount collected");

  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const collectPaymentLockRef = useRef(false);

  async function loadPatients(searchText = search) {
    try {
      setLoadingPatients(true);

      const { data, error } = await withTimeout(
        supabase.rpc("get_pending_payment_patients", {
          p_search: searchText.trim() || null,
        }),
        12000
      );

      if (error) throw error;

      const rows = (data || []) as PendingPatient[];
      setPatients(rows);
      return rows;
    } catch (error) {
      Alert.alert("Pending payments load failed", getErrorMessage(error));
      setPatients([]);
      return [];
    } finally {
      setLoadingPatients(false);
    }
  }

  async function loadInvoices(patient: PendingPatient) {
    try {
      setLoadingInvoices(true);

      const { data, error } = await withTimeout(
        supabase.rpc("get_patient_pending_invoices", {
          p_patient_id: patient.patient_id,
        }),
        12000
      );

      if (error) throw error;

      const rows = (data || []) as PendingInvoice[];
      setInvoices(rows);
      setSelectedInvoiceId(null);
      setAmount(String(Math.round(Number(patient.pending_amount || 0))));
    } catch (error) {
      Alert.alert("Invoice load failed", getErrorMessage(error));
      setInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }

  async function selectPatientById(patientId: string) {
    try {
      const rows = await loadPatients("");

      const found = rows.find((patient) => patient.patient_id === patientId);

      if (found) {
        selectPatient(found);
        return;
      }

      const { data: patientData, error: patientError } = await supabase
        .from("patients")
        .select("id,name,phone,patient_code")
        .eq("id", patientId)
        .maybeSingle();

      if (patientError) throw patientError;

      if (!patientData) {
        Alert.alert("Patient not found", "Open from patient profile again.");
        return;
      }

      const { data: invoiceRows, error: invoiceError } = await supabase.rpc(
        "get_patient_pending_invoices",
        {
          p_patient_id: patientId,
        }
      );

      if (invoiceError) throw invoiceError;

      const pendingInvoices = (invoiceRows || []) as PendingInvoice[];
      const pendingAmount = pendingInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.due_amount || 0),
        0
      );

      const selected: PendingPatient = {
        patient_id: patientData.id,
        patient_name: patientData.name,
        patient_phone: patientData.phone,
        patient_code: patientData.patient_code,
        pending_amount: pendingAmount,
        invoice_count: pendingInvoices.length,
        last_invoice_id: pendingInvoices[0]?.invoice_id || null,
        last_invoice_date: pendingInvoices[0]?.created_at || null,
      };

      setSelectedPatient(selected);
      setInvoices(pendingInvoices);
      setSelectedInvoiceId(null);
      setAmount(pendingAmount > 0 ? String(Math.round(pendingAmount)) : "");
      setPaymentMethod("Cash");
      setPaymentCategory("pending_collection");
      setNotes("Pending amount collected");
    } catch (error) {
      Alert.alert("Patient due load failed", getErrorMessage(error));
    }
  }

  useEffect(() => {
    if (incomingPatientId) {
      selectPatientById(incomingPatientId);
    } else {
      loadPatients("");
    }
  }, [incomingPatientId]);

  const totalPending = useMemo(() => {
    if (selectedPatient) return Number(selectedPatient.pending_amount || 0);
    return patients.reduce((sum, patient) => sum + Number(patient.pending_amount || 0), 0);
  }, [patients, selectedPatient]);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.invoice_id === selectedInvoiceId) || null,
    [invoices, selectedInvoiceId]
  );

  function selectPatient(patient: PendingPatient) {
    setSelectedPatient(patient);
    setSelectedInvoiceId(null);
    setAmount(String(Math.round(Number(patient.pending_amount || 0))));
    setPaymentMethod("Cash");
    setPaymentCategory("pending_collection");
    setNotes("Pending amount collected");
    loadInvoices(patient);
  }

  function selectInvoice(invoice: PendingInvoice) {
    setSelectedInvoiceId(invoice.invoice_id);
    setAmount(String(Math.round(Number(invoice.due_amount || 0))));
    setPaymentCategory(normalizePaymentCategory(invoice.invoice_type));
    setNotes(`${invoiceTypeLabel(invoice.invoice_type)} collected`);
  }

  async function collectPayment() {
    if (saving || collectPaymentLockRef.current) return;

    if (!selectedPatient) {
      Alert.alert("Patient missing", "Select patient first.");
      return;
    }

    const payAmount = toNumber(amount);

    if (payAmount <= 0) {
      Alert.alert("Invalid amount", "Enter amount greater than zero.");
      return;
    }

    const limitAmount = selectedInvoice ? Number(selectedInvoice.due_amount || 0) : Number(selectedPatient.pending_amount || 0);

    if (payAmount > limitAmount) {
      Alert.alert(
        "Amount too high",
        `Maximum collectable amount is ${money(limitAmount)}.`
      );
      return;
    }

    collectPaymentLockRef.current = true;
    setSaving(true);

    try {
      const { error } = await withTimeout(
        supabase.rpc("record_patient_payment", {
          p_patient_id: selectedPatient.patient_id,
          p_invoice_id: selectedInvoiceId,
          p_amount: payAmount,
          p_payment_method: paymentMethod,
          p_payment_category: paymentCategory,
          p_notes: notes.trim() || "Pending amount collected",
        }),
        12000
      );

      if (error) throw error;

      Alert.alert(
        "Payment updated",
        `${money(payAmount)} collected. Invoice payment status updated.`,
        [
          {
            text: "Open Patient",
            onPress: () => router.push(`/patient/${selectedPatient.patient_id}` as never),
          },
          {
            text: "Continue",
          },
        ]
      );

      const previousPatientId = selectedPatient.patient_id;

      if (previousPatientId) {
        await selectPatientById(previousPatientId);
      } else {
        await loadPatients(search);
      }
    } catch (error) {
      Alert.alert("Payment failed", getErrorMessage(error));
    } finally {
      collectPaymentLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen refreshing={loadingPatients || loadingInvoices} onRefresh={() => selectedPatient ? selectPatientById(selectedPatient.patient_id) : loadPatients(search)}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Collect Pending
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Collect full or partial due amount safely. Choose invoice when needed, then record cash, UPI, or card payment.
        </Text>
      </View>

      <SectionCard title="Pending Summary" subtitle="Shows total due amount for the current search or selected patient.">
        <View
          style={{
            padding: 16,
            borderRadius: 24,
            backgroundColor: colors.warningSoft,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 5,
          }}
        >
          <Ionicons name="wallet-outline" size={34} color={colors.warning} />
          <Text style={{ color: colors.muted, fontWeight: "800" }}>
            Total Pending Showing
          </Text>
          <Text style={{ color: colors.text, fontSize: 40, fontWeight: "900" }}>
            {money(totalPending)}
          </Text>
        </View>
      </SectionCard>

      {!selectedPatient ? (
        <SectionCard title="Search Patient" subtitle="Search by name, phone, or patient ID to find pending dues.">
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
              placeholder="Search name, phone, or patient ID"
              placeholderTextColor={colors.muted}
              style={{
                flex: 1,
                minHeight: 54,
                color: colors.text,
                fontSize: 16,
              }}
              returnKeyType="search"
              onSubmitEditing={() => loadPatients(search)}
            />

            <Pressable onPress={() => loadPatients(search)}>
              <Ionicons name="arrow-forward-circle" size={27} color={colors.primary} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton
              title="Search"
              icon="search-outline"
              onPress={() => loadPatients(search)}
              style={{ flex: 1 }}
            />

            <AppButton
              title="Clear"
              icon="close-circle-outline"
              variant="secondary"
              onPress={() => {
                setSearch("");
                loadPatients("");
              }}
              style={{ flex: 1 }}
            />
          </View>

          {loadingPatients ? (
            <Text style={{ color: colors.muted }}>Loading pending patients...</Text>
          ) : patients.length ? (
            <View style={{ gap: 10 }}>
              {patients.map((patient) => (
                <Pressable
                  key={patient.patient_id}
                  onPress={() => selectPatient(patient)}
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
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 18,
                      backgroundColor: colors.warningSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="person-outline" size={22} color={colors.warning} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {patient.patient_name}
                    </Text>

                    <Text style={{ color: colors.muted, marginTop: 2 }}>
                      {patient.patient_phone || "No phone"}
                      {patient.patient_code ? ` • ${patient.patient_code}` : ""}
                    </Text>

                    <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
                      {patient.invoice_count} pending invoice{patient.invoice_count === 1 ? "" : "s"}
                    </Text>
                  </View>

                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ color: colors.warning, fontSize: 17, fontWeight: "900" }}>
                      {money(patient.pending_amount)}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyState
              title="No pending patients"
              message="No pending invoices found for this search."
              icon="wallet-outline"
            />
          )}
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Selected Patient" subtitle="Confirm patient and pending amount before recording payment.">
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 18,
                    backgroundColor: colors.warningSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="person-outline" size={22} color={colors.warning} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
                    {selectedPatient.patient_name}
                  </Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>
                    {selectedPatient.patient_phone || "No phone"}
                    {selectedPatient.patient_code ? ` • ${selectedPatient.patient_code}` : ""}
                  </Text>
                </View>

                <StatusBadge label={money(selectedPatient.pending_amount)} tone="warning" />
              </View>

              <AppButton
                title="Change Patient"
                icon="swap-horizontal-outline"
                variant="secondary"
                onPress={() => {
                  setSelectedPatient(null);
                  setSelectedInvoiceId(null);
                  setInvoices([]);
                  setAmount("");
                }}
              />
            </View>
          </SectionCard>

          <SectionCard title="Pending Invoices" subtitle="Choose a specific invoice or leave unselected to collect against total pending.">
            {loadingInvoices ? (
              <Text style={{ color: colors.muted }}>Loading invoices...</Text>
            ) : invoices.length ? (
              <View style={{ gap: 10 }}>
                {invoices.map((invoice) => {
                  const selected = selectedInvoiceId === invoice.invoice_id;
                  return (
                    <Pressable
                      key={invoice.invoice_id}
                      onPress={() => selectInvoice(invoice)}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.background,
                        borderRadius: 18,
                        padding: 12,
                        gap: 5,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                        <Text style={{ color: colors.text, fontWeight: "900", flex: 1 }}>
                          {invoiceTypeLabel(invoice.invoice_type)}
                        </Text>
                        <StatusBadge label={money(invoice.due_amount)} tone="warning" />
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {formatDate(invoice.created_at)} • {invoice.status}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                title="No pending invoices"
                message="This patient currently has no collectable pending invoice."
                icon="receipt-outline"
              />
            )}
          </SectionCard>

          <SectionCard title="Collect Payment" subtitle="Check amount, category, method, and notes before saving.">
            <AppInput
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
            />

            <View style={{ flexDirection: "row", gap: 10 }}>
              {PAYMENT_METHODS.map((method) => {
                const selected = paymentMethod === method;
                return (
                  <Pressable
                    key={method}
                    onPress={() => setPaymentMethod(method)}
                    style={{
                      flex: 1,
                      minHeight: 48,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.background,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>{method}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {PAYMENT_CATEGORIES.map((item) => {
                const selected = paymentCategory === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setPaymentCategory(item.key)}
                    style={{
                      minHeight: 40,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.background,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900", fontSize: 13 }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <AppInput
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional note"
            />

            <AppButton
              title="Collect Payment"
              icon="cash-outline"
              onPress={collectPayment}
              loading={saving}
              loadingTitle="Saving payment..."
            />
          </SectionCard>
        </>
      )}

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
