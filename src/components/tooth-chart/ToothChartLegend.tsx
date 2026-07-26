import { Text, View } from "react-native";
import { colors } from "@/constants/colors";
import { TOOTH_CONDITIONS } from "@/lib/toothChart";

export function ToothChartLegend() {
  return (
    <View
      accessibilityLabel="Dental chart condition legend"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
    >
      {TOOTH_CONDITIONS.map((condition) => (
        <View
          key={condition.value}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 9,
            minHeight: 32,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 5,
              backgroundColor: condition.color,
              borderWidth: 1,
              borderColor: colors.muted,
            }}
          />
          <Text style={{ color: colors.text, fontSize: 11, fontWeight: "800" }}>
            {condition.shortLabel} · {condition.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
