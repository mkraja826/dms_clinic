import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          `${formatClinicMoney(result.appliedAmount, item.currencyCode)} was applied. ${formatClinicMoney(result.excessAmount, item.currencyCode)} remains unresolved for refund or approved clinic credit.`
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
      `${formatClinicMoney(safeApply, item.currencyCode)} will be written to the patient's CapDent ledger.` +
        (excess > 0
          ? ` ${formatClinicMoney(excess, item.currencyCode)} will remain unresolved for refund/credit handling.`
          : " No excess will remain.") +
        "\n\nThis does not issue a PhonePe refund.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Apply Current Due", onPress: () => void resolveCurrentDue(item) },
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
          Review provider-confirmed payments that CapDent intentionally held instead of applying automatically.
        </Text>
      </View>

      <View
        style={{
          padding: 14,
          borderRadius: 20,
          backgroundColor: colors.warningSoft,
          borderWidth: 1,
          borderColor: colors.warning,
          flexDirection: "row",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={24} color={colors.warning} />
        <Text style={{ flex: 1, color: colors.text, lineHeight: 20, fontWeight: "700" }}>
          CapDent never over-credits a patient. Apply only what is still due; any excess remains separate for refund or approved clinic credit.
        </Text>
      </View>

      {items.length ? (
        <View style={{ gap: 12 }}>
          {items.map((item) => {
            const safeApply = Math.min(item.verifiedAmount, item.currentDue);
            const excess = Math.max(item.verifiedAmount - safeApply, 0);
            const expanded = expandedId === item.paymentRequestId;

            return (
              <SectionCard
                key={item.paymentRequestId}
                title={`${item.patientCode ? `${item.patientCode} - ` : ""}${item.patientName}`}
                subtitle={`Payment confirmed ${dateText(item.providerVerifiedAt)}`}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <AmountTile label="Received" value={formatClinicMoney(item.verifiedAmount, item.currencyCode)} />
                  <AmountTile label="Still due" value={formatClinicMoney(item.currentDue, item.currencyCode)} />
                  <AmountTile label="Apply now" value={formatClinicMoney(safeApply, item.currencyCode)} success />
                  <AmountTile label="Excess" value={formatClinicMoney(excess, item.currencyCode)} warning={excess > 0} />
                </View>

                <View
                  style={{
                    padding: 12,
                    borderRadius: 16,
                    backgroundColor: safeApply > 0 ? colors.successSoft : colors.warningSoft,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Ionicons
                    name={safeApply > 0 ? "checkmark-circle-outline" : "alert-circle-outline"}
                    size={22}
                    color={safeApply > 0 ? colors.success : colors.warning}
                  />
                  <Text style={{ flex: 1, color: colors.text, lineHeight: 19, fontWeight: "800" }}>
                    {safeApply > 0
                      ? `${formatClinicMoney(safeApply, item.currencyCode)} can be safely applied now.`
                      : "Nothing can be safely applied right now. Keep this payment under review."}
                  </Text>
                </View>

                {safeApply > 0 ? (
                  <AppButton
                    title="Apply Current Due Only"
                    icon="shield-checkmark-outline"
                    onPress={() => confirmResolve(item)}
                    loading={resolvingId === item.paymentRequestId}
                    loadingTitle="Applying safe amount…"
                    disabled={Boolean(resolvingId)}
                  />
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={expanded ? "Hide reconciliation details" : "Show reconciliation details"}
                  onPress={() => setExpandedId(expanded ? null : item.paymentRequestId)}
                  style={{
                    minHeight: 44,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    {expanded ? "Hide details" : "Why was this held?"}
                  </Text>
                  <Ionicons name={expanded ? "chevron-up-outline" : "chevron-down-outline"} size={19} color={colors.primary} />
                </Pressable>

                {expanded ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: colors.muted, lineHeight: 19 }}>
                      {item.failureMessage || "The invoice/category balance changed after checkout creation, so CapDent held the payment for owner review."}
                    </Text>
                    <Text style={{ color: colors.text, fontWeight: "800" }}>
                      Receiving account: {item.accountLabel}{item.merchantIdMasked ? ` • ${item.merchantIdMasked}` : ""}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Provider: {item.provider || "Provider"} • Last checked: {dateText(item.lastCheckedAt)}
                    </Text>
                  </View>
                ) : null}
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

function AmountTile({
  label,
  value,
  success,
  warning,
}: {
  label: string;
  value: string;
  success?: boolean;
  warning?: boolean;
}) {
  return (
    <View
      style={{
        width: "48%",
        minHeight: 78,
        borderRadius: 16,
        padding: 12,
        backgroundColor: success ? colors.successSoft : warning ? colors.warningSoft : colors.background,
        borderWidth: 1,
        borderColor: success ? colors.success : warning ? colors.warning : colors.border,
        justifyContent: "space-between",
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text
        style={{
          color: success ? colors.success : warning ? colors.warning : colors.text,
          fontSize: 18,
          fontWeight: "900",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
