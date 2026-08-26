import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { formatClinicMoney } from "@/lib/clinicLocale";
import {
  listRecentFinalizedInvoices,
  type FinalizedInvoiceListItem,
} from "@/lib/finalizedInvoiceShare";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FinalizedInvoicesScreen() {
  const [rows, setRows] = useState<FinalizedInvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(true);
  const [reason, setReason] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const result = await listRecentFinalizedInvoices(40);
      setBackendReady(result.backendReady);
      setReason(result.reason || null);
      setRows(result.invoices);
    } catch (error) {
      Alert.alert(
        "Invoices unavailable",
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
            Finalized Invoices
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Patient-facing invoices that reception explicitly finalized.
          </Text>
        </View>
      </View>

      {!backendReady ? (
        <SectionCard title="V28 backend pending">
          <Text style={{ color: colors.warning, fontWeight: "900", lineHeight: 20 }}>
            {reason || "Consolidated billing is not deployed in this environment."}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 6, lineHeight: 20 }}>
            Existing CapDent fee collection remains unchanged.
          </Text>
        </SectionCard>
      ) : rows.length ? (
        <SectionCard
          title="Recent final invoices"
          subtitle="Opening an invoice never sends it to the patient. WhatsApp is always a manual receptionist action."
        >
          <View style={{ gap: 10 }}>
            {rows.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.invoice_number} for ${item.patient_name}`}
                onPress={() =>
                  router.push({
                    pathname: "/reception/finalized-invoice",
                    params: { bill_id: item.id },
                  } as never)
                }
                style={({ pressed }) => ({
                  borderRadius: 18,
                  padding: 13,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceSoft : colors.background,
                  gap: 8,
                })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                      {item.invoice_number}
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2 }}>
                      {item.patient_name} • {formatDate(item.finalized_at)}
                    </Text>
                  </View>
                  <StatusBadge
                    label={item.due_amount > 0 ? "Balance due" : "Paid"}
                    tone={item.due_amount > 0 ? "warning" : "success"}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <Text style={{ color: colors.text, fontWeight: "800" }}>
                    Total {formatClinicMoney(item.total_amount, item.currency_code)}
                  </Text>
                  <Text style={{ color: item.due_amount > 0 ? colors.warning : colors.success, fontWeight: "900" }}>
                    Balance {formatClinicMoney(item.due_amount, item.currency_code)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </SectionCard>
      ) : !loading ? (
        <EmptyState
          title="No finalized invoices yet"
          message="Use Review Final Invoice after collecting the patient's charges and payments."
          icon="document-text-outline"
        />
      ) : null}
    </Screen>
  );
}
