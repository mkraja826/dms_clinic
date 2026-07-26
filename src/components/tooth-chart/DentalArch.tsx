import { ScrollView, Text, View } from "react-native";
import { colors } from "@/constants/colors";
import {
  Dentition,
  FDI_ARCHES,
  ToothFinding,
} from "@/lib/toothChart";
import { ToothGraphic } from "./ToothGraphic";

export function DentalArch({
  dentition,
  findings,
  selectedCodes,
  readOnly = false,
  onToothPress,
  onToothLongPress,
}: {
  dentition: Dentition;
  findings: Record<string, ToothFinding>;
  selectedCodes: string[];
  readOnly?: boolean;
  onToothPress?: (code: string) => void;
  onToothLongPress?: (code: string) => void;
}) {
  return (
    <View style={{ gap: 14 }}>
      {(["upper", "lower"] as const).map((arch) => (
        <View key={arch} style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 14,
                fontWeight: "900",
                textTransform: "capitalize",
              }}
            >
              {arch} arch
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              Patient's right → left
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={{ gap: 6, paddingBottom: 6 }}
          >
            {FDI_ARCHES[dentition][arch].map((code, index) => (
              <View
                key={code}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {index === FDI_ARCHES[dentition][arch].length / 2 ? (
                  <View
                    accessibilityLabel="Dental midline"
                    style={{
                      width: 2,
                      height: 58,
                      borderRadius: 999,
                      backgroundColor: colors.primary,
                      marginHorizontal: 2,
                    }}
                  />
                ) : null}
                <ToothGraphic
                  code={code}
                  dentition={dentition}
                  condition={findings[code]?.condition}
                  selected={selectedCodes.includes(code)}
                  readOnly={readOnly}
                  onPress={() => onToothPress?.(code)}
                  onLongPress={() => onToothLongPress?.(code)}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}
