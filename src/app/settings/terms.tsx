import { router } from "expo-router";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { CAPDENT_TERMS_URL } from "@/lib/legalLinks";

function openTermsPage() {
  Linking.openURL(CAPDENT_TERMS_URL).catch(() => {
    Alert.alert("Unable to open link", "Please try again later.");
  });
}

export default function TermsScreen() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SectionCard title="Terms & Conditions" subtitle="CapDent usage terms.">
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>1. Purpose</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            CapDent is a clinic management tool for dental clinics to manage patients, appointments, visits, payments,
            prescriptions, X-rays, photos, reminders, and clinic staff workflows.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>2. Clinic Responsibility</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            The clinic owner and authorized clinic staff are responsible for entering accurate patient information,
            keeping login access safe, and using patient data only for legitimate clinic care and administration.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>3. Medical Disclaimer</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            CapDent does not provide medical advice, diagnosis, or treatment. All clinical decisions must be made by
            qualified dental professionals.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>4. Data & Access</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Patient records, medical history, prescriptions, X-rays, photos, payment details, and follow-up details
            are stored for clinic use. Only authorized users should access clinic data.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>5. Misuse</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Users must not misuse the app, access another clinic's data, share login credentials, upload illegal
            content, or use the app in a way that violates applicable laws.
          </Text>

          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>6. Changes</Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            These terms may be updated as CapDent improves. Continued use of the app means the clinic accepts the latest
            version of these terms.
          </Text>
        </View>
      </SectionCard>

      <AppButton title="Open Terms Page" variant="secondary" icon="open-outline" onPress={openTermsPage} />
      <AppButton title="Back" variant="secondary" icon="arrow-back-outline" onPress={() => router.back()} />
    </ScrollView>
  );
}
