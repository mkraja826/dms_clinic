import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { colors, radius } from "@/constants/colors";

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      hitSlop={6}
      android_ripple={{ color: "rgba(15, 118, 110, 0.10)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 76,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: 14,
        borderWidth: 1,
        borderColor: pressed ? colors.primary : colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        overflow: "hidden",
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.995 : 1 }],
        shadowColor: colors.shadow,
        shadowOpacity: 0.025,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      })}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(15, 118, 110, 0.12)",
        }}
      >
        <Ionicons name={icon} size={23} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.84} style={{ color: colors.text, fontSize: 15, fontWeight: "800" }}>
          {title}
        </Text>
        <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.muted}
        accessible={false}
        importantForAccessibility="no"
      />
    </Pressable>
  );
}
