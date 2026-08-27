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

type Readiness = {
  label: string;
  description: string;
  tone: "primary" | "success" | "warning" | "danger";
  icon: keyof typeof Ionicons.glyphMap;
};

function accountReadiness(account: PhonePePaymentAccount): Readiness {
  if (account.status === "disabled") {
    return {
      label: "Disabled",
      description: "This account cannot receive new CapDent patient payments.",
      tone: "danger",
      icon: "ban-outline",
    };
  }

  if (account.status === "restricted") {
    return {
      label: "Restricted",
      description: "Provider verification did not confirm this account is ready to receive payments.",
      tone: "danger",
      icon: "warning-outline",
    };
  }

  if (
    account.status === "connected" &&
    account.paymentsEnabled &&
    account.settlementsEnabled
  ) {
    if (account.isDefault) {
      return {
        label: "Default receiving account",
        description: "New patient QR payments will be routed to this clinic account.",
        tone: "success",
        icon: "checkmark-circle-outline",
      };
    }
    return {
      label: "Ready to receive",
      description: "Verified and ready. Set it as default when you want new QR payments routed here.",
      tone: "success",
      icon: "shield-checkmark-outline",
    };
  }

  return {
    label: "Pending verification",
    description: "Added successfully. Patient payments stay off until CapDent verifies this merchant account.",
    tone: "warning",
    icon: "time-outline",
  };
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
      Alert.alert(
        "Could not load PhonePe accounts",
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
    if (!merchantId.trim()) {
      Alert.alert(
        "Merchant ID required",
        "Enter the PhonePe Merchant ID provided for this clinic account."
      );
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
        "The merchant account is pending verification. Patient payments remain off until CapDent confirms it is ready to receive and settle payments."
      );
    } catch (error) {
      Alert.alert(
        "Could not add PhonePe account",
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
            Only the clinic owner or head doctor can add, change, or disable PhonePe receiving accounts.
          </Text>
        </SectionCard>
      </Screen>
    );
  }

  const readyCount = accounts.filter(
    (account) =>
      account.status === "connected" && account.paymentsEnabled && account.settlementsEnabled
  ).length;
  const defaultAccount = accounts.find((account) => account.isDefault);

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
            {defaultAccount ? "Patient payments ready" : "Receiving account not ready"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
            {defaultAccount
              ? `${defaultAccount.label} is the default account for new patient QR payments.`
              : readyCount > 0
                ? "A verified account is available. Select one as the default receiving account."
                : "Add a merchant account and complete verification before QR collections can start."}
          </Text>
        </View>
      </View>

      <SectionCard title="Add receiving account">
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
          <Ionicons name="shield-checkmark-outline" size={21} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.text, lineHeight: 19, fontSize: 13 }}>
            Enter only the PhonePe Merchant ID. CapDent will never ask for your UPI PIN, OTP, bank password, API key, or PhonePe password.
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Account label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Primary / Branch 2 / Owner Account"
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
          <Text style={{ color: colors.text, fontWeight: "800" }}>PhonePe Merchant ID</Text>
          <TextInput
            value={merchantId}
            onChangeText={setMerchantId}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter Merchant ID"
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
          title="Add Merchant Account"
          icon="add-circle-outline"
          onPress={() => void addAccount()}
          loading={busy}
          loadingTitle="Adding account…"
          disabled={!merchantId.trim() || busy}
        />
      </SectionCard>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
          Receiving accounts
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>
          {accounts.length
            ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} added • ${readyCount} ready to receive`
            : "No PhonePe merchant accounts have been added yet."}
        </Text>
      </View>

      {accounts.length ? (
        <View style={{ gap: 12 }}>
          {accounts.map((account) => {
            const readiness = accountReadiness(account);
            const canSetDefault =
              !account.isDefault &&
              account.status === "connected" &&
              account.paymentsEnabled &&
              account.settlementsEnabled;

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
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {account.label}
                    </Text>
                    <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>
                      {account.merchantIdMasked || "Merchant ID unavailable"}
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
                    ) : account.isDefault ? (
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
                        <Text style={{ color: colors.success, fontWeight: "900" }}>
                          Receiving New Payments
                        </Text>
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

      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
        Adding a Merchant ID never activates payments by itself. Only a verified account can receive new CapDent QR payments.
      </Text>
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
        <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>
          PhonePe Accounts
        </Text>
        <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
          Choose where this clinic receives patient QR payments.
        </Text>
      </View>
    </View>
  );
}
