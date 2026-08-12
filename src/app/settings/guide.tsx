import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ComponentProps } from "react";
import { Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";

type IconName = ComponentProps<typeof Ionicons>["name"];

type GuideStep = {
  title: string;
  detail: string;
  icon: IconName;
};

const GUIDE_STEPS: GuideStep[] = [
  {
    title: "Create or join a clinic",
    detail: "Owners create the clinic during setup. Staff join using the invite code provided by the clinic owner.",
    icon: "business-outline",
  },
  {
    title: "Add clinic staff",
    detail: "Owners open Staff, create an invite, and share the code only with the intended employee.",
    icon: "people-outline",
  },
  {
    title: "Register a patient",
    detail: "Use Add Patient or Reception Check-in. Search first to avoid creating duplicate patient records.",
    icon: "person-add-outline",
  },
  {
    title: "Create a visit",
    detail: "Open the patient profile and add a visit with the clinical details needed for that appointment.",
    icon: "medkit-outline",
  },
  {
    title: "Use the Dental Chart",
    detail: "Open Dental Chart from the patient workflow to review and record tooth findings without losing earlier chart history.",
    icon: "grid-outline",
  },
  {
    title: "Record treatment",
    detail: "Keep planned, ongoing, and completed treatment status up to date so the clinic can follow pending work safely.",
    icon: "construct-outline",
  },
  {
    title: "Collect payments",
    detail: "Use the appropriate payment workflow and verify the amount and category before saving. Corrections should remain traceable.",
    icon: "wallet-outline",
  },
  {
    title: "Upload clinical files",
    detail: "Attach X-rays, prescriptions, reports, and before/after photos to the correct patient. Review the patient before uploading.",
    icon: "cloud-upload-outline",
  },
  {
    title: "Review clinic work",
    detail: "Use reminders, ongoing treatments, gallery, and owner reports according to your role to verify unfinished work.",
    icon: "checkmark-done-outline",
  },
];

export default function CapDentGuideScreen() {
  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          CapDent Guide
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          A short reference for the clinic workflows used most often. Available actions still depend on your clinic role.
        </Text>
      </View>

      <SectionCard
        title="Safe daily workflow"
        subtitle="Follow these steps as needed. You do not need to complete every step for every patient."
      >
        <View style={{ gap: 16 }}>
          {GUIDE_STEPS.map((step, index) => (
            <View key={step.title} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 15,
                  backgroundColor: colors.primarySoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name={step.icon} size={21} color={colors.primary} />
              </View>

              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
                  {index + 1}. {step.title}
                </Text>
                <Text style={{ color: colors.muted, lineHeight: 20 }}>{step.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Important" subtitle="Protect clinic and patient information.">
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          Confirm the patient and clinic before saving, uploading, collecting payment, or sharing any record. Never share staff login credentials.
        </Text>
      </SectionCard>

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="secondary"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
