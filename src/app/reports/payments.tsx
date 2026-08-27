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
  PaymentReviewRangeKey,
  PaymentReviewReport,
  PaymentReviewTotal,
} from "@/lib/paymentReview";

const RANGE_OPTIONS: { key: PaymentReviewRangeKey; title: string }[] = [
  { key: "today", title: "Today" },
  { key: "week", title: "7 Days" },
  { key: "month", title: "Month" },
  { key: "all", title: "All" },
];

type DetailSection = "methods" | "categories" | "staff" | "recent" | "dues";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "Please try again.";
}

function TotalRow({ item, currencyCode }: { item: PaymentReviewTotal; currencyCode: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.successSoft }}>
        <Ionicons name="cash-outline" size={18} color={colors.success} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "900" }}>{item.label}</Text>
        <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>{item.count} collection{item.count === 1 ? "" : "s"}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>{formatClinicMoney(item.amount, currencyCode)}</Text>
    </View>
  );
}

function DetailHeader({ title, summary, open, onPress }: { title: string; summary: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 58,
        paddingHorizontal: 14,
        borderRadius: 18,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>{title}</Text>
        <Text style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>{summary}</Text>
      </View>
      <Ionicons name={open ? "chevron-up-outline" : "chevron-down-outline"} size={20} color={colors.primary} />
    </Pressable>
  );
}

