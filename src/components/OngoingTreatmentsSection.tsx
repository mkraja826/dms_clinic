import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { subscribeClinicOngoingTreatmentsRealtime } from "@/lib/realtime";
import {
  getOngoingTreatments,
  updateOngoingTreatmentStatus,
} from "@/lib/ongoingTreatments";
import type { OngoingTreatmentItem, OngoingTreatmentStatus } from "@/lib/ongoingTreatments";

function money(value?: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function statusLabel(status: OngoingTreatmentStatus) {
  if (status === "ongoing") return "Ongoing";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Planned";
}

function statusTone(status: OngoingTreatmentStatus) {
  if (status === "completed") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "ongoing") return "warning" as const;
  return "primary" as const;
}

function dateLabel(value?: string | null) {
  if (!value) return "No visit date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No visit date";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function searchableText(item: OngoingTreatmentItem) {
  return [
    item.patientName,
    item.patientPhone,
    item.patientCode,
    item.treatmentName,
    item.category,
    item.doctorName,
    statusLabel(item.status),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function OngoingTreatmentsSection({
  allowStatusUpdates,
  allowCompleteUpdates,
  doctorOnly,
  limit = 6,
}: {
  allowStatusUpdates?: boolean;
  allowCompleteUpdates?: boolean;
  doctorOnly?: boolean;
  limit?: number;
}) {
  const [items, setItems] = useState<OngoingTreatmentItem[]>([]);
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const updateLocksRef = useRef(new Set<string>());

  async function load(showLoading = true) {
    try {
      if (showLoading) setLoading(true);
      const rows = await getOngoingTreatments({ limit, doctorOnly });
      setItems(rows);
    } catch (error) {
      console.warn("Ongoing treatments load failed:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [doctorOnly, limit]);

  useEffect(() => subscribeClinicOngoingTreatmentsRealtime({
    clinicId: profile?.clinic_id,
    onChange: () => load(false),
  }), [profile?.clinic_id, doctorOnly, limit]);

  async function updateStatus(item: OngoingTreatmentItem, status: OngoingTreatmentStatus) {
    if (updateLocksRef.current.has(item.id)) return;
    updateLocksRef.current.add(item.id);
    const previousItems = items;
    setUpdatingId(item.id);
    setItems((current) => status === "completed" || status === "cancelled"
      ? current.filter((row) => row.id !== item.id)
      : current.map((row) => row.id === item.id ? { ...row, status } : row));
    try {
      await updateOngoingTreatmentStatus(item.id, status);
      await load(false);
      Alert.alert("Treatment updated", `${item.treatmentName} is now ${statusLabel(status).toLowerCase()}.`);
    } catch (error) {
      setItems(previousItems);
      Alert.alert("Update failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      updateLocksRef.current.delete(item.id);
      setUpdatingId(null);
    }
  }

  const cleanSearch = search.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!cleanSearch) return items;

    return items.filter((item) => searchableText(item).includes(cleanSearch));
  }, [cleanSearch, items]);

  return (
    <SectionCard
      title="Ongoing Treatments"
      subtitle="Planned and ongoing treatments with outstanding payment and next-sitting actions."
    >
      <View
        style={{
          minHeight: 52,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 13,
          gap: 10,
        }}
      >
        <Ionicons name="search-outline" size={21} color={colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search patient, phone, code, or treatment"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            flex: 1,
            minHeight: 52,
            color: colors.text,
            fontSize: 15,
          }}
        />
        {search ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear ongoing treatment search"
            hitSlop={8}
            onPress={() => setSearch("")}
          >
            <Ionicons name="close-circle" size={22} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {!loading && items.length ? (
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800" }}>
          {cleanSearch
            ? `${filteredItems.length} of ${items.length} matching`
            : `${items.length} active treatment${items.length === 1 ? "" : "s"}`}
        </Text>
      ) : null}

      {loading ? (
        <View style={{ padding: 14, borderRadius: 18, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.muted, fontWeight: "800" }}>Loading ongoing treatments...</Text>
        </View>
      ) : filteredItems.length ? (
        <View style={{ gap: 10 }}>
          {filteredItems.map((item) => (
            <TreatmentCard
              key={item.id}
              item={item}
              allowStatusUpdates={allowStatusUpdates}
              allowCompleteUpdates={allowCompleteUpdates}
              updating={updatingId === item.id}
              onUpdateStatus={(status) => updateStatus(item, status)}
            />
          ))}
          <AppButton
            title="Open Treatment Review"
            icon="medkit-outline"
            variant="secondary"
            onPress={() => router.push("/reports/treatments" as never)}
          />
        </View>
      ) : items.length ? (
        <EmptyState
          title="No matching treatment"
          message="Try patient name, phone number, patient code, treatment name, or doctor name."
          icon="search-outline"
          actionTitle="Clear Search"
          onAction={() => setSearch("")}
        />
      ) : (
        <EmptyState
          title="No outstanding treatments"
          message="When a visit has a planned treatment, it will appear here until it is marked completed or cancelled."
          icon="checkmark-done-outline"
        />
      )}
    </SectionCard>
  );
}

function TreatmentCard({
  item,
  allowStatusUpdates,
  allowCompleteUpdates,
  updating,
  onUpdateStatus,
}: {
  item: OngoingTreatmentItem;
  allowStatusUpdates?: boolean;
  allowCompleteUpdates?: boolean;
  updating?: boolean;
  onUpdateStatus: (status: OngoingTreatmentStatus) => void;
}) {
  const canComplete = Boolean(allowStatusUpdates || allowCompleteUpdates);

  return (
    <View
      style={{
        padding: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        gap: 12,
      }}
    >
      <Pressable
        onPress={() => router.push(`/patient/${item.patientId}` as never)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed ? 0.82 : 1,
        })}
      >
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 17,
            backgroundColor: item.status === "ongoing" ? colors.warningSoft : colors.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="hammer-outline" size={22} color={item.status === "ongoing" ? colors.warning : colors.primary} />
        </View>

        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {item.treatmentName}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 3 }}>
            {item.patientName}
            {item.patientPhone ? ` • ${item.patientPhone}` : ""}
            {item.patientCode ? ` • ${item.patientCode}` : ""}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
            {dateLabel(item.visitDate || item.createdAt)}
            {item.doctorName ? ` • Dr. ${item.doctorName}` : ""}
          </Text>
        </View>

        <StatusBadge label={statusLabel(item.status)} tone={statusTone(item.status)} />
      </Pressable>

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <AmountTile label="Treatment" value={money(item.totalAmount || item.cost)} />
        <AmountTile label="Paid" value={money(item.paidAmount)} tone="success" />
        <AmountTile label={item.paymentCleared ? "Due" : "Due Now"} value={money(item.dueAmount)} tone={item.paymentCleared ? "success" : "warning"} />
      </View>

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <AppButton
          title="Patient"
          icon="person-circle-outline"
          variant="secondary"
          onPress={() => router.push(`/patient/${item.patientId}` as never)}
          style={{ flex: 1, minWidth: "30%" }}
        />
        <AppButton
          title="Plan Sitting"
          icon="calendar-number-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/appointment/book", params: { patient_id: item.patientId } } as never)}
          style={{ flex: 1, minWidth: "30%" }}
        />
        {!item.paymentCleared ? (
          <AppButton
            title="Collect Due"
            icon="cash-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: "/patient/payment", params: { patient_id: item.patientId } } as never)}
            style={{ flex: 1, minWidth: "30%" }}
          />
        ) : null}
      </View>

      {canComplete ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {allowStatusUpdates && item.status === "planned" ? (
            <AppButton
              title="Start"
              icon="play-outline"
              variant="secondary"
              loading={updating}
              onPress={() => onUpdateStatus("ongoing")}
              style={{ flex: 1 }}
            />
          ) : null}
          {canComplete ? (
            <AppButton
              title="Complete"
              icon="checkmark-done-outline"
              loading={updating}
              onPress={() => onUpdateStatus("completed")}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AmountTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}) {
  const backgroundColor = tone === "success" ? colors.successSoft : tone === "warning" ? colors.warningSoft : colors.surfaceSoft;
  const valueColor = tone === "success" ? colors.success : tone === "warning" ? colors.warning : colors.text;

  return (
    <View
      style={{
        flex: 1,
        minWidth: "30%",
        padding: 12,
        borderRadius: 16,
        backgroundColor,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ color: valueColor, fontSize: 17, fontWeight: "900", marginTop: 4 }}>
        {value}
      </Text>
    </View>
  );
}
