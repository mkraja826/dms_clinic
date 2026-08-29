import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Text, Pressable, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";

export default function PatientPaymentsSettingsScreen() {
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "head_doctor";

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={{ width: 42, height: 42, borderRadius: 16, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>Patient Payments</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Simple clinic-owned QR collection with receptionist verification for V28.
          </Text>
        </View>
      </View>

      <View style={{ padding: 14, borderRadius: 20, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.success, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Ionicons name="qr-code-outline" size={30} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>Manual QR mode</Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
            Patient pays the clinic directly. CapDent records payment only after reception confirms the actual receipt.
          </Text>
        </View>
      </View>

      <SectionCard title="Clinic QR accounts" subtitle="Add multiple clinic-owned receiving QRs such as PhonePe, Google Pay, Paytm, or bank UPI.">
        <View style={{ gap: 9 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>• Multiple QRs per clinic</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>• One default QR, with reception able to select another active QR</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>• Private QR image storage scoped to the clinic</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>• Optional account name and UPI ID for staff clarity</Text>
        </View>

        {canManage ? (
          <AppButton
            title="Manage Payment QRs"
            icon="qr-code-outline"
            onPress={() => router.push("/settings/payment-qr-accounts" as never)}
          />
        ) : (
          <Text style={{ color: colors.warning, fontWeight: "800", lineHeight: 20 }}>
            Only the clinic owner or head doctor can change QR configuration. Reception can use active QRs during collection.
          </Text>
        )}
      </SectionCard>

      <SectionCard title="Reception payment flow" subtitle="V28 intentionally keeps payment verification manual and auditable.">
        <View style={{ gap: 9 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>1. Select the patient and payment category.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>2. Enter the amount to collect.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>3. Choose an active clinic QR and show it to the patient.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>4. Patient pays with any compatible UPI app.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>5. Reception verifies the receipt in the clinic payment app/bank.</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>6. Only then does reception record the payment in CapDent.</Text>
        </View>
      </SectionCard>

      <SectionCard title="Automatic provider payments" subtitle="Not part of the V28 production dependency.">
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          PhonePe Partner/API onboarding, webhooks, automatic verification, connected card accounts, and provider reconciliation are deferred to a later release. Existing experimental provider code stays dormant and does not block V28 QR collection.
        </Text>
      </SectionCard>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: colors.warningSoft }}>
        <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18, textAlign: "center", fontWeight: "700" }}>
          Displaying or scanning a QR never marks an invoice as paid. A staff member must verify the actual receipt before recording payment.
        </Text>
      </View>
    </Screen>
  );
}
