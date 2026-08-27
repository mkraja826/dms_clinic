import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { colors } from "@/constants/colors";
import { formatClinicMoney, getDefaultClinicPreferences } from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import {
  buildPaymentReview,
  type PaymentReviewRangeKey,
  type PaymentReviewReport,
} from "@/lib/paymentReview";

const RANGES: Array<{ key: PaymentReviewRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 Days" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

export default function OnlinePaymentsReportScreen() {
  const [range, setRange] = useState<PaymentReviewRangeKey>("today");
  const [report, setReport] = useState<PaymentReviewReport | null>(null);
  const [currencyCode, setCurrencyCode] = useState(getDefaultClinicPreferences().currencyCode);
  const [loading, setLoading] = useState(true);
  const money = (value?: number | string | null) => formatClinicMoney(value, currencyCode);

  async function load(nextRange = range) {
    try {
      setLoading(true);
      const [data, preferences] = await Promise.all([
        buildPaymentReview(nextRange),
        getClinicPreferences().catch(() => getDefaultClinicPreferences()),
      ]);
      setReport(data);
      setCurrencyCode(preferences.currencyCode);
    } catch (error) {
      Alert.alert(
        "Online payment review failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(range);
  }, [range]);

  return (
    <Screen refreshing={loading} onRefresh={() => void load(range)}>
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
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>
            Verified Online Payments
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            See which clinic account received each payment and how CapDent allocated it.
          </Text>
        </View>
      </View>

      <SectionCard title="Period" subtitle="Only provider-verified and reconciled online collections appear here.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {RANGES.map((item) => {
            const selected = item.key === range;
            return (
              <Pressable
                key={item.key}
                onPress={() => setRange(item.key)}
                style={{
                  minWidth: 74,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderRadius: 16,
                  backgroundColor: selected ? colors.primary : colors.background,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900", textAlign: "center" }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatCard
          label="Online Received"
          value={loading ? "..." : money(report?.summary.verifiedOnlineRevenue || 0)}
          icon="phone-portrait-outline"
          tone="success"
        />
        <StatCard
          label="Verified Payments"
          value={loading ? "..." : report?.summary.verifiedOnlinePayments || 0}
          icon="shield-checkmark-outline"
        />
      </View>

      <SectionCard
        title="Payment History"
        subtitle="Merchant IDs are masked. Account labels and category allocations are preserved from reconciliation."
      >
        {report?.onlinePayments.length ? (
          <View style={{ gap: 12 }}>
            {report.onlinePayments.map((payment, index) => (
              <View
                key={`${payment.createdAt}-${index}`}
                style={{
                  padding: 14,
                  borderRadius: 20,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {payment.patient}
                    </Text>
                    <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>
                      {payment.createdAt}
                    </Text>
                  </View>
                  <Text style={{ color: colors.success, fontSize: 18, fontWeight: "900" }}>
                    {money(payment.total)}
                  </Text>
                </View>

                <View
                  style={{
                    padding: 11,
                    borderRadius: 16,
                    backgroundColor: colors.primarySoft,
                    gap: 4,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    {payment.provider} • {payment.accountLabel}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Merchant {payment.merchantIdMasked}
                  </Text>
                </View>

                <View style={{ gap: 7 }}>
                  {payment.allocations.map((allocation, allocationIndex) => (
                    <View
                      key={`${allocation.category}-${allocationIndex}`}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: colors.primary,
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "800" }}>
                          {allocation.category}
                        </Text>
                        {allocation.label !== allocation.category ? (
                          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                            {allocation.label}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.text, fontWeight: "900" }}>
                        {money(allocation.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No verified online payments"
            message="PhonePe/card payments will appear here only after provider verification and successful CapDent reconciliation."
            icon="shield-checkmark-outline"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Accounting Rule"
        subtitle="Provider money is never treated as one unclassified CapDent payment."
      >
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          One provider transaction can be split into OP/consultation, X-ray, medication, treatment, pending collection, or other finalized invoice lines. The receiving clinic account is also retained for audit even if the owner changes the default account later.
        </Text>
      </SectionCard>

      <AppButton
        title="Open Full Payment Review"
        icon="analytics-outline"
        variant="secondary"
        onPress={() => router.push("/reports/payments" as never)}
      />
    </Screen>
  );
}
