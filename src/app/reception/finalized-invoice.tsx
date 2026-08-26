import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { loadConsolidatedInvoiceSnapshot } from "@/lib/consolidatedBilling";
import { formatClinicMoney } from "@/lib/clinicLocale";
import type { CapDentInvoiceSnapshot } from "@/lib/invoiceDocument";
import {
  getPatientPaymentAccountStatus,
  type PatientPaymentAccountStatus,
} from "@/lib/patientPayments";
import {
  getLatestPatientPaymentRequest,
  type PatientPaymentRequest,
} from "@/lib/patientPaymentRequests";
import { finalizedInvoiceMessage, openWhatsApp } from "@/lib/whatsapp";

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

function paymentStatusTone(status?: string | null): "primary" | "success" | "warning" | "danger" {
  if (status === "reconciled") return "success";
  if (status === "provider_verified" || status === "pending") return "warning";
  if (status === "failed" || status === "expired" || status === "cancelled") return "danger";
  return "primary";
}

export default function FinalizedInvoiceViewerScreen() {
  const params = useLocalSearchParams<{ bill_id?: string }>();
  const billId = typeof params.bill_id === "string" ? params.bill_id : "";
  const [snapshot, setSnapshot] = useState<CapDentInvoiceSnapshot | null>(null);
  const [paymentAccount, setPaymentAccount] = useState<PatientPaymentAccountStatus | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<PatientPaymentRequest | null>(null);
  const [paymentBackendReady, setPaymentBackendReady] = useState(true);
  const [paymentBackendReason, setPaymentBackendReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  async function load() {
    if (!billId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [nextSnapshot, account, requestResult] = await Promise.all([
        loadConsolidatedInvoiceSnapshot(billId),
        getPatientPaymentAccountStatus(),
        getLatestPatientPaymentRequest(billId),
      ]);
      setSnapshot(nextSnapshot);
      setPaymentAccount(account);
      setPaymentRequest(requestResult.request);
      setPaymentBackendReady(requestResult.backendReady);
      setPaymentBackendReason(requestResult.reason || null);
    } catch (error) {
      Alert.alert(
        "Final invoice unavailable",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [billId]);

  async function sendWhatsApp() {
    if (!snapshot || sending) return;
    if (!snapshot.patient.phone) {
      Alert.alert("Phone missing", "Add a valid patient phone number before sending the invoice on WhatsApp.");
      return;
    }

    try {
      setSending(true);
      await openWhatsApp(snapshot.patient.phone, finalizedInvoiceMessage(snapshot));
    } finally {
      setSending(false);
    }
  }

  if (!billId && !loading) {
    return (
      <Screen>
        <EmptyState
          title="Invoice ID missing"
          message="Open the invoice again from Finalized Invoices."
          icon="document-text-outline"
        />
      </Screen>
    );
  }

  const currency = snapshot?.currencyCode || "INR";
  const receivingAccountReady = Boolean(
    paymentAccount?.backendReady &&
      paymentAccount.status === "connected" &&
      paymentAccount.paymentsEnabled &&
      paymentAccount.settlementsEnabled
  );

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
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
          <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>
            Final Invoice
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Review the frozen patient-facing invoice before manually sending it.
          </Text>
        </View>
      </View>

      {snapshot ? (
        <>
          <SectionCard title={snapshot.invoiceNumber || "Final invoice"} subtitle={`Finalized ${formatDate(snapshot.issuedAt)}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
                  {snapshot.clinic.name}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 3 }}>
                  {snapshot.patient.name}
                  {snapshot.patient.patientCode ? ` • ${snapshot.patient.patientCode}` : ""}
                </Text>
              </View>
              <StatusBadge
                label={snapshot.due > 0 ? "Balance due" : "Paid"}
                tone={snapshot.due > 0 ? "warning" : "success"}
              />
            </View>
          </SectionCard>

          <SectionCard title="Invoice details" subtitle="These lines come from the immutable finalized snapshot.">
            <View style={{ gap: 10 }}>
              {snapshot.lines.map((line, index) => (
                <View
                  key={`${line.label}-${index}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    paddingBottom: 10,
                    borderBottomWidth: index === snapshot.lines.length - 1 ? 0 : 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ flex: 1, color: colors.text, fontWeight: "800", lineHeight: 20 }}>
                    {line.label}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    {formatClinicMoney(line.amount, currency)}
                  </Text>
                </View>
              ))}
            </View>
          </SectionCard>

          <SectionCard title="Payment summary">
            <View style={{ gap: 9 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ flex: 1, color: colors.muted, fontWeight: "700" }}>Total</Text>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {formatClinicMoney(snapshot.total, currency)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ flex: 1, color: colors.muted, fontWeight: "700" }}>Paid</Text>
                <Text style={{ color: colors.success, fontWeight: "900" }}>
                  {formatClinicMoney(snapshot.paid, currency)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ flex: 1, color: colors.muted, fontWeight: "700" }}>Balance</Text>
                <Text style={{ color: snapshot.due > 0 ? colors.warning : colors.success, fontWeight: "900" }}>
                  {formatClinicMoney(snapshot.due, currency)}
                </Text>
              </View>
            </View>
          </SectionCard>

          {snapshot.due > 0 ? (
            <SectionCard
              title="Online payment readiness"
              subtitle="The clinic receiving account and provider request backend are checked separately from the legacy CapDent payment ledger."
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    {paymentAccount?.providerLabel || "Online payment"}
                  </Text>
                  <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
                    {receivingAccountReady
                      ? "Clinic receiving account is connected and settlement-enabled."
                      : paymentAccount?.backendReady
                        ? "Owner must connect and verify the clinic receiving account before a payment link can be created."
                        : "Receiving-account backend is not deployed in this environment yet."}
                  </Text>
                </View>
                <StatusBadge
                  label={receivingAccountReady ? "Account ready" : "Not ready"}
                  tone={receivingAccountReady ? "success" : "warning"}
                />
              </View>

              {paymentRequest ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {formatClinicMoney(paymentRequest.amount, paymentRequest.currencyCode || currency)} request
                    </Text>
                    <Text style={{ color: colors.muted, marginTop: 3 }}>
                      Provider state: {paymentRequest.status.replaceAll("_", " ")}
                    </Text>
                  </View>
                  <StatusBadge
                    label={paymentRequest.status.replaceAll("_", " ")}
                    tone={paymentStatusTone(paymentRequest.status)}
                  />
                </View>
              ) : null}

              {!paymentBackendReady ? (
                <Text style={{ color: colors.warning, fontWeight: "800", lineHeight: 20 }}>
                  {paymentBackendReason || "Online payment request backend is pending."}
                </Text>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
                Pay Now is intentionally disabled until the trusted PhonePe/card adapter creates a secure hosted checkout URL and the webhook reconciliation path is complete.
              </Text>
            </SectionCard>
          ) : null}

          {snapshot.notes ? (
            <SectionCard title="Notes">
              <Text style={{ color: colors.text, lineHeight: 21 }}>{snapshot.notes}</Text>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Send to patient"
            subtitle="Nothing is sent automatically. Reception opens WhatsApp and confirms the message manually."
          >
            <AppButton
              title="Send Invoice on WhatsApp"
              icon="logo-whatsapp"
              onPress={() => void sendWhatsApp()}
              loading={sending}
              loadingTitle="Opening WhatsApp…"
              disabled={!snapshot.patient.phone}
            />
            {!snapshot.patient.phone ? (
              <Text style={{ color: colors.warning, fontWeight: "800", lineHeight: 20 }}>
                Patient phone number is missing. Add it before using WhatsApp.
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
              The current WhatsApp message contains the finalized invoice summary only. No Pay Now URL is included until the provider adapter and verified reconciliation layer are complete.
            </Text>
          </SectionCard>
        </>
      ) : !loading ? (
        <EmptyState
          title="Invoice not available"
          message="Refresh or return to Finalized Invoices and open it again."
          icon="document-text-outline"
        />
      ) : null}
    </Screen>
  );
}
