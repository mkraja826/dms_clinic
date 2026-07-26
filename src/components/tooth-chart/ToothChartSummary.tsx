import { Text, View } from "react-native";
import { colors } from "@/constants/colors";
import {
  conditionLabel,
  summarizeToothFindings,
  ToothFinding,
} from "@/lib/toothChart";

export function ToothChartSummary({
  findings,
  compact = false,
}: {
  findings: ToothFinding[];
  compact?: boolean;
}) {
  const summary = summarizeToothFindings(findings);

  if (summary.total === 0) {
    return (
      <Text style={{ color: colors.muted, lineHeight: 19 }}>
        No tooth findings added to this visit.
      </Text>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SummaryPill label={`${summary.total} charted`} />
        <SummaryPill label={`${summary.affected} affected`} />
        {summary.treatmentLinked > 0 ? (
          <SummaryPill label={`${summary.treatmentLinked} treatment linked`} />
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
        {Object.entries(summary.byCondition)
          .map(([condition, count]) => {
            const label = conditionLabel(condition as ToothFinding["condition"]);
            return `${label}: ${count}`;
          })
          .join(" · ")}
      </Text>
      {!compact ? (
        <View style={{ gap: 7 }}>
          {findings
            .slice()
            .sort((left, right) =>
              left.toothCode.localeCompare(right.toothCode)
            )
            .map((finding) => (
              <View
                key={`${finding.dentition}:${finding.toothCode}`}
                style={{
                  borderRadius: 14,
                  padding: 10,
                  backgroundColor: colors.surfaceSoft,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {finding.toothCode} · {conditionLabel(finding.condition)}
                </Text>
                {finding.surfaces.length > 0 ? (
                  <Text style={{ color: colors.muted, marginTop: 3 }}>
                    Surfaces: {finding.surfaces.join(", ")}
                  </Text>
                ) : null}
                {finding.treatmentName ? (
                  <Text style={{ color: colors.primary, marginTop: 3 }}>
                    {finding.treatmentName} · {finding.treatmentStatus}
                  </Text>
                ) : null}
              </View>
            ))}
        </View>
      ) : null}
    </View>
  );
}

function SummaryPill({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        minHeight: 30,
        justifyContent: "center",
        backgroundColor: colors.primarySoft,
      }}
    >
      <Text style={{ color: colors.primaryDark, fontSize: 12, fontWeight: "900" }}>
        {label}
      </Text>
    </View>
  );
}
