import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { WorkflowBottomNav } from "@/components/WorkflowBottomNav";
import { colors } from "@/constants/colors";
import { receptionWorkflowNavItems } from "@/constants/workflowNav";
import {
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";

type ToolTarget = string | { pathname: string; params?: Record<string, string> };

export default function ReceptionMoreToolsScreen() {
  const [prescriptionEnabled, setPrescriptionEnabled] = useState(
    DEFAULT_CLINIC_FEATURE_SETTINGS.enable_prescription_medications
  );

  useEffect(() => {
    let mounted = true;

    getClinicFeatureSettings()
      .then((settings) => {
        if (mounted) setPrescriptionEnabled(settings.enable_prescription_medications);
      })
      .catch((error) => {
        console.warn("Reception more tools feature load failed:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Screen bottomBar={<WorkflowBottomNav items={receptionWorkflowNavItems} activeKey="more" />}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to reception dashboard"
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 42,
            height: 42,
            borderRadius: 16,
            backgroundColor: colors.surfaceSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>More Tools</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Secondary reception work, reports, files, and account actions.
          </Text>
        </View>
      </View>

      <ToolSection title="Patient Work">
        <ToolRow title="Add Old Patient" subtitle="Enter previous clinic records and opening balance" icon="archive-outline" target="/patient/add-old" />
        <ToolRow title="Ongoing Treatments" subtitle="Review planned, ongoing, and outstanding work" icon="construct-outline" target="/treatments/ongoing" />
        {prescriptionEnabled ? (
          <ToolRow title="Prescribed Tablets" subtitle="Add tablets prescribed by doctor" icon="medical-outline" target="/patient/medications" />
        ) : null}
        <ToolRow title="Gallery" subtitle="X-rays, prescriptions, reports, and photos" icon="images-outline" target="/gallery" />
      </ToolSection>

      <ToolSection title="Collections">
        <ToolRow title="Collect by QR" subtitle="Select patient, OP/X-ray/medication/treatment category and amount" icon="qr-code-outline" target="/reception/counter-payment" />
        <ToolRow title="Review Final Invoice" subtitle="Combine selected OP, X-ray, medication, treatment, and other charges before sending" icon="document-text-outline" target="/reception/final-invoice" />
        <ToolRow title="Finalized Invoices" subtitle="Review frozen invoices and manually send them to patients" icon="documents-outline" target="/reception/finalized-invoices" />
        <ToolRow title="Pending Payments" subtitle="Collect old due or treatment balance" icon="wallet-outline" target="/patient/payment" />
        <ToolRow title="OP Fee" subtitle="Collect OP consultation fee" icon="receipt-outline" target={{ pathname: "/payment/fee", params: { fee_type: "op_fee" } }} />
        <ToolRow title="X-ray Fee" subtitle="Collect separate X-ray amount" icon="scan-outline" target={{ pathname: "/payment/fee", params: { fee_type: "xray_fee" } }} />
        <ToolRow title="Medication / Treatment Fee" subtitle="Collect medicine, treatment, or other clinic fee" icon="cash-outline" target={{ pathname: "/payment/fee", params: { fee_type: "medication_fee" } }} />
      </ToolSection>

      <ToolSection title="Clinic">
        <ToolRow title="Reminders" subtitle="Follow-ups due and pending payment reminders" icon="notifications-outline" target="/reminders" />
        <ToolRow title="Legal & Account" subtitle="Logout, privacy, support, and account options" icon="shield-checkmark-outline" target="/settings/legal" />
        <ToolRow title="Change Password" subtitle="Update your login password" icon="key-outline" target="/settings/change-password" />
      </ToolSection>

      <AppButton
        title="Back To Dashboard"
        icon="home-outline"
        variant="secondary"
        onPress={() => router.replace("/(reception)/dashboard" as never)}
      />
    </Screen>
  );
}

function ToolSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{title}</Text>
      <View
        style={{
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ToolRow({
  title,
  subtitle,
  icon,
  target,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  target: ToolTarget;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => router.push(target as never)}
      android_ripple={{ color: "rgba(15, 118, 110, 0.08)", borderless: false }}
      style={({ pressed }) => ({
        minHeight: 66,
        paddingVertical: 11,
        paddingHorizontal: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
      })}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, marginTop: 2, fontSize: 12 }}>
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
