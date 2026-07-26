import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { colors } from "@/constants/colors";
import {
  createHealthyFinding,
  DentalTreatmentStatus,
  Dentition,
  TOOTH_CONDITIONS,
  ToothCondition,
  ToothFinding,
  ToothSurface,
} from "@/lib/toothChart";
import { ToothSurfaceSelector } from "./ToothSurfaceSelector";

export function ToothFindingSheet({
  visible,
  codes,
  dentition,
  initialFinding,
  onClose,
  onSave,
  onClear,
}: {
  visible: boolean;
  codes: string[];
  dentition: Dentition;
  initialFinding?: ToothFinding | null;
  onClose: () => void;
  onSave: (finding: Partial<ToothFinding>) => void;
  onClear: () => void;
}) {
  const [condition, setCondition] = useState<ToothCondition>("healthy");
  const [surfaces, setSurfaces] = useState<ToothSurface[]>([]);
  const [notes, setNotes] = useState("");
  const [treatmentName, setTreatmentName] = useState("");
  const [treatmentStatus, setTreatmentStatus] =
    useState<DentalTreatmentStatus>("planned");

  useEffect(() => {
    if (!visible || codes.length === 0) return;
    const initial =
      initialFinding ?? createHealthyFinding(codes[0], dentition);
    setCondition(initial.condition);
    setSurfaces(initial.surfaces);
    setNotes(initial.notes);
    setTreatmentName(initial.treatmentName);
    setTreatmentStatus(initial.treatmentStatus);
  }, [codes.join(","), dentition, initialFinding, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(15, 23, 42, 0.38)",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "90%",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            backgroundColor: colors.background,
            paddingTop: 14,
            paddingHorizontal: 18,
            paddingBottom: 22,
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text
                style={{ color: colors.text, fontSize: 21, fontWeight: "900" }}
              >
                {codes.length > 1
                  ? `Edit ${codes.length} teeth`
                  : `Tooth ${codes[0] ?? ""}`}
              </Text>
              <Text style={{ color: colors.muted }}>
                {codes.join(", ")} · {dentition}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close tooth editor"
              onPress={onClose}
              hitSlop={10}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.surface,
              }}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 16, paddingBottom: 8 }}
          >
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Clinical condition
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TOOTH_CONDITIONS.map((item) => {
                  const selected = condition === item.value;
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="radio"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected }}
                      onPress={() => setCondition(item.value)}
                      style={{
                        minHeight: 46,
                        borderRadius: 14,
                        paddingHorizontal: 11,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                        backgroundColor: colors.surface,
                      }}
                    >
                      <View
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          backgroundColor: item.color,
                          borderWidth: 1,
                          borderColor: colors.muted,
                        }}
                      />
                      <Text
                        style={{
                          color: selected ? colors.primaryDark : colors.text,
                          fontWeight: "800",
                        }}
                      >
                        {item.shortLabel} · {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ToothSurfaceSelector value={surfaces} onChange={setSurfaces} />

            <LabeledInput
              label="Treatment"
              value={treatmentName}
              onChangeText={setTreatmentName}
              placeholder="Optional, e.g. composite filling"
            />

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Treatment status
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["planned", "ongoing", "completed"] as const).map(
                  (status) => {
                    const selected = treatmentStatus === status;
                    return (
                      <Pressable
                        key={status}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setTreatmentStatus(status)}
                        style={{
                          flex: 1,
                          minHeight: 46,
                          borderRadius: 14,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                          backgroundColor: selected
                            ? colors.primary
                            : colors.surface,
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? colors.white : colors.text,
                            fontSize: 12,
                            fontWeight: "900",
                            textTransform: "capitalize",
                          }}
                        >
                          {status}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>
            </View>

            <LabeledInput
              label="Clinical note"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional tooth-specific note"
              multiline
            />
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <AppButton
              title="Clear"
              icon="trash-outline"
              variant="ghost"
              onPress={onClear}
              style={{ flex: 0.42 }}
            />
            <AppButton
              title="Apply"
              icon="checkmark-outline"
              onPress={() =>
                onSave({
                  condition,
                  surfaces,
                  notes,
                  treatmentName,
                  treatmentStatus,
                })
              }
              style={{ flex: 0.58 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: "900" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        maxLength={multiline ? 1000 : 160}
        style={{
          minHeight: multiline ? 92 : 50,
          borderRadius: 15,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: 13,
          paddingVertical: 12,
          color: colors.text,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}
