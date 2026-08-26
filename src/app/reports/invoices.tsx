import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Share, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  buildInvoiceShareText,
  loadInvoiceCenter,
  type InvoiceCenterReport,
  type InvoiceCenterRow,
} from "@/lib/invoiceCenter";

type InvoiceFilter = "all" | "open" | "paid";

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
];

function statusTone(invoice: InvoiceCenterRow) {
  if (invoice.status === "paid") return "success" as const;
  if (invoice.status === "partial") return "warning" as const;
  return "danger" as const;
}

function dateText(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InvoiceCenterScreen() {
  const [report, setReport] = useState<InvoiceCenterReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InvoiceFilter>("all");

  async function load() {
    try {
      setLoading(true);
      setReport(await loadInvoiceCenter());
    } catch (error) {
      Alert.alert(
        "Invoice Center unavailable",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const money = (value: number) =>
    formatClinicMoney(value, report?.currencyCode || "INR");

  const visibleInvoices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (report?.invoices || []).filter((invoice) => {
      if (filter === "open" && invoice.dueAmount <= 0) return false;
      if (filter === "paid" && invoice.status !== "paid") return false;
      if (!normalized) return true;

      return [
        invoice.reference,
        invoice.patientName,
        invoice.patientCode,
        invoice.patientPhone,
        invoice.category,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [filter, query, report?.invoices]);

  async function shareInvoice(invoice: InvoiceCenterRow) {
    if (!report) return;
    try {
      await Share.share({
        title: `CapDent ${invoice.reference}`,
        message: buildInvoiceShareText(report, invoice),
      });
    } catch (error) {
      Alert.alert(
        "Share failed",
        error instanceof Error ? error.message : "Unable to share this invoice summary."
      );
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
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
            Invoice Center
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Existing clinic invoices, collections, balances, and shareable payment statements.
          </Text>
        </View>
      </View>

      {report ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatCard label="Billed" value={money(report.summary.totalBilled)} icon="receipt-outline" />
          <StatCard label="Paid" value={money(report.summary.totalPaid)} icon="checkmark-circle-outline" tone="success" />
          <StatCard label="Due" value={money(report.summary.totalDue)} icon="wallet-outline" tone={report.summary.totalDue > 0 ? "warning" : "success"} />
          <StatCard label="Open Bills" value={report.summary.openCount} icon="alert-circle-outline" tone={report.summary.openCount > 0 ? "warning" : "success"} />
        </View>
      ) : null}

      <SectionCard
        title="Find Invoice"
        subtitle="Search by patient, patient ID, phone, category, or CapDent reference."
      >
        <View
          style={{
            minHeight: 54,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            gap: 10,
          }}
        >
          <Ionicons name="search-outline" size={21} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search invoices"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, minHeight: 54, color: colors.text, fontSize: 16 }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FILTERS.map((item) => {
            const selected = filter === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.key)}
                style={{
                  paddingHorizontal: 16,
                  minHeight: 42,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? colors.primary : colors.surfaceSoft,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900" }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        title="Invoices"
        subtitle={
          report
            ? `${visibleInvoices.length} shown • ${report.summary.count} total clinic invoices`
            : "Loading clinic invoice records."
        }
      >
        {loading && !report ? (
          <Text style={{ color: colors.muted }}>Loading invoices...</Text>
        ) : visibleInvoices.length ? (
          <View style={{ gap: 12 }}>
            {visibleInvoices.map((invoice) => (
              <View
                key={invoice.id}
                style={{
                  borderRadius: 22,
                  padding: 14,
                  gap: 11,
                  borderWidth: 1,
                  borderColor: invoice.dueAmount > 0 ? colors.warning : colors.border,
                  backgroundColor: invoice.dueAmount > 0 ? colors.warningSoft : colors.background,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }} numberOfLines={1}>
                      {invoice.patientName}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {invoice.patientCode || "No patient ID"} • {invoice.reference}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {invoice.category} • {dateText(invoice.createdAt)}
                    </Text>
                  </View>
                  <StatusBadge label={invoice.status.toUpperCase()} tone={statusTone(invoice)} />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <StatusBadge label={`Total ${money(invoice.totalAmount)}`} />
                  <StatusBadge label={`Paid ${money(invoice.paidAmount)}`} tone="success" />
                  <StatusBadge
                    label={`Due ${money(invoice.dueAmount)}`}
                    tone={invoice.dueAmount > 0 ? "warning" : "success"}
                  />
                </View>

                {invoice.payments.length ? (
                  <Text style={{ color: colors.muted, lineHeight: 19 }}>
                    {invoice.payments.length} linked collection{invoice.payments.length === 1 ? "" : "s"} • Latest: {money(invoice.payments[0].amount)} by {invoice.payments[0].paymentMethod}
                  </Text>
                ) : (
                  <Text style={{ color: colors.muted, lineHeight: 19 }}>
                    No linked collection record yet.
                  </Text>
                )}

                {invoice.notes ? (
                  <Text style={{ color: colors.text, lineHeight: 19 }} numberOfLines={2}>
                    {invoice.notes}
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <AppButton
                    title="Share Invoice"
                    icon="share-outline"
                    variant="secondary"
                    onPress={() => void shareInvoice(invoice)}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    title="Open Patient"
                    icon="person-outline"
                    variant="ghost"
                    onPress={() => router.push(`/patient/${invoice.patientId}` as never)}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title={report?.summary.count ? "No matching invoices" : "No invoices yet"}
            message={
              report?.summary.count
                ? "Change the search or filter to see other clinic invoices."
                : "Invoices created by the existing clinic billing workflow will appear here."
            }
            icon="receipt-outline"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Billing Record Safety"
        subtitle="Invoice Center is read-only in this V27 batch."
      >
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          Sharing an invoice does not collect payment, change an invoice balance, or mark a bill paid. Payment changes continue through CapDent's existing verified collection workflow. This is a clinic billing statement and is not presented as a GST tax invoice.
        </Text>
      </SectionCard>
    </Screen>
  );
}
