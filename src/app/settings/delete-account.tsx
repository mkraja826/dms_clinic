import { router } from "expo-router";
import { Linking, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { CAPDENT_DELETE_ACCOUNT_URL } from "@/lib/legalLinks";
import { CAPDENT_SUPPORT_EMAIL } from "@/lib/supportContact";

export default function DeleteAccountScreen() {
  const subject = encodeURIComponent("CapDent account and data deletion request");
  const body = encodeURIComponent(
    `Hello CapDent Support,\n\nI want to request deletion of my CapDent account and related data.\n\nPlease tell me what information you need to verify my request securely.\n\nI understand that some clinic, medical, billing, security, or legal records may need to be retained where required.\n\nPlease confirm the deletion process.`
  );

  function requestDeletion() {
    Linking.openURL(`mailto:${CAPDENT_SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  }

  function openDeletePage() {
    Linking.openURL(CAPDENT_DELETE_ACCOUNT_URL);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SectionCard title="Delete Account & Data" subtitle="Request account and clinic data deletion.">
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>What can be deleted?</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            You may request deletion of your login account and related clinic data, including clinic profile,
            staff access, patient records, appointments, visits, uploaded prescriptions, X-rays, photos, payment
            records, and reminders, where legally and operationally possible.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>Important clinic notice</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Dental clinics may need to retain some medical, billing, or legal records where required by law,
            professional obligations, dispute resolution, security, or fraud-prevention needs.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>How to request deletion</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Start with the public deletion page or send a deletion request email. The email does not automatically attach
            your clinic ID, user ID, role, or staff name. Support should request only the minimum information needed to
            verify the request securely before deleting or restricting access to data.
          </Text>
        </View>
      </SectionCard>

      <AppButton title="Open Delete Account Page" variant="secondary" icon="open-outline" onPress={openDeletePage} />
      <AppButton title="Request deletion by email" variant="danger" icon="trash-outline" onPress={requestDeletion} />
      <AppButton title="Back" variant="secondary" icon="arrow-back-outline" onPress={() => router.back()} />
    </ScrollView>
  );
}
