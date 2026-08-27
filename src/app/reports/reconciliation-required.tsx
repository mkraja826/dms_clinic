import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  applyCurrentDueFromVerifiedPayment,
  getReconciliationRequiredCases,
  type ReconciliationRequiredCase,
} from "@/lib/reconciliationReview";

function dateText(value?: string | null) {
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

export default function ReconciliationRequiredScreen() {
  const [items, setItems] = useState<ReconciliationRequiredCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setItems(await getReconciliationRequiredCases());
    } catch (error) {
      Alert.alert(
        "Reconciliation review failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function resolveCurrentDue(item: ReconciliationRequiredCase) {
    if (resolvingId) return;
    try {
      setResolvingId(item.paymentRequestId);
      const result = await applyCurrentDueFromVerifiedPayment(
        item.paymentRequestId,
        "Owner confirmed applying only the current CapDent due from a provider-verified payment."
      );
      await load();

      if (result.excessAmount > 0) {
        Alert.alert(
          "Current due applied",
          `${formatClinicMoney(result.appliedAmount, item.currencyCode)} was applied to the patient's current due. ` +
            `${formatClinicMoney(result.excessAmount, item.currencyCode)} remains unresolved and must be handled separately as a refund or approved clinic credit.`
        );
      } else {
        Alert.alert(
          "Payment reconciled",
          `${formatClinicMoney(result.appliedAmount, item.currencyCode)} was safely applied to the patient's current due.`
        );
      }
    } catch (error) {
      Alert.alert(
        "Resolution failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setResolvingId(null);
    }
  }

  function confirmResolve(item: ReconciliationRequiredCase) {
    const safeApply = Math.min(item.verifiedAmount, item.currentDue);
    const excess = Math.max(item.verifiedAmount - safeApply, 0);

    Alert.alert(
      "Apply current due only?",
      `${formatClinicMoney(safeApply, item.currencyCode)} will be written to the patient's CapDent payment ledger. ` +
        (excess > 0
          ? `${formatClinicMoney(excess, item.currencyCode)} will NOT be applied and will remain flagged for refund/credit handling.`
          : "No excess will remain.") +
        "\n\nThis action does not issue any PhonePe refund.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply Current Due",
          onPress: () => void resolveCurrentDue(item),
        },
      ]
    );
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Payment Reconciliation
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Verified provider payments held because the CapDent invoice balance changed before the payment could be safely applied.
        </Text>
      </View>

      <View
        style={{
          padding: 14,
          borderRadius: 20,
          backgroundColor: colors.warningSoft,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name="warning-outline" size={24} color={colors.warning} />
          <Text style={{ flex: 1, color: colors.text, fontWeight: "900", fontSize: 16 }}>
            Money was confirmed by the provider, but CapDent did not auto-apply it.
          </Text>
        </View>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          You may safely apply only the amount still genuinely due. Any verified excess stays separate for refund or approved credit handling and is never silently added to the patient ledger.
        </Text>
      </View>

      {items.length ? (
        <View style={{ gap: 12 }}>
          {items.map((item) => {
            const safeApply = Math.min(item.verifiedAmount, item.currentDue);
            const excess = Math.max(item.verifiedAmount - safeApply, 0);
            return (
              <SectionCard
                key={item.paymentRequestId}
                title={`${item.patientCode ? `${item.patientCode} - ` : ""}${item.patientName}`}
                subtitle={`Provider verified ${dateText(item.providerVerifiedAt)}`}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <StatusBadge label="Reconciliation required" tone="warning" />
                  <StatusBadge label={item.provider || "Provider"} tone="primary" />
                </View>

                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.muted, fontWeight: "800" }}>Provider verified</Text>
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {formatClinicMoney(item.verifiedAmount, item.currencyCode)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.muted, fontWeight: "800" }}>Current CapDent due</Text>
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {formatClinicMoney(item.currentDue, item.currencyCode)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.muted, fontWeight: "800" }}>Safe amount to apply</Text>
                    <Text style={{ color: colors.success, fontWeight: "900" }}>
                      {formatClinicMoney(safeApply, item.currencyCode)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.muted, fontWeight: "800" }}>Excess left unresolved</Text>
                    <Text style={{ color: excess > 0 ? colors.warning : colors.text, fontWeight: "900" }}>
                      {formatClinicMoney(excess, item.currencyCode)}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    borderRadius: 18,
                    padding: 12,
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 5,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "900" }}>Receiving account</Text>
                  <Text style={{ color: colors.muted }}>
                    {item.accountLabel}{item.merchantIdMasked ? ` • ${item.merchantIdMasked}` : ""}
                  </Text>
                </View>

                <Text style={{ color: colors.muted, lineHeight: 19 }}>
                  {item.failureMessage || "The invoice balance changed after checkout creation."}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Last checked: {dateText(item.lastCheckedAt)}
                </Text>

                <AppButton
                  title="Apply Current Due Only"
                  icon="shield-checkmark-outline"
                  onPress={() => confirmResolve(item)}
                  loading={resolvingId === item.paymentRequestId}
                  loadingTitle="Applying safe amount…"
                  disabled={Boolean(resolvingId)}
                />
              </SectionCard>
            );
          })}
        </View>
      ) : (
        <SectionCard>
          <EmptyState
            title="No reconciliation issues"
            message="There are no verified online payments waiting for owner review."
            icon="checkmark-circle-outline"
          />
        </SectionCard>
      )}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="Refresh"
          icon="refresh-outline"
          variant="secondary"
          onPress={() => void load()}
          loading={loading}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Payment Review"
          icon="card-outline"
          variant="ghost"
          onPress={() => router.replace("/reports/payments" as never)}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}
