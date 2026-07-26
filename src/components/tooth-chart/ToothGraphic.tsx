import { Pressable, Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { colors } from "@/constants/colors";
import {
  conditionLabel,
  Dentition,
  getToothDefinition,
  ToothCondition,
} from "@/lib/toothChart";

const SHAPES = {
  incisor:
    "M12 5 C17 2 27 2 32 5 L30 27 C29 36 25 46 22 50 C20 53 18 53 16 50 C13 46 9 36 8 27 Z",
  canine:
    "M11 8 C16 2 27 2 33 8 L29 29 C27 39 24 50 20 54 C16 50 13 39 11 29 Z",
  premolar:
    "M7 9 C12 2 30 2 35 9 L31 30 C29 41 25 50 21 54 C17 50 13 41 11 30 Z",
  molar:
    "M5 10 C9 3 33 3 37 10 L34 31 C32 42 27 50 21 54 C15 50 10 42 8 31 Z",
};

function conditionColor(condition: ToothCondition) {
  const map: Record<ToothCondition, string> = {
    healthy: "#FFFFFF",
    caries: "#FCA5A5",
    filled: "#93C5FD",
    missing: "#E5E7EB",
    crown: "#C4B5FD",
    root_canal: "#FDBA74",
    implant: "#5EEAD4",
    extraction_planned: "#FECACA",
    unerupted: "#E5E7EB",
  };
  return map[condition];
}

function ConditionMarker({ condition }: { condition: ToothCondition }) {
  if (condition === "healthy") return null;
  if (condition === "caries") {
    return <Circle cx="21" cy="18" r="5" fill="#B91C1C" />;
  }
  if (condition === "filled") {
    return (
      <Path
        d="M14 19 L19 24 L29 13"
        fill="none"
        stroke="#1D4ED8"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (condition === "missing" || condition === "extraction_planned") {
    return (
      <>
        <Line x1="12" y1="13" x2="30" y2="34" stroke="#991B1B" strokeWidth="3" />
        <Line x1="30" y1="13" x2="12" y2="34" stroke="#991B1B" strokeWidth="3" />
      </>
    );
  }
  if (condition === "crown") {
    return (
      <Path
        d="M10 15 L14 10 L20 15 L26 10 L32 15"
        fill="none"
        stroke="#6D28D9"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    );
  }
  if (condition === "root_canal") {
    return (
      <>
        <Line x1="21" y1="16" x2="21" y2="45" stroke="#9A3412" strokeWidth="3" />
        <Line x1="15" y1="19" x2="27" y2="19" stroke="#9A3412" strokeWidth="3" />
      </>
    );
  }
  if (condition === "implant") {
    return (
      <>
        <Line x1="21" y1="20" x2="21" y2="46" stroke="#0F766E" strokeWidth="3" />
        {[27, 33, 39].map((y) => (
          <Line
            key={y}
            x1="15"
            y1={y}
            x2="27"
            y2={y}
            stroke="#0F766E"
            strokeWidth="2"
          />
        ))}
      </>
    );
  }
  return (
    <SvgText
      x="21"
      y="28"
      textAnchor="middle"
      fontSize="13"
      fontWeight="800"
      fill="#4B5563"
    >
      U
    </SvgText>
  );
}

export function ToothGraphic({
  code,
  dentition,
  condition = "healthy",
  selected = false,
  readOnly = false,
  onPress,
  onLongPress,
}: {
  code: string;
  dentition: Dentition;
  condition?: ToothCondition;
  selected?: boolean;
  readOnly?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const definition = getToothDefinition(code, dentition);
  const family = definition?.family ?? "molar";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tooth ${code}, ${conditionLabel(condition)}${
        selected ? ", selected" : ""
      }`}
      accessibilityHint={
        readOnly
          ? "Displays the recorded dental finding"
          : "Tap to edit. Long press to select several teeth."
      }
      accessibilityState={{ selected, disabled: readOnly }}
      disabled={readOnly}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 50,
        minHeight: 78,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <Svg width={42} height={58} viewBox="0 0 42 58">
        {condition === "unerupted" ? (
          <Rect
            x="4"
            y="3"
            width="34"
            height="52"
            rx="12"
            fill="none"
            stroke="#64748B"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        ) : null}
        <Path
          d={SHAPES[family]}
          fill={conditionColor(condition)}
          stroke={
            condition === "missing" || condition === "extraction_planned"
              ? "#991B1B"
              : "#456579"
          }
          strokeWidth="2"
          strokeDasharray={
            condition === "missing" || condition === "extraction_planned"
              ? "4 3"
              : undefined
          }
          strokeLinejoin="round"
        />
        <ConditionMarker condition={condition} />
      </Svg>
      <View style={{ minHeight: 18, justifyContent: "center" }}>
        <Text
          style={{
            color: selected ? colors.primaryDark : colors.text,
            fontSize: 12,
            fontWeight: "900",
          }}
        >
          {code}
        </Text>
      </View>
    </Pressable>
  );
}
