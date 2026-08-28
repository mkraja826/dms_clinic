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
  addManualUpiPaymentAccount,
  disablePhonePePaymentAccount,
  listPhonePePaymentAccounts,
  setDefaultPhonePePaymentAccount,
  type PhonePePaymentAccount,
} from "@/lib/phonePePaymentAccounts";

type Readiness = {
  label: string;
  description: string;
  tone: "primary" | "success" | "warning" | "danger";
  icon: keyof typeof Ionicons.glyphMap;
};

function isManualReady(account: PhonePePaymentAccount) {
  return (
    account.collectionMode === "manual_upi" &&
    account.status === "connected" &&
    account.paymentsEnabled &&
    Boolean(account.upiIdMasked)
  );
}

function isApiReady(account: PhonePePaymentAccount) {
  return (
    account.collectionMode === "phonepe_api" &&
    account.status === "connected" &&
    account.verificationStatus === "verified" &&
    account.paymentsEnabled &&
    account.settlementsEnabled
  );
}

function accountReadiness(account: PhonePePaymentAccount): Readiness {
  if (account.status === "disabled") {
    return {
      label: "Disabled",
      description: "This account cannot receive new CapDent patient payments.",
      tone: "danger",
      icon: "ban-outline",
    };
  }

  if (isManualReady(account)) {
    return account.isDefault
      ? {
          label: "Default QR account",
          description: "New manual UPI QR collections will use this account. Reception must confirm receipt after checking PhonePe Business or the clinic bank account.",
          tone: "success",
          icon: "checkmark-circle-outline",
        }
      : {
          label: "Ready for manual QR",
          description: "This UPI account can receive patient QR payments. Set it as default to use it at reception.",
          tone: "success",
          icon: "qr-code-outline",
        };
  }

  if (isApiReady(account)) {
    return account.isDefault
      ? {
          label: "Default verified account",
          description: "PhonePe API verification is active for this receiving account.",
          tone: "success",
          icon: "shield-checkmark-outline",
        }
      : {
          label: "PhonePe verified",
          description: "Provider-verified account. Set it as default when automatic PhonePe collection is enabled.",
          tone: "success",
          icon: "shield-checkmark-outline",
        };
  }

  if (account.status === "restricted") {
    return {
      label: "Restricted",
      description: "PhonePe provider verification did not confirm this merchant account.",
      tone: "danger",
      icon: "warning-outline",
    };
  }

  return {
    label: "Awaiting PhonePe approval",
    description: "This Merchant ID is preserved for the future PhonePe partner/API integration. It does not block manual UPI QR collection.",
    tone: "warning",
    icon: "time-outline",
  };
}

