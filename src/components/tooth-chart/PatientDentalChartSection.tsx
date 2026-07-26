import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { supabase, Treatment } from "@/lib/supabase";
import {
  canViewFullDentalChart,
  Dentition,
  normalizeToothFinding,
  ToothFinding,
} from "@/lib/toothChart";
import { ToothChartSummary } from "./ToothChartSummary";

type ChartRow = {
  tooth_code: string;
  dentition: Dentition;
  condition: ToothFinding["condition"];
  surfaces: ToothFinding["surfaces"];
  notes: string | null;
  treatment_name: string | null;
  treatment_status: ToothFinding["treatmentStatus"];
  created_at: string;
};

export function PatientDentalChartSection({
  enabled,
  patientId,
  treatments,
}: {
  enabled: boolean;
  patientId: string;
  treatments: Treatment[];
}) {
  const { profile } = useAuth();
  const fullAccess = canViewFullDentalChart(profile?.role);
  const [rows, setRows] = useState<ChartRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    if (!enabled || !fullAccess || !patientId) return;

    void (async () => {
      try {
        setLoading(true);
        setUnavailable(false);
        const { data, error } = await supabase
          .from("dental_chart_entries")
          .select(
            "tooth_code,dentition,condition,surfaces,notes,treatment_name,treatment_status,created_at"
          )
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(250);
        if (error) throw error;
        if (active) setRows((data ?? []) as ChartRow[]);
      } catch (error) {
        console.warn(
          "Patient dental summary unavailable:",
          error instanceof Error ? error.message : error
        );
        if (active) setUnavailable(true);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled, fullAccess, patientId]);

  const currentFindings = useMemo(() => {
    const currentByTooth = new Map<string, ToothFinding>();
    for (const row of rows) {
      const key = `${row.dentition}:${row.tooth_code}`;
      if (currentByTooth.has(key)) continue;
      currentByTooth.set(
        key,
        normalizeToothFinding(
          {
            condition: row.condition,
            surfaces: row.surfaces,
            notes: row.notes ?? "",
            treatmentName: row.treatment_name ?? "",
            treatmentStatus: row.treatment_status,
          },
          row.tooth_code,
          row.dentition
        )
      );
    }
    return Array.from(currentByTooth.values());
  }, [rows]);

  if (!enabled) return null;

  if (!fullAccess) {
    const ongoing = treatments.filter(
      (treatment) => treatment.status === "ongoing"
    ).length;
    const planned = treatments.filter(
      (treatment) => treatment.status === "planned"
    ).length;
    const completed = treatments.filter(
      (treatment) => treatment.status === "completed"
    ).length;

    return (
      <SectionCard
        title="Dental Treatment Summary"
        subtitle="Reception access is limited to treatment workflow. Tooth-level clinical findings and notes stay restricted to dentists."
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <SummaryPill label={`Ongoing ${ongoing}`} />
          <SummaryPill label={`Planned ${planned}`} />
          <SummaryPill label={`Completed ${completed}`} />
        </View>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Dental Chart"
      subtitle="Current tooth findings are derived from append-only visit history."
    >
      {loading ? (
        <View
          style={{
            minHeight: 90,
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted }}>Loading chart summary…</Text>
        </View>
      ) : unavailable ? (
        <EmptyState
          title="Chart unavailable"
          message="The staged dental chart schema is not available yet."
          icon="grid-outline"
        />
      ) : (
        <ToothChartSummary findings={currentFindings} compact />
      )}

      <AppButton
        title="Open chart history"
        icon="grid-outline"
        variant="secondary"
        disabled={loading || unavailable}
        onPress={() =>
          router.push(
            `/patient/tooth-chart?patient_id=${encodeURIComponent(
              patientId
            )}&readonly=true` as never
          )
        }
      />
    </SectionCard>
  );
}

function SummaryPill({ label }: { label: string }) {
  return (
    <View
      style={{
        minHeight: 34,
        justifyContent: "center",
        borderRadius: 999,
        paddingHorizontal: 11,
        backgroundColor: colors.primarySoft,
      }}
    >
      <Text style={{ color: colors.primaryDark, fontWeight: "900" }}>
        {label}
      </Text>
    </View>
  );
}
