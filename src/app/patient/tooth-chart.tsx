import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { DentalArch } from "@/components/tooth-chart/DentalArch";
import { ToothChartLegend } from "@/components/tooth-chart/ToothChartLegend";
import { ToothChartSummary } from "@/components/tooth-chart/ToothChartSummary";
import { ToothFindingSheet } from "@/components/tooth-chart/ToothFindingSheet";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  isToothChartEnabledForClinic,
  TOOTH_CHART_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";
import { supabase } from "@/lib/supabase";
import {
  canViewFullDentalChart,
  Dentition,
  normalizeToothFinding,
  ToothFinding,
} from "@/lib/toothChart";
import { useVisitDraft } from "@/lib/visitDraft";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAFT_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

type DentalChartRow = {
  id: string;
  tooth_code: string;
  dentition: Dentition;
  condition: ToothFinding["condition"];
  surfaces: ToothFinding["surfaces"];
  notes: string | null;
  treatment_name: string | null;
  treatment_status: ToothFinding["treatmentStatus"];
  created_at: string;
};

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default function ToothChartScreen() {
  const params = useLocalSearchParams<{
    patient_id?: string;
    draft_id?: string;
    readonly?: string;
  }>();
  const { profile } = useAuth();
  const patientId = singleParam(params.patient_id);
  const draftId = singleParam(params.draft_id) || "add-visit";
  const readOnly = singleParam(params.readonly) === "true";
  const safePatientId = UUID_PATTERN.test(patientId) ? patientId : "";
  const safeDraftId = DRAFT_PATTERN.test(draftId) ? draftId : "";

  const {
    draft,
    findings: draftFindings,
    loaded: draftLoaded,
    setDentition,
    applyFinding,
    removeFindings,
  } = useVisitDraft(safePatientId, safeDraftId);
  const [clinicEnabled, setClinicEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [patientName, setPatientName] = useState("");
  const [history, setHistory] = useState<DentalChartRow[]>([]);
  const [historyDentition, setHistoryDentition] =
    useState<Dentition>("permanent");
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [editorCodes, setEditorCodes] = useState<string[]>([]);

  const authorized = canViewFullDentalChart(profile?.role);
  const featureEnabled =
    TOOTH_CHART_GLOBALLY_ENABLED && clinicEnabled && authorized;
  const dentition = readOnly ? historyDentition : draft.dentition;

  const currentHistory = useMemo(() => {
    const currentByTooth = new Map<string, DentalChartRow>();
    for (const row of history) {
      if (
        row.dentition === historyDentition &&
        !currentByTooth.has(row.tooth_code)
      ) {
        currentByTooth.set(row.tooth_code, row);
      }
    }
    return Array.from(currentByTooth.values());
  }, [history, historyDentition]);

  const findings = readOnly
    ? currentHistory.map((row) =>
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
      )
    : draftFindings;

  const findingsByCode = useMemo(
    () =>
      findings.reduce<Record<string, ToothFinding>>((result, finding) => {
        if (finding.dentition === dentition) {
          result[finding.toothCode] = finding;
        }
        return result;
      }, {}),
    [dentition, findings]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        if (!safePatientId || !safeDraftId || !authorized) return;
        if (!TOOTH_CHART_GLOBALLY_ENABLED) return;

        const settings = await getClinicFeatureSettings();
        if (!active) return;
        const enabled = isToothChartEnabledForClinic(
          settings.tooth_chart_enabled
        );
        setClinicEnabled(enabled);
        if (!enabled) return;

        const patientResult = await supabase
          .from("patients")
          .select("name")
          .eq("id", safePatientId)
          .maybeSingle();
        if (patientResult.error) throw patientResult.error;
        if (!patientResult.data) throw new Error("Patient not found");
        if (active) setPatientName(patientResult.data.name);

        if (readOnly) {
          const chartResult = await supabase
            .from("dental_chart_entries")
            .select(
              "id,tooth_code,dentition,condition,surfaces,notes,treatment_name,treatment_status,created_at"
            )
            .eq("patient_id", safePatientId)
            .order("created_at", { ascending: false })
            .limit(250);
          if (chartResult.error) throw chartResult.error;
          const rows = (chartResult.data ?? []) as DentalChartRow[];
          if (active) {
            setHistory(rows);
            if (
              rows.length > 0 &&
              !rows.some((row) => row.dentition === "permanent")
            ) {
              setHistoryDentition("primary");
            }
          }
        }
      } catch (error) {
        console.warn(
          "Dental chart load failed:",
          error instanceof Error ? error.message : error
        );
        if (active) {
          setClinicEnabled(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authorized, readOnly, safeDraftId, safePatientId]);

  function selectDentition(next: Dentition) {
    setSelectedCodes([]);
    if (readOnly) setHistoryDentition(next);
    else setDentition(next);
  }

  function toggleSelection(code: string) {
    setSelectedCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    );
  }

  function openSingleEditor(code: string) {
    if (selectedCodes.length > 0) {
      toggleSelection(code);
      return;
    }
    setEditorCodes([code]);
  }

  if (loading || (!readOnly && !draftLoaded)) {
    return (
      <Screen>
        <View
          style={{
            minHeight: 300,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.muted }}>Loading dental chart…</Text>
        </View>
      </Screen>
    );
  }

  if (!safePatientId || !safeDraftId || !authorized || !featureEnabled) {
    const message = !authorized
      ? "Clinical dental chart details are available only to authorized dentists."
      : "The dental chart is disabled for this build or clinic.";
    return (
      <Screen>
        <SectionCard title="Dental chart unavailable" subtitle={message}>
          <AppButton
            title="Go back"
            icon="arrow-back-outline"
            variant="ghost"
            onPress={() => router.back()}
          />
        </SectionCard>
      </Screen>
    );
  }

  const editorFinding = editorCodes[0]
    ? findingsByCode[editorCodes[0]] ?? null
    : null;

  return (
    <Screen>
      <View style={{ gap: 5 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>
          {readOnly ? "Dental Chart History" : "Chart Visit Findings"}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          {patientName || "Selected patient"} · FDI notation
        </Text>
      </View>

      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", gap: 10 }}
      >
        {(["permanent", "primary"] as const).map((mode) => {
          const selected = dentition === mode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => selectDentition(mode)}
              style={{
                flex: 1,
                minHeight: 50,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.surface,
              }}
            >
              <Text
                style={{
                  color: selected ? colors.white : colors.text,
                  fontWeight: "900",
                  textTransform: "capitalize",
                }}
              >
                {mode}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!readOnly ? (
        <View
          style={{
            borderRadius: 18,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.infoSoft,
          }}
        >
          <Ionicons name="hand-left-outline" size={22} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.text, lineHeight: 19 }}>
            Tap a tooth to edit it. Long press teeth for multi-selection, then
            apply one finding to the selected group.
          </Text>
        </View>
      ) : null}

      <SectionCard
        title={`${dentition === "permanent" ? "Permanent" : "Primary"} dentition`}
        subtitle="Colors are reinforced with symbols, borders, and text labels."
      >
        <DentalArch
          dentition={dentition}
          findings={findingsByCode}
          selectedCodes={selectedCodes}
          readOnly={readOnly}
          onToothPress={openSingleEditor}
          onToothLongPress={toggleSelection}
        />
      </SectionCard>

      <ToothChartLegend />

      {selectedCodes.length > 0 && !readOnly ? (
        <View
          style={{
            position: "relative",
            borderRadius: 20,
            padding: 12,
            gap: 10,
            backgroundColor: colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.primary,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            {selectedCodes.length} teeth selected: {selectedCodes.join(", ")}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton
              title="Cancel"
              variant="ghost"
              onPress={() => setSelectedCodes([])}
              style={{ flex: 0.4 }}
            />
            <AppButton
              title="Edit selected"
              icon="create-outline"
              onPress={() => setEditorCodes(selectedCodes)}
              style={{ flex: 0.6 }}
            />
          </View>
        </View>
      ) : null}

      <SectionCard
        title={readOnly ? "Current recorded findings" : "Visit summary"}
      >
        <ToothChartSummary
          findings={findings.filter(
            (finding) => finding.dentition === dentition
          )}
        />
      </SectionCard>

      {readOnly && history.length > 0 ? (
        <SectionCard
          title="Recent chart history"
          subtitle="Append-only entries, newest first."
        >
          {history.slice(0, 20).map((row) => (
            <View
              key={row.id}
              style={{
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                gap: 3,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Tooth {row.tooth_code} · {row.condition.replaceAll("_", " ")}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {new Date(row.created_at).toLocaleString()}
                {row.treatment_name ? ` · ${row.treatment_name}` : ""}
              </Text>
            </View>
          ))}
        </SectionCard>
      ) : null}

      <AppButton
        title={readOnly ? "Back to patient" : "Done with chart"}
        icon="checkmark-circle-outline"
        onPress={() => router.back()}
      />

      {!readOnly ? (
        <ToothFindingSheet
          visible={editorCodes.length > 0}
          codes={editorCodes}
          dentition={dentition}
          initialFinding={editorFinding}
          onClose={() => setEditorCodes([])}
          onClear={() => {
            removeFindings(editorCodes);
            setEditorCodes([]);
            setSelectedCodes([]);
          }}
          onSave={(finding) => {
            applyFinding(editorCodes, finding);
            setEditorCodes([]);
            setSelectedCodes([]);
          }}
        />
      ) : null}
    </Screen>
  );
}