export default function PhonePeAccountsScreen() {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<PhonePePaymentAccount[]>([]);
  const [label, setLabel] = useState("Primary");
  const [upiId, setUpiId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const canManage = profile?.role === "owner" || profile?.role === "head_doctor";

  async function load() {
    try {
      setLoading(true);
      setAccounts(await listPhonePePaymentAccounts());
    } catch (error) {
      Alert.alert(
        "Could not load receiving accounts",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, profile?.clinic_id]);

  async function addAccount() {
    if (!canManage || busy) return;
    if (!upiId.trim()) {
      Alert.alert("UPI ID required", "Enter the clinic UPI ID used to receive PhonePe payments.");
      return;
    }

    try {
      setBusy(true);
      await addManualUpiPaymentAccount(upiId, label || "Primary");
      setUpiId("");
      setLabel("Primary");
      await load();
      Alert.alert(
        "Receiving account added",
        "CapDent can use this UPI ID for manual QR collection. Reception must confirm the payment only after verifying receipt in PhonePe Business or the clinic bank account."
      );
    } catch (error) {
      Alert.alert(
        "Could not add receiving account",
        error instanceof Error ? error.message : "Please try again."
      );
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
      Alert.alert(
        "Could not set default account",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmDisable(account: PhonePePaymentAccount) {
    if (!canManage || busy) return;
    const destination = account.upiIdMasked || account.merchantIdMasked || "this account";
    Alert.alert(
      "Disable receiving account?",
      `${account.label} (${destination}) will stop receiving new CapDent patient payments. Existing payment history is not deleted.`,
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
      Alert.alert(
        "Could not disable account",
        error instanceof Error ? error.message : "Please try again."
      );
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
            Only the clinic owner or head doctor can add, change, or disable receiving accounts.
          </Text>
        </SectionCard>
      </Screen>
    );
  }

  const readyCount = accounts.filter((account) => isManualReady(account) || isApiReady(account)).length;
  const defaultAccount = accounts.find(
    (account) => account.isDefault && (isManualReady(account) || isApiReady(account))
  );

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <Header />

      <View
        style={{
          padding: 14,
          borderRadius: 20,
          backgroundColor: defaultAccount ? colors.successSoft : colors.warningSoft,
          borderWidth: 1,
          borderColor: defaultAccount ? colors.success : colors.warning,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Ionicons
          name={defaultAccount ? "checkmark-circle-outline" : "alert-circle-outline"}
          size={28}
          color={defaultAccount ? colors.success : colors.warning}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {defaultAccount ? "QR receiving account ready" : "Add a clinic UPI account"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
            {defaultAccount
              ? `${defaultAccount.label} is selected for new patient QR payments.`
              : readyCount > 0
                ? "A receiving account is available. Select one as the default."
                : "Use the clinic's existing PhonePe/UPI ID. PhonePe partner approval is not required for manual confirmation mode."}
          </Text>
        </View>
      </View>

      <SectionCard title="Add PhonePe / UPI account">
        <View
          style={{
            padding: 12,
            borderRadius: 16,
            backgroundColor: colors.infoSoft,
            flexDirection: "row",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Ionicons name="information-circle-outline" size={21} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.text, lineHeight: 19, fontSize: 13 }}>
            Add only the clinic's receiving UPI ID. CapDent never asks for a UPI PIN, OTP, bank password, PhonePe password, API key, or payment credential.
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Account label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Primary / Front Desk / Branch 2"
            placeholderTextColor={colors.muted}
            maxLength={80}
            style={{
              minHeight: 52,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 16,
              paddingHorizontal: 14,
              color: colors.text,
              backgroundColor: colors.background,
            }}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Clinic UPI ID</Text>
          <TextInput
            value={upiId}
            onChangeText={setUpiId}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="clinic@bank"
            placeholderTextColor={colors.muted}
            style={{
              minHeight: 52,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 16,
              paddingHorizontal: 14,
              color: colors.text,
              backgroundColor: colors.background,
              fontWeight: "700",
            }}
          />
        </View>

        <AppButton
          title="Add Receiving Account"
          icon="add-circle-outline"
          onPress={() => void addAccount()}
          loading={busy}
          loadingTitle="Adding account…"
          disabled={!upiId.trim() || busy}
        />
      </SectionCard>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>Receiving accounts</Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>
          {accounts.length
            ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} added • ${readyCount} available for collection`
            : "No PhonePe/UPI receiving accounts have been added yet."}
        </Text>
      </View>

      {accounts.length ? (
        <View style={{ gap: 12 }}>
          {accounts.map((account) => {
            const readiness = accountReadiness(account);
            const ready = isManualReady(account) || isApiReady(account);
            const canSetDefault = !account.isDefault && ready;
            const destination = account.upiIdMasked || account.merchantIdMasked || "Receiving ID unavailable";

            return (
              <View
                key={account.id}
                style={{
                  borderWidth: account.isDefault ? 2 : 1,
                  borderColor: account.isDefault ? colors.success : colors.border,
                  borderRadius: 20,
                  padding: 15,
                  gap: 12,
                  backgroundColor: account.isDefault ? colors.successSoft : colors.surface,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 16,
                      backgroundColor:
                        readiness.tone === "success"
                          ? colors.successSoft
                          : readiness.tone === "warning"
                            ? colors.warningSoft
                            : readiness.tone === "danger"
                              ? colors.dangerSoft
                              : colors.surfaceSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={readiness.icon}
                      size={23}
                      color={
                        readiness.tone === "success"
                          ? colors.success
                          : readiness.tone === "warning"
                            ? colors.warning
                            : readiness.tone === "danger"
                              ? colors.danger
                              : colors.primary
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{account.label}</Text>
                    <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>{destination}</Text>
                    <Text style={{ color: colors.muted, marginTop: 2, fontSize: 11 }}>
                      {account.collectionMode === "manual_upi" ? "Manual receipt confirmation" : "PhonePe API / future partner mode"}
                    </Text>
                  </View>
                  <StatusBadge label={readiness.label} tone={readiness.tone} />
                </View>

                <Text style={{ color: colors.muted, lineHeight: 19 }}>{readiness.description}</Text>

                {account.status !== "disabled" ? (
                  <View style={{ gap: 8 }}>
                    {canSetDefault ? (
                      <AppButton
                        title="Set as Default"
                        icon="checkmark-circle-outline"
                        onPress={() => void makeDefault(account)}
                        disabled={busy}
                      />
                    ) : account.isDefault && ready ? (
                      <View
                        style={{
                          minHeight: 48,
                          borderRadius: 16,
                          paddingHorizontal: 14,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 8,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.success,
                        }}
                      >
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        <Text style={{ color: colors.success, fontWeight: "900" }}>Receiving New Payments</Text>
                      </View>
                    ) : null}

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
            );
          })}
        </View>
      ) : null}

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: colors.warningSoft }}>
        <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18, textAlign: "center", fontWeight: "700" }}>
          Manual UPI mode never confirms a payment automatically. Reception must check the actual PhonePe Business or bank receipt before marking a patient payment as received.
        </Text>
      </View>
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
        <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>PhonePe / UPI Accounts</Text>
        <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
          Choose where this clinic receives patient QR payments.
        </Text>
      </View>
    </View>
  );
}
