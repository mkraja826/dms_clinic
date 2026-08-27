import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  startCardPaymentAccountOnboarding,
  syncCardPaymentAccount,
} from "@/lib/cardPaymentAccount";
import {
  getPatientPaymentAccountStatus,
  type PatientPaymentAccountStatus,
} from "@/lib/patientPayments";

function statusTone(status?: string): "primary" | "success" | "warning" | "danger" {
  if (status === "connected") return "success";
  if (status === "pending") return "warning";
  if (status === "restricted" || status === "disabled") return "danger";
  return "primary";
}

function statusLabel(status?: string) {
  switch (status) {
    case "connected": return "Connected";
    case "pending": return "Verification pending";
    case "restricted": return "Restricted";
    case "disabled": return "Disabled";
    case "country_required": return "Country required";
    case "unavailable": return "Backend pending";
    default: return "Not connected";
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PatientPaymentsSettingsScreen() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<PatientPaymentAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerBusy, setProviderBusy] = useState(false);

  const canManage = profile?.role === "owner" || profile?.role === "head_doctor";

  async function load() {
    try {
      setLoading(true);
      setStatus(await getPatientPaymentAccountStatus());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile?.clinic_id]);

  async function connectCardAccount() {
    if (!canManage || status?.provider !== "card" || !status.backendReady || providerBusy) return;
    try {
      setProviderBusy(true);
      const result = await startCardPaymentAccountOnboarding();
      const supported = await Linking.canOpenURL(result.onboardingUrl);
      if (!supported) throw new Error("The Stripe onboarding page could not be opened on this device");
      await Linking.openURL(result.onboardingUrl);
      Alert.alert(
        "Card account onboarding opened",
        "Complete Stripe's secure business, identity, and settlement-bank setup in your browser. Return to CapDent and tap Refresh Card Status afterward."
      );
    } catch (error) {
      Alert.alert("Card account setup failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setProviderBusy(false);
    }
  }

  async function refreshCardAccount() {
    if (!canManage || status?.provider !== "card" || providerBusy) return;
    try {
      setProviderBusy(true);
      const result = await syncCardPaymentAccount();
      await load();
      Alert.alert(
        result.status === "connected" ? "Card payments ready" : "Card account updated",
        result.status === "connected"
          ? "The clinic card receiving account can accept patient payments and receive settlements."
          : result.requirementsDue > 0
          ? `Stripe still requires ${result.requirementsDue} onboarding item${result.requirementsDue === 1 ? "" : "s"}. Continue onboarding to enable patient card payments.`
          : "The receiving account is not fully enabled yet."
      );
    } catch (error) {
      Alert.alert("Card status refresh failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setProviderBusy(false);
    }
  }

  const providerIcon = status?.provider === "phonepe" ? "phone-portrait-outline" : "card-outline";
  const connected = status?.status === "connected";
  const cardProvider = status?.provider === "card";
  const phonePeProvider = status?.provider === "phonepe";

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
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
          <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>Patient Payments</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Connect the clinic's receiving account for finalized patient invoices.
          </Text>
        </View>
      </View>

      <SectionCard title="Payment route" subtitle="CapDent chooses the patient payment provider from the clinic country stored on the server.">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={providerIcon} size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>{status?.providerLabel || "Checking provider…"}</Text>
            <Text style={{ color: colors.muted, lineHeight: 19 }}>
              Country: {status?.countryCode || "Not configured"} • Currency: {status?.currencyCode || "Not configured"}
            </Text>
          </View>
          <StatusBadge label={statusLabel(status?.status)} tone={statusTone(status?.status)} />
        </View>
        <View style={{ borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Routing rule</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            {phonePeProvider
              ? "Indian clinics use PhonePe for patient invoice payments."
              : cardProvider
              ? "Clinics outside India use card payments only in V28."
              : "Set a valid clinic country before online patient payments can be enabled."}
          </Text>
        </View>
      </SectionCard>

      <SectionCard
        title="Receiving account"
        subtitle="Patient money settles to the clinic's connected merchant account. CapDent does not ask for bank passwords, UPI PINs, OTPs, or provider API secrets."
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>Payments</Text>
            <StatusBadge label={status?.paymentsEnabled ? "Enabled" : "Off"} tone={status?.paymentsEnabled ? "success" : "primary"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>Settlements</Text>
            <StatusBadge label={status?.settlementsEnabled ? "Enabled" : "Off"} tone={status?.settlementsEnabled ? "success" : "primary"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>Connected</Text>
            <Text style={{ color: colors.muted, fontWeight: "700" }}>{formatDate(status?.connectedAt)}</Text>
          </View>
        </View>

        {!canManage ? (
          <Text style={{ color: colors.warning, fontWeight: "800", lineHeight: 20 }}>
            Only the clinic owner or head doctor can connect or manage the receiving account.
          </Text>
        ) : null}

        {cardProvider ? (
          <View style={{ gap: 10 }}>
            <AppButton
              title={connected ? "Continue / Update Card Account" : "Connect Card Receiving Account"}
              icon="card-outline"
              onPress={() => void connectCardAccount()}
              loading={providerBusy}
              loadingTitle="Opening secure onboarding…"
              disabled={!canManage || !status?.backendReady}
            />
            <AppButton
              title="Refresh Card Status"
              icon="refresh-outline"
              variant="secondary"
              onPress={() => void refreshCardAccount()}
              disabled={!canManage || !status?.backendReady || providerBusy}
            />
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
              Stripe-hosted onboarding opens in your system browser. CapDent stores only the connected account ID and safe readiness status.
            </Text>
          </View>
        ) : phonePeProvider ? (
          <View style={{ gap: 10 }}>
            <AppButton
              title={connected ? "Manage PhonePe Accounts" : "Add PhonePe Merchant Account"}
              icon="phone-portrait-outline"
              onPress={() => router.push("/settings/phonepe-accounts" as never)}
              disabled={!canManage || !status?.backendReady}
            />
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
              Owners and head doctors can add multiple PhonePe Merchant IDs. New accounts stay pending and cannot receive patient payments until provider verification is complete. Never enter PhonePe passwords, OTPs, API keys, or UPI PINs into CapDent.
            </Text>
          </View>
        ) : (
          <AppButton title="Set Clinic Country First" icon="location-outline" disabled />
        )}
      </SectionCard>

      <SectionCard title="Patient invoice rule" subtitle="Online payment is attached only to the receptionist-finalized consolidated invoice.">
        <View style={{ gap: 9 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>1. Record OP, X-ray, medication, treatment, and other charges internally.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>2. Reception reviews all charges and payments together.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>3. Reception finalizes one patient-facing invoice.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>4. Reception manually sends the invoice by WhatsApp/print/share.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>5. A payment link appears only for the verified remaining balance.</Text>
        </View>
      </SectionCard>

      <AppButton title="Refresh Status" icon="refresh-outline" variant="secondary" onPress={() => void load()} loading={loading} loadingTitle="Checking receiving account…" />
    </Screen>
  );
}
