import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Alert, Linking, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import {
  CAPDENT_DELETE_ACCOUNT_URL,
  CAPDENT_PRIVACY_URL,
  CAPDENT_TERMS_URL,
} from "@/lib/legalLinks";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

function Row({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
      <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: colors.text, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const externalLinkMutation = useImmediateMutationLock();

  async function openUrl(url: string) {
    if (!externalLinkMutation.tryLock()) return;

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Unable to open link", "Please try again later.");
    } finally {
      externalLinkMutation.release();
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>Privacy Help</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Privacy, legal, and support information for clinic users.
        </Text>
      </View>

      <SectionCard title="Privacy" subtitle="Live public privacy policy is available.">
        <Row text="CapDent is used for clinic records, appointments, uploads, payments, reminders, and staff access." />
        <Row text="CapDent may store clinic, staff, patient, appointment, visit, payment, prescription, X-ray, and photo data." />
        <Row text="Only authorized clinic staff should use the app." />
        <Row text="Keep login details private and do not share staff accounts." />
      </SectionCard>

      <SectionCard title="Account and data deletion" subtitle="Deletion requests are available in-app and on the web.">
        <Row text="Users can request account and related data deletion from Legal & Account." />
        <Row text="Clinic records may need to be retained for medical, billing, legal, security, or regulatory reasons." />
      </SectionCard>

      <SectionCard title="Disclaimer" subtitle="Clinic workflow only.">
        <Row text="This app is for clinic management and record keeping." />
        <Row text="CapDent does not provide medical advice, diagnosis, or treatment." />
        <Row text="Clinical decisions remain with qualified clinic professionals." />
      </SectionCard>

      <AppButton title="Open Privacy Policy" icon="open-outline" variant="secondary" onPress={() => { void openUrl(CAPDENT_PRIVACY_URL); }} />
      <AppButton title="Open Delete Account Page" icon="trash-outline" variant="secondary" onPress={() => { void openUrl(CAPDENT_DELETE_ACCOUNT_URL); }} />
      <AppButton title="Open Terms Page" icon="document-text-outline" variant="secondary" onPress={() => { void openUrl(CAPDENT_TERMS_URL); }} />
      <AppButton title="Back" icon="arrow-back-outline" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
