import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "@/constants/colors";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
};

export function QuickAction({ icon, label, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      android_ripple={{ color: "rgba(15, 118, 110, 0.10)", borderless: false }}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 102,
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        padding: 12,
        backgroundColor: pressed ? colors.primarySoft : colors.card,
      })}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ backgroundColor: colors.primarySoft, borderRadius: 999, padding: 9 }}
      >
        <Ionicons name={icon} color={colors.primary} size={20} />
      </View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
}
