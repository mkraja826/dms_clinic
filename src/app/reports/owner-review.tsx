import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  analyticsAttentionBucket,
  analyticsOwnerReviewItem,
  logCapDentAnalyticsEvent,
} from "@/lib/firebaseAnalytics";
import { getOwnerReviewReport, OwnerReviewReport, OwnerReviewTone } from "@/lib/ownerReview";

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toneLabel(tone: OwnerReviewTone) {
  if (tone === "danger") return "Needs action";
  if (tone === "warning") return "Review";
  if (tone === "success") return "Clear";
  return "Check";
}

function patientMeta(patientCode?: string | null, phone?: string | null) {
  return `${patientCode || "No ID"} • ${phone || "No phone"}`;
}

export default function OwnerReviewBoardScreen() {
  const [report, setReport] = useState<OwnerReviewReport | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(action: "view" | "refresh" = "refresh") {
    try {
      setLoading(true);
      const data = await getOwnerReviewReport();
      setReport(data);
      const urgentCount = data.cards
        .filter((card) => card.tone === "danger" || card.tone === "warning")
        .reduce((sum, card) => sum + card.count, 0);
      void logCapDentAnalyticsEvent("capdent_owner_review", {
        action,
        item: "none",
        attention: analyticsAttentionBucket(urgentCount),
      });
    } catch (error) {
      Alert.alert("Owner review failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("view");
  }, []);

  const cards = report?.cards ?? [];
  const urgentCount = cards.filter((card) => card.tone === "danger" || card.tone === "warning").reduce((sum, card) => sum + card.count, 0);

  function openCard(card: OwnerReviewReport["cards"][number]) {
    void logCapDentAnalyticsEvent("capdent_owner_review", {
      action: "open_card",
      item: analyticsOwnerReviewItem(card.key),
      attention: analyticsAttentionBucket(card.count),
    });
    router.push(card.route as never);
  }

  return (
    <Screen refreshing={loading} onRefresh={() => load("refresh")}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>Owner Review Board</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          One screen for missed follow-ups, paid active treatments, OP waivers, and patient detail edits.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatCard label="Needs Review" value={loading ? "..." : urgentCount} icon="alert-circle-outline" tone={urgentCount ? "warning" : "success"} />
        <StatCard label="Missed Follow-ups" value={loading ? "..." : report?.missedFollowups.length ?? 0} icon="calendar-clear-outline" tone={report?.missedFollowups.length ? "danger" : "success"} />
        <StatCard label="Paid Active" value={loading ? "..." : report?.paidActiveTreatments.length ?? 0} icon="checkmark-done-outline" tone={report?.paidActiveTreatments.length ? "warning" : "success"} />
        <StatCard label="Waived OP" value={loading ? "..." : report?.waivedOpFees.length ?? 0} icon="receipt-outline" tone={report?.waivedOpFees.length ? "warning" : "success"} />
      </View>

      <SectionCard title="Owner Action Cards" subtitle="Open the review screen connected to each issue. Green means clear, orange/red means owner should check.">
        <View style={{ gap: 10 }}>
          {cards.map((card) => (
            <View key={card.key} style={{ padding: 14, borderRadius: 20, borderWidth: 1, borderColor: card.tone === "danger" ? colors.danger : card.tone === "warning" ? colors.warning : colors.border, backgroundColor: colors.background, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: card.tone === "danger" ? colors.dangerSoft : card.tone === "warning" ? colors.warningSoft : colors.successSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={card.tone === "danger" ? "alert-circle-outline" : card.tone === "warning" ? "warning-outline" : "checkmark-circle-outline"} size={22} color={card.tone === "danger" ? colors.danger : card.tone === "warning" ? colors.warning : colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>{card.title}</Text>
                  <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 18 }}>{card.subtitle}</Text>
                </View>
                <StatusBadge label={`${card.count} ${toneLabel(card.tone)}`} tone={card.tone} />
              </View>
              <AppButton title={card.action} icon="open-outline" variant={card.count ? "secondary" : "ghost"} onPress={() => openCard(card)} />
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Missed / Overdue Follow-ups" subtitle="Patients who should have been called or rescheduled.">
        {report?.missedFollowups.length ? (
          <View style={{ gap: 10 }}>
            {report.missedFollowups.slice(0, 6).map((item) => (
              <View key={`${item.source}-${item.id}`} style={{ padding: 12, borderRadius: 18, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>{item.patient_name}</Text>
                <Text style={{ color: colors.muted }}>{patientMeta(item.patient_code, item.patient_phone)}</Text>
                <Text style={{ color: colors.danger, fontWeight: "900" }}>Due: {dateTime(item.due_at)}</Text>
                {item.notes ? <Text style={{ color: colors.muted }} numberOfLines={2}>{item.notes}</Text> : null}
              </View>
            ))}
            <AppButton title="Open Follow-up Review" icon="repeat-outline" onPress={() => router.push("/reports/followups" as never)} />
          </View>
        ) : (
          <EmptyState title="No missed follow-ups" message="Follow-up work is clear right now." icon="checkmark-circle-outline" />
        )}
      </SectionCard>

      <SectionCard title="Paid But Still Active" subtitle="Payment is clear, but treatment is still planned/ongoing. Doctor should complete it or plan next sitting.">
        {report?.paidActiveTreatments.length ? (
          <View style={{ gap: 10 }}>
            {report.paidActiveTreatments.slice(0, 6).map((item) => (
              <View key={item.id} style={{ padding: 12, borderRadius: 18, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>{item.treatment_name}</Text>
                <Text style={{ color: colors.muted }}>{item.patient_name} • {patientMeta(item.patient_code, item.patient_phone)}</Text>
                <Text style={{ color: colors.warning, fontWeight: "900" }}>{item.status.toUpperCase()} • {money(item.cost)}</Text>
              </View>
            ))}
            <AppButton title="Open Treatment Review" icon="hammer-outline" onPress={() => router.push("/reports/treatments" as never)} />
          </View>
        ) : (
          <EmptyState title="No paid-active review" message="No paid treatment is silently left active." icon="checkmark-done-outline" />
        )}
      </SectionCard>

      <SectionCard title="Waived OP Fee Review" subtitle="Owner should verify every OP fee waived today.">
        {report?.waivedOpFees.length ? (
          <View style={{ gap: 10 }}>
            {report.waivedOpFees.slice(0, 6).map((item) => (
              <View key={item.id} style={{ padding: 12, borderRadius: 18, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>{item.patient_name}</Text>
                <Text style={{ color: colors.muted }}>{patientMeta(item.patient_code, item.patient_phone)}</Text>
                <Text style={{ color: colors.warning, fontWeight: "900" }}>Waived {money(item.amount)} • {item.reason || "No reason"}</Text>
                <Text style={{ color: colors.muted }}>By: {item.waived_by_name || "Staff"}</Text>
              </View>
            ))}
            <AppButton title="Open Payment Review" icon="card-outline" onPress={() => router.push("/reports/payments" as never)} />
          </View>
        ) : (
          <EmptyState title="No OP waivers today" message="No waived OP fee needs owner review today." icon="receipt-outline" />
        )}
      </SectionCard>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton title="Refresh" icon="refresh-outline" variant="secondary" onPress={() => void load("refresh")} loading={loading} style={{ flex: 1 }} />
        <AppButton title="Clinic Report" icon="analytics-outline" variant="ghost" onPress={() => router.replace("/reports/clinic" as never)} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