export default function OwnerPaymentReviewScreen() {
  const [range, setRange] = useState<PaymentReviewRangeKey>("today");
  const [report, setReport] = useState<PaymentReviewReport | null>(null);
  const [currencyCode, setCurrencyCode] = useState(getDefaultClinicPreferences().currencyCode);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState<Set<DetailSection>>(new Set(["recent", "dues"]));
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
      Alert.alert("Payment review failed", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function toggleSection(section: DetailSection) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  useEffect(() => {
    void load(range);
  }, [range]);

  return (
    <Screen refreshing={loading} onRefresh={() => void load(range)}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>Payment Review</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>Daily closing view for money received, pending dues and collection details.</Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {RANGE_OPTIONS.map((item) => {
          const selected = range === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setRange(item.key)}
              style={{
                minWidth: 72,
                minHeight: 42,
                paddingHorizontal: 14,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>{item.title}</Text>
            </Pressable>
          );
        })}
      </View>

      {report ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <StatCard label="Received" value={loading ? "..." : money(report.summary.revenue)} icon="cash-outline" tone="success" />
            <StatCard label="Pending" value={loading ? "..." : money(report.summary.pendingDue)} icon="wallet-outline" tone="warning" />
            <StatCard label="Payments" value={loading ? "..." : report.summary.collections} icon="receipt-outline" />
            <StatCard label="Pending Bills" value={loading ? "..." : report.summary.pendingInvoices} icon="alert-circle-outline" tone="warning" />
          </View>

          <View style={{ padding: 14, borderRadius: 20, backgroundColor: report.summary.pendingInvoices > 0 ? colors.warningSoft : colors.successSoft, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 11 }}>
            <Ionicons name={report.summary.pendingInvoices > 0 ? "time-outline" : "checkmark-circle-outline"} size={26} color={report.summary.pendingInvoices > 0 ? colors.warning : colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                {report.summary.pendingInvoices > 0 ? `${report.summary.pendingInvoices} bill${report.summary.pendingInvoices === 1 ? "" : "s"} still pending` : "No pending bills"}
              </Text>
              <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
                {report.summary.pendingInvoices > 0 ? `${money(report.summary.pendingDue)} remains to be collected across the clinic.` : `All current clinic bills are settled for this view.`}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <DetailHeader title="Payment Methods" summary={`${report.methodTotals.length} method${report.methodTotals.length === 1 ? "" : "s"}`} open={openSections.has("methods")} onPress={() => toggleSection("methods")} />
            {openSections.has("methods") ? (
              <SectionCard>
                {report.methodTotals.length ? report.methodTotals.map((item) => <TotalRow key={item.label} item={item} currencyCode={currencyCode} />) : <EmptyState title="No collections" message="No payments found for this range." icon="cash-outline" />}
              </SectionCard>
            ) : null}

            <DetailHeader title="Collection Types" summary={`${report.categoryTotals.length} categor${report.categoryTotals.length === 1 ? "y" : "ies"}`} open={openSections.has("categories")} onPress={() => toggleSection("categories")} />
            {openSections.has("categories") ? (
              <SectionCard>
                {report.categoryTotals.length ? report.categoryTotals.map((item) => <TotalRow key={item.label} item={item} currencyCode={currencyCode} />) : <EmptyState title="No collection types" message="Collection categories appear after payments are recorded." icon="receipt-outline" />}
              </SectionCard>
            ) : null}

            <DetailHeader title="Staff Collections" summary={`${report.staffTotals.length} staff total${report.staffTotals.length === 1 ? "" : "s"}`} open={openSections.has("staff")} onPress={() => toggleSection("staff")} />
            {openSections.has("staff") ? (
              <SectionCard>
                {report.staffTotals.length ? report.staffTotals.map((item) => <TotalRow key={item.label} item={item} currencyCode={currencyCode} />) : <EmptyState title="No staff collections" message="Staff totals appear after payments are collected." icon="people-outline" />}
              </SectionCard>
            ) : null}

            <DetailHeader title="Recent Payments" summary={`${report.recentPayments.length} recent payment${report.recentPayments.length === 1 ? "" : "s"}`} open={openSections.has("recent")} onPress={() => toggleSection("recent")} />
            {openSections.has("recent") ? (
              <SectionCard>
                {report.recentPayments.length ? (
                  <View style={{ gap: 10 }}>
                    {report.recentPayments.map((payment, index) => (
                      <View key={`${payment.createdAt}-${index}`} style={{ paddingVertical: 10, borderBottomWidth: index === report.recentPayments.length - 1 ? 0 : 1, borderBottomColor: colors.border, gap: 5 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <Text style={{ flex: 1, color: colors.text, fontWeight: "900" }} numberOfLines={1}>{payment.patient}</Text>
                          <Text style={{ color: colors.success, fontWeight: "900", fontSize: 16 }}>{money(payment.amount)}</Text>
                        </View>
                        <Text style={{ color: colors.muted, lineHeight: 19 }}>{payment.category} • {payment.method} • {payment.staff}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{payment.createdAt}</Text>
                      </View>
                    ))}
                  </View>
                ) : <EmptyState title="No recent payments" message="Payments in this range will appear here." icon="receipt-outline" />}
              </SectionCard>
            ) : null}

            <DetailHeader title="Current Pending Dues" summary={`${report.pendingInvoices.length} unpaid/partial bill${report.pendingInvoices.length === 1 ? "" : "s"}`} open={openSections.has("dues")} onPress={() => toggleSection("dues")} />
            {openSections.has("dues") ? (
              <SectionCard>
                {report.pendingInvoices.length ? (
                  <View style={{ gap: 10 }}>
                    {report.pendingInvoices.map((invoice, index) => (
                      <View key={`${invoice.createdAt}-${index}`} style={{ padding: 12, borderRadius: 18, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.border, gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <Text style={{ flex: 1, color: colors.text, fontWeight: "900" }} numberOfLines={1}>{invoice.patient}</Text>
                          <Text style={{ color: colors.warning, fontWeight: "900", fontSize: 16 }}>{money(invoice.due)}</Text>
                        </View>
                        <Text style={{ color: colors.muted, lineHeight: 19 }}>Total {money(invoice.total)} • Paid {money(invoice.paid)} • {invoice.status}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{invoice.createdAt}</Text>
                      </View>
                    ))}
                  </View>
                ) : <EmptyState title="No pending dues" message="No unpaid/partial invoices found for this clinic." icon="checkmark-circle-outline" />}
              </SectionCard>
            ) : null}
          </View>

          <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>{report.rangeLabel} • Generated {report.generatedAt}</Text>
        </>
      ) : (
        <SectionCard>
          <EmptyState title="No payment review loaded" message="Pull down to refresh payment review." icon="cash-outline" />
        </SectionCard>
      )}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton title="Refresh" icon="refresh-outline" variant="secondary" onPress={() => void load(range)} loading={loading} style={{ flex: 1 }} />
        <AppButton title="Back to Report" icon="arrow-back-outline" variant="ghost" onPress={() => router.replace("/reports/clinic" as never)} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
