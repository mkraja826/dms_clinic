import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { QuickAction } from "@/components/QuickAction";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusChip } from "@/components/StatusChip";
import { SuccessNotice } from "@/components/SuccessNotice";
import { colors } from "@/constants/colors";
import { searchPatientsPage } from "@/lib/patientDirectory";
import { addPayment, createInvoice, getPendingPayments, Invoice, Patient } from "@/lib/supabase";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";
import { openWhatsApp, paymentReminderMessage } from "@/lib/whatsapp";

const RUPEE = "\u20B9";

function money(value: number | string | null | undefined) {
  return `${RUPEE}${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function paymentState(invoice: Invoice) {
  const paid = Number(invoice.paid_amount || 0);
  const due = Number(invoice.due_amount || 0);
  if (due <= 0) return "Paid";
  return paid > 0 ? "Partially paid" : "Unpaid";
}

function patientMatches(patient: Patient, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  return [patient.name, patient.phone, patient.patient_code]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

function invoiceMatches(invoice: Invoice, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  return [invoice.id, invoice.id.slice(0, 8), invoice.patients?.name, invoice.patients?.phone]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

export default function BillingScreen() {
  const [pending, setPending] = useState<Invoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientPhone, setPatientPhone] = useState("");
  const [selectedInvoicePatientId, setSelectedInvoicePatientId] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [paid, setPaid] = useState("");
  const [paymentInvoice, setPaymentInvoice] = useState("");
  const [selectedPaymentInvoiceId, setSelectedPaymentInvoiceId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [invoiceSuccess, setInvoiceSuccess] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const invoiceMutation = useImmediateMutationLock();
  const paymentMutation = useImmediateMutationLock();

  const selectedInvoicePatient = useMemo(
    () => patients.find((patient) => patient.id === selectedInvoicePatientId) ?? null,
    [patients, selectedInvoicePatientId]
  );

  const invoicePatientOptions = useMemo(() => {
    const rows = patients.filter((patient) => patientMatches(patient, patientPhone));
    return rows.slice(0, patientPhone.trim() ? 8 : 5);
  }, [patients, patientPhone]);

  const selectedPaymentInvoice = useMemo(
    () => pending.find((invoice) => invoice.id === selectedPaymentInvoiceId) ?? null,
    [pending, selectedPaymentInvoiceId]
  );

  const paymentInvoiceOptions = useMemo(() => {
    const rows = pending.filter((invoice) => invoiceMatches(invoice, paymentInvoice));
    return rows.slice(0, paymentInvoice.trim() ? 8 : 5);
  }, [pending, paymentInvoice]);

  const loadPatientOptions = useCallback(async (searchText = "") => {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({
        query: searchText,
        page: 1,
        pageSize: searchText.trim() ? 8 : 5,
      });

      if (requestId === patientRequestRef.current) {
        setPatients(result.patients);
      }
    } catch (error) {
      Alert.alert("Patient search failed", error instanceof Error ? error.message : "Unable to load patients.");
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payments = await getPendingPayments();
      setPending(payments);
      await loadPatientOptions("");
    } catch (error) {
      Alert.alert("Billing error", error instanceof Error ? error.message : "Unable to load billing.");
    } finally {
      setLoading(false);
    }
  }, [loadPatientOptions]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!patientSearchMountedRef.current) {
      patientSearchMountedRef.current = true;
      return;
    }

    setSelectedInvoicePatientId(null);
    const timeout = setTimeout(() => {
      void loadPatientOptions(patientPhone);
    }, 260);

    return () => clearTimeout(timeout);
  }, [patientPhone, loadPatientOptions]);

  async function saveInvoice() {
    if (savingInvoice || !invoiceMutation.tryLock()) return;

    const typedPatient = patientPhone.trim();
    let patient = selectedInvoicePatient;
    const totalAmount = Number(total);
    const paidAmount = Number(paid || 0);

    setSavingInvoice(true);
    setInvoiceSuccess(null);
    try {
      if (!patient && typedPatient) {
        const result = await searchPatientsPage({
          query: typedPatient,
          page: 1,
          pageSize: 8,
        });

        patient = result.patients.find(
          (item) => item.phone === typedPatient || item.name.toLowerCase() === typedPatient.toLowerCase()
        ) ?? null;
      }

      if (!patient || !Number.isFinite(totalAmount) || totalAmount <= 0) {
        Alert.alert("Missing details", "Select a patient and enter invoice total.");
        return;
      }

      if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
        Alert.alert("Check paid amount", "Paid amount should be between 0 and the invoice total.");
        return;
      }

      await createInvoice({ patient_id: patient.id, total_amount: totalAmount, paid_amount: paidAmount });
      setInvoiceSuccess(`Invoice created for ${patient.name}.`);
      setPatientPhone("");
      setSelectedInvoicePatientId(null);
      setTotal("");
      setPaid("");
      await load();
    } catch (error) {
      Alert.alert("Invoice failed", error instanceof Error ? error.message : "Unable to create invoice.");
    } finally {
      invoiceMutation.release();
      setSavingInvoice(false);
    }
  }

  async function savePayment() {
    const typedInvoice = paymentInvoice.trim();
    const fallbackInvoice = typedInvoice
      ? pending.find((item) => item.id.startsWith(typedInvoice) || item.patients?.phone === typedInvoice)
      : null;
    const invoice = selectedPaymentInvoice ?? fallbackInvoice;
    const amount = Number(paymentAmount);

    if (!invoice || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Missing details", "Select a pending invoice and enter payment amount.");
      return;
    }

    if (amount > Number(invoice.due_amount)) {
      Alert.alert("Check payment amount", `This invoice due is ${money(invoice.due_amount)}.`);
      return;
    }

    if (savingPayment || !paymentMutation.tryLock()) return;

    setSavingPayment(true);
    setPaymentSuccess(null);
    try {
      await addPayment({ invoice_id: invoice.id, patient_id: invoice.patient_id, amount, payment_method: "cash" });
      setPaymentSuccess(`${money(amount)} payment recorded for invoice ${invoice.id.slice(0, 8)}.`);
      setPaymentInvoice("");
      setSelectedPaymentInvoiceId(null);
      setPaymentAmount("");
      await load();
    } catch (error) {
      Alert.alert("Payment failed", error instanceof Error ? error.message : "Unable to add payment.");
    } finally {
      paymentMutation.release();
      setSavingPayment(false);
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <SectionCard title="Add Invoice" subtitle="Search and select the patient before creating a treatment or service invoice.">
        {invoiceSuccess ? <SuccessNotice title="Invoice created" message={invoiceSuccess} /> : null}
        <AppInput
          label="Find patient"
          value={patientPhone}
          onChangeText={(value) => {
            setPatientPhone(value);
            setSelectedInvoicePatientId(null);
            setInvoiceSuccess(null);
          }}
          placeholder="Name, phone, or patient code"
        />

        <PatientSelectList
          patients={invoicePatientOptions}
          selectedPatientId={selectedInvoicePatient?.id ?? null}
          loading={loadingPatients}
          onSelect={(patient) => {
            setSelectedInvoicePatientId(patient.id);
            setPatientPhone(patient.phone || patient.name);
          }}
        />

        <AppInput label="Total amount" value={total} onChangeText={setTotal} keyboardType="numeric" />
        <AppInput label="Paid amount" value={paid} onChangeText={setPaid} keyboardType="numeric" />
        <AppButton
          title="Create Invoice"
          icon="receipt-outline"
          onPress={saveInvoice}
          loading={savingInvoice}
          loadingTitle="Creating invoice..."
          disabled={savingPayment}
        />
      </SectionCard>

      <SectionCard title="Add Payment" subtitle="Select the pending invoice first so payment is recorded against the right patient.">
        {paymentSuccess ? <SuccessNotice title="Payment recorded" message={paymentSuccess} /> : null}
        <AppInput
          label="Find pending invoice"
          value={paymentInvoice}
          onChangeText={(value) => {
            setPaymentInvoice(value);
            setSelectedPaymentInvoiceId(null);
            setPaymentSuccess(null);
          }}
          placeholder="Invoice ID, patient name, or phone"
        />

        <InvoiceSelectList
          invoices={paymentInvoiceOptions}
          selectedInvoiceId={selectedPaymentInvoice?.id ?? null}
          loading={loading}
          onSelect={(invoice) => {
            setSelectedPaymentInvoiceId(invoice.id);
            setPaymentInvoice(invoice.id.slice(0, 8));
            setPaymentAmount(String(Math.round(Number(invoice.due_amount || 0))));
          }}
        />

        <AppInput label="Amount" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="numeric" />
        <AppButton
          title="Collect Payment"
          icon="cash-outline"
          onPress={savePayment}
          loading={savingPayment}
          loadingTitle="Saving payment..."
          disabled={savingInvoice}
        />
      </SectionCard>

      <SectionCard title="Pending Payments" subtitle="Track dues and send WhatsApp payment reminders when needed.">
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && !pending.length ? (
          <EmptyState title="No pending payments" body="Paid invoices will stay out of this queue." icon="checkmark-circle-outline" />
        ) : null}
        {pending.map((invoice) => (
          <View key={invoice.id} style={{ gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ flex: 1, color: colors.text, fontWeight: "800", fontSize: 16 }}>{invoice.patients?.name ?? "Patient"}</Text>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <StatusChip label={paymentState(invoice)} tone="warning" />
                <StatusChip label={`Due ${money(invoice.due_amount)}`} tone="warning" />
              </View>
            </View>
            <Text selectable style={{ color: colors.muted }}>
              Invoice {invoice.id.slice(0, 8)} - Total {money(invoice.total_amount)} - Paid {money(invoice.paid_amount)}
            </Text>
            <QuickAction
              icon="logo-whatsapp"
              label="Payment reminder"
              onPress={() => openWhatsApp(invoice.patients?.phone, paymentReminderMessage({ patientName: invoice.patients?.name ?? "Patient", dueAmount: Number(invoice.due_amount) }))}
            />
          </View>
        ))}
      </SectionCard>
    </Screen>
  );
}

function PatientSelectList({
  patients,
  selectedPatientId,
  loading,
  onSelect,
}: {
  patients: Patient[];
  selectedPatientId: string | null;
  loading: boolean;
  onSelect: (patient: Patient) => void;
}) {
  if (loading) {
    return <Text style={{ color: colors.muted }}>Loading patients...</Text>;
  }

  if (!patients.length) {
    return (
      <View style={{ padding: 12, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.muted }}>No matching patient found.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {patients.map((patient) => {
        const selected = selectedPatientId === patient.id;

        return (
          <Pressable
            key={patient.id}
            accessibilityRole="button"
            accessibilityLabel={`Select patient ${patient.name}`}
            onPress={() => onSelect(patient)}
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceSoft : colors.background,
              gap: 6,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: "800" }}>
                {patient.name}
              </Text>
              <StatusChip label={selected ? "Selected" : "Select"} tone={selected ? "success" : "primary"} />
            </View>
            <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
              {patient.phone || "No phone"} - {patient.patient_code || "No patient code"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InvoiceSelectList({
  invoices,
  selectedInvoiceId,
  loading,
  onSelect,
}: {
  invoices: Invoice[];
  selectedInvoiceId: string | null;
  loading: boolean;
  onSelect: (invoice: Invoice) => void;
}) {
  if (loading) {
    return <Text style={{ color: colors.muted }}>Loading pending invoices...</Text>;
  }

  if (!invoices.length) {
    return (
      <View style={{ padding: 12, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.muted }}>No matching pending invoice found.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {invoices.map((invoice) => {
        const selected = selectedInvoiceId === invoice.id;

        return (
          <Pressable
            key={invoice.id}
            accessibilityRole="button"
            accessibilityLabel={`Select invoice ${invoice.id.slice(0, 8)}`}
            onPress={() => onSelect(invoice)}
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceSoft : colors.background,
              gap: 7,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: "800" }}>
                {invoice.patients?.name ?? "Patient"}
              </Text>
              <StatusChip label={selected ? "Selected" : paymentState(invoice)} tone={selected ? "success" : "warning"} />
            </View>
            <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
              Invoice {invoice.id.slice(0, 8)} - {invoice.patients?.phone || "No phone"}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
              Total {money(invoice.total_amount)} - Paid {money(invoice.paid_amount)} - Due {money(invoice.due_amount)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}