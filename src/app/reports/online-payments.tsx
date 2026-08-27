import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
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
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
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
      setExpandedPayment(null);
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
            Online Payments
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Provider-verified payments received by the clinic.
          </Text>
        </View>
      </View>

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
                backgroundColor: selected ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
              }}
            >
              <Text
                style={{
                  color: selected ? colors.white : colors.text,
                  fontWeight: "900",
                  textAlign: "center",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatCard
          label="Received"
          value={loading ? "..." : money(report?.summary.verifiedOnlineRevenue || 0)}
          icon="wallet-outline"
          tone="success"
        />
        <StatCard
          label="Payments"
          value={loading ? "..." : report?.summary.verifiedOnlinePayments || 0}
          icon="shield-checkmark-outline"
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>Payment history</Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>
          Tap Details only when you need the category split or merchant audit information.
        </Text>
      </View>

      {report?.onlinePayments.length ? (
        <View style={{ gap: 12 }}>
          {report.onlinePayments.map((payment, index) => {
            const paymentKey = `${payment.createdAt}-${index}`;
            const expanded = expandedPayment === paymentKey;

            return (
              <View
                key={paymentKey}
                style={{
                  padding: 15,
                  borderRadius: 20,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 16,
                      backgroundColor: colors.successSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={24} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {payment.patient}
                    </Text>
                    <Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>
                      {payment.createdAt}
                    </Text>
                  </View>
                  <Text style={{ color: colors.success, fontSize: 19, fontWeight: "900" }}>
                    {money(payment.total)}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800" }}>
                      RECEIVED IN
                    </Text>
                    <Text style={{ color: colors.text, marginTop: 3, fontWeight: "900" }}>
                      {payment.accountLabel}
                    </Text>
                  </View>
                  <StatusBadge label="Verified" tone="success" />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? "Hide payment details" : "Show payment details"}
                    onPress={() => setExpandedPayment(expanded ? null : paymentKey)}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      minHeight: 40,
                      paddingHorizontal: 11,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                    })}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "900", fontSize: 12 }}>
                      {expanded ? "Hide" : "Details"}
                    </Text>
                    <Ionicons
                      name={expanded ? "chevron-up-outline" : "chevron-down-outline"}
                      size={15}
                      color={colors.primary}
                    />
                  </Pressable>
                </View>

                {expanded ? (
                  <View
                    style={{
                      gap: 12,
                      padding: 12,
                      borderRadius: 16,
                      backgroundColor: colors.background,
                    }}
                  >
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                      <Ionicons name="business-outline" size={18} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "900" }}>{payment.provider}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                          Merchant {payment.merchantIdMasked}
                        </Text>
                      </View>
                    </View>

                    <View style={{ gap: 8 }}>
                      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "900" }}>
                        ALLOCATION
                      </Text>
                      {payment.allocations.map((allocation, allocationIndex) => (
                        <View
                          key={`${allocation.category}-${allocationIndex}`}
                          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                        >
                          <View
                            style={{
                              width: 7,
                              height: 7,
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
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          title="No verified online payments"
          message="Verified PhonePe or card payments will appear here after CapDent reconciles them successfully."
          icon="shield-checkmark-outline"
        />
      )}

      <SectionCard title="How CapDent records online payments">
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          CapDent keeps the verified receiving account and category allocation for audit. Changing the clinic's default receiving account later does not rewrite past payment history.
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
