import { Pressable, Text, View } from "react-native";
import { colors } from "@/constants/colors";
import { TOOTH_SURFACES, ToothSurface } from "@/lib/toothChart";

export function ToothSurfaceSelector({
  value,
  onChange,
}: {
  value: ToothSurface[];
  onChange: (surfaces: ToothSurface[]) => void;
}) {
  function toggle(surface: ToothSurface) {
    onChange(
      value.includes(surface)
        ? value.filter((item) => item !== surface)
        : [...value, surface]
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: "900" }}>
        Affected surfaces
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TOOTH_SURFACES.map((surface) => {
          const selected = value.includes(surface.value);
          return (
            <Pressable
              key={surface.value}
              accessibilityRole="checkbox"
              accessibilityLabel={surface.label}
              accessibilityState={{ checked: selected }}
              onPress={() => toggle(surface.value)}
              style={{
                minWidth: 54,
                minHeight: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.surface,
              }}
            >
              <Text
                style={{
                  color: selected ? colors.white : colors.text,
                  fontWeight: "900",
                }}
              >
                {surface.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
