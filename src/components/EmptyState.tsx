import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { colors } from "@/constants/colors";

export function EmptyState({
  title,
  message,
  body,
  icon = "file-tray-outline",
  actionTitle,
  onAction,
}: {
  title: string;
  message?: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const copy = message ?? body ?? "";

  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        gap: 12,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 58,
          height: 58,
          borderRadius: 22,
          backgroundColor: colors.surfaceSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>

      <View style={{ gap: 4, alignItems: "center" }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center" }}>
          {title}
        </Text>
        {copy ? (
          <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
            {copy}
          </Text>
        ) : null}
      </View>

      {actionTitle && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionTitle}
          onPress={onAction}
          style={({ pressed }) => ({
            marginTop: 2,
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: 999,
            backgroundColor: pressed ? colors.primaryDark : colors.primary,
          })}
        >
          <Text style={{ color: colors.white, fontWeight: "900" }}>{actionTitle}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
