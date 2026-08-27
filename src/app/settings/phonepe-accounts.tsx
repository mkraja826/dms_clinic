import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  addPhonePePaymentAccount,
  disablePhonePePaymentAccount,
  listPhonePePaymentAccounts,
  setDefaultPhonePePaymentAccount,
  type PhonePePaymentAccount,
} from "@/lib/phonePePaymentAccounts";

function tone(status: string): "primary" | "success" | "warning" | "danger" {
  if (status === "connected") return "success";
  if (status === "pending") return "warning";
  if (status === "disabled" || status === "restricted") return "danger";
  return "primary";
}

export default function PhonePeAccountsScreen() {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<PhonePePaymentAccount[]>([]);
  const [label, setLabel] = useState("Primary");
  const [merchantId, setMerchantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const canManage = profile?.role === "owner" || profile?.role === "head_doctor";

  async function load() {
    try {
      setLoading(true);
      setAccounts(await listPhonePePaymentAccounts());
    } catch (error) {
      Alert.alert("Could not load PhonePe accounts", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, profile?.clinic_id]);

  async function addAccount() {
    if (!canManage || busy) return;
    if (!merchantId.trim()) {
      Alert.alert("Merchant ID required", "Enter the PhonePe Merchant ID provided for this clinic account.");
      return;
    }

    try {
      setBusy(true);
      await addPhonePePaymentAccount(merchantId, label || "Primary");
      setMerchantId("");
      setLabel("Primary");
      await load();
      Alert.alert(
        "Account added",
        "The merchant account is pending verification. Patient payments remain off until CapDent verifies PhonePe payment and settlement readiness."
      );
    } catch (error) {
      Alert.alert("Could not add PhonePe account", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(account: PhonePePaymentAccount) {
    if (!canManage || busy || account.isDefault) return;
    try {
      setBusy(true);
      await setDefaultPhonePePaymentAccount(account.id);
      await load();
    } catch (error) {
      Alert.alert("Could not set default account", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDisable(account: PhonePePaymentAccount) {
    if (!canManage || busy) return;
    Alert.alert(
      "Disable PhonePe account?",
      `${account.label}${account.merchantIdMasked ? ` (${account.merchantIdMasked})` : ""} will stop receiving new CapDent patient payments. Existing payment history is not deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable",
          style: "destructive",
          onPress: () => void disableAccount(account),
        },
      ]
    );
  }

  async function disableAccount(account: PhonePePaymentAccount) {
    try {
      setBusy(true);
      await disablePhonePePaymentAccount(account.id);
      await load();
    } catch (error) {
      Alert.alert("Could not disable account", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <Screen>
        <Header />
        <SectionCard title="Owner access required">
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Only the clinic owner or head doctor can add, change, or disable PhonePe receiving accounts.
          </Text>
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <Header />

      <SectionCard
        title="Add PhonePe merchant account"
        subtitle="Add only the Merchant ID. Never enter PhonePe passwords, OTPs, API keys, salts, UPI PINs, or bank credentials into CapDent."
      >
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Account label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Primary / Branch 2 / Owner Account"
            placeholderTextColor={colors.muted}
            maxLength={80}
            style={{
              minHeight: 50,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              color: colors.text,
              backgroundColor: colors.surface,
            }}
          />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>PhonePe Merchant ID</Text>
          <TextInput
            value={merchantId}
            onChangeText={setMerchantId}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter Merchant ID"
            placeholderTextColor={colors.muted}
            style={{
              minHeight: 50,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              color: colors.text,
              backgroundColor: colors.surface,
            }}
          />
        </View>
        <AppButton
          title="Add PhonePe Account"
          icon="add-circle-outline"
          onPress={() => void addAccount()}
          loading={busy}
          loadingTitle="Adding account…"
        />
      </SectionCard>

      <SectionCard
        title="Clinic PhonePe accounts"
        subtitle="Only a fully verified account can be selected as the default receiving account."
      >
        {accounts.length === 0 ? (
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            No PhonePe merchant accounts have been added yet.
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {accounts.map((account) => (
              <View
                key={account.id}
                style={{
                  borderWidth: 1,
                  borderColor: account.isDefault ? colors.primary : colors.border,
                  borderRadius: 18,
                  padding: 14,
                  gap: 10,
                  backgroundColor: account.isDefault ? colors.primarySoft : colors.surface,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{account.label}</Text>
                    <Text style={{ color: colors.muted, marginTop: 3 }}>{account.merchantIdMasked || "Merchant ID unavailable"}</Text>
                  </View>
                  <StatusBadge label={account.isDefault ? "Default" : account.status} tone={account.isDefault ? "success" : tone(account.status)} />
                </View>

                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <StatusBadge label={account.paymentsEnabled ? "Payments enabled" : "Payments off"} tone={account.paymentsEnabled ? "success" : "primary"} />
                  <StatusBadge label={account.settlementsEnabled ? "Settlements enabled" : "Settlements off"} tone={account.settlementsEnabled ? "success" : "primary"} />
                </View>

                {account.status !== "disabled" ? (
                  <View style={{ gap: 8 }}>
                    <AppButton
                      title={account.isDefault ? "Default Receiving Account" : "Set as Default"}
                      icon="checkmark-circle-outline"
                      variant="secondary"
                      onPress={() => void makeDefault(account)}
                      disabled={
                        account.isDefault ||
                        account.status !== "connected" ||
                        !account.paymentsEnabled ||
                        !account.settlementsEnabled ||
                        busy
                      }
                    />
                    <AppButton
                      title="Disable Account"
                      icon="ban-outline"
                      variant="danger"
                      onPress={() => confirmDisable(account)}
                      disabled={busy}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard title="Safety rule">
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          Adding a Merchant ID does not activate payments. CapDent keeps the account pending until provider verification confirms that patient payments and settlements are enabled.
        </Text>
      </SectionCard>
    </Screen>
  );
}

function Header() {
  return (
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
        <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>PhonePe Accounts</Text>
        <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
          Manage the clinic's patient-payment receiving accounts.
        </Text>
      </View>
    </View>
  );
}
