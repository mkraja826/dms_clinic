import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { CAPDENT_PRIVACY_URL, CAPDENT_TERMS_URL } from "@/lib/legalLinks";
import {
  CAPDENT_PRIVACY_VERSION,
  CAPDENT_TERMS_VERSION,
  recordCapDentLegalConsent,
} from "@/lib/pricingV25";

async function openLegalUrl(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch (error) {
    console.warn("Unable to open legal page:", error);
    Alert.alert("Unable to open page", "Please try again when you have an internet connection.");
  }
}

export default function LegalConsentScreen() {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  async function continueToCapDent() {
    if (!accepted || saving) return;

    setSaving(true);
    try {
      await recordCapDentLegalConsent({
        termsVersion: CAPDENT_TERMS_VERSION,
        privacyVersion: CAPDENT_PRIVACY_VERSION,
        appVersion: Constants.expoConfig?.version || "unknown",
        platform: "android",
      });

      router.replace("/" as never);
    } catch (error) {
      Alert.alert(
        "Agreement could not be saved",
        error instanceof Error
          ? error.message
          : "CapDent could not confirm your agreement. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Updated Terms & Privacy
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
          Before continuing to your clinic workspace, review and accept the current CapDent Terms of Service and Privacy Policy.
        </Text>
      </View>

      <SectionCard
        title="Your agreement"
        subtitle="Acceptance is required once for this version of the Terms and Privacy Policy."
      >
        <Pressable
          onPress={() => setAccepted((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="Agree to CapDent Terms of Service and Privacy Policy"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            paddingVertical: 8,
          }}
        >
          <Ionicons
            name={accepted ? "checkbox" : "square-outline"}
            size={26}
            color={accepted ? colors.primary : colors.muted}
          />
          <Text style={{ flex: 1, color: colors.text, lineHeight: 22 }}>
            I have read and agree to the CapDent Terms of Service and Privacy Policy.
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, paddingLeft: 38 }}>
          <Pressable
            onPress={() => void openLegalUrl(CAPDENT_TERMS_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open CapDent Terms of Service"
          >
            <Text style={{ color: colors.primary, fontWeight: "900" }}>Terms of Service</Text>
          </Pressable>

          <Pressable
            onPress={() => void openLegalUrl(CAPDENT_PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open CapDent Privacy Policy"
          >
            <Text style={{ color: colors.primary, fontWeight: "900" }}>Privacy Policy</Text>
          </Pressable>
        </View>
      </SectionCard>

      <AppButton
        title="Agree & Continue"
        icon="checkmark-circle-outline"
        onPress={continueToCapDent}
        loading={saving}
        disabled={!accepted || saving}
      />

      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
        Terms version {CAPDENT_TERMS_VERSION} • Privacy version {CAPDENT_PRIVACY_VERSION}
      </Text>
    </Screen>
  );
}
