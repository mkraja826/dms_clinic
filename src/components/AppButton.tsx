import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, ViewStyle } from "react-native";
import { colors, radius } from "@/constants/colors";

type Props = {
  title: string;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  loadingTitle?: string;
  disabled?: boolean;
  style?: ViewStyle;
};

export function AppButton({
  title,
  onPress,
  icon,
  variant = "primary",
  loading,
  loadingTitle,
  disabled,
  style,
}: Props) {
  const isDisabled = disabled || loading;
  const accessibilityLabel = loading ? loadingTitle ?? title : title;

  const background =
    variant === "primary"
      ? colors.primary
      : variant === "danger"
      ? colors.danger
      : variant === "ghost"
      ? "transparent"
      : colors.primarySoft;

  const textColor =
    variant === "primary" || variant === "danger"
      ? colors.white
      : variant === "ghost"
      ? colors.primary
      : colors.primaryDark;

  const disabledBackground = variant === "ghost" ? "transparent" : colors.border;
  const disabledText = variant === "ghost" ? colors.muted : colors.white;
  const finalTextColor = isDisabled ? disabledText : textColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={8}
      android_ripple={isDisabled ? undefined : { color: "rgba(15, 118, 110, 0.14)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 54,
        borderRadius: radius.md,
        paddingHorizontal: 18,
        paddingVertical: 12,
        backgroundColor: isDisabled ? disabledBackground : background,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        overflow: "hidden",
        opacity: isDisabled ? 0.72 : pressed ? 0.9 : 1,
        transform: [{ scale: pressed && !isDisabled ? 0.99 : 1 }],
        borderWidth: variant === "ghost" || variant === "secondary" ? 1 : 0,
        borderColor: variant === "secondary" ? colors.primarySoft : colors.border,
        shadowColor: colors.shadow,
        shadowOpacity: variant === "primary" && !isDisabled ? 0.08 : 0,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 5 },
        elevation: variant === "primary" && !isDisabled ? 2 : 0,
        ...style,
      })}
    >
      {loading ? (
        <>
          <ActivityIndicator color={finalTextColor} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={{ color: finalTextColor, fontSize: 15, fontWeight: "800" }}
          >
            {loadingTitle ?? title}
          </Text>
        </>
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={finalTextColor} /> : null}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={{ color: finalTextColor, fontSize: 15, fontWeight: "800" }}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
