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
          Review the patient ledger and receiving account before deciding whether the clinic should refund, credit, or otherwise resolve the difference. This screen does not move money.
        </Text>
      </View>

      {items.length ? (
        <View style={{ gap: 12 }}>
          {items.map((item) => {
            const delta = item.verifiedAmount - item.currentDue;
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
                    <Text style={{ flex: 1, color: colors.muted, fontWeight: "800" }}>Difference to review</Text>
                    <Text style={{ color: colors.warning, fontWeight: "900" }}>
                      {formatClinicMoney(Math.abs(delta), item.currencyCode)}
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
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    Receiving account
                  </Text>
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
