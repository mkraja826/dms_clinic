import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { ClinicPreferencesFields } from "@/components/ClinicPreferencesFields";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  cleanCurrencyCode,
  getDefaultClinicPreferences,
  normalizeClinicTime,
} from "@/lib/clinicLocale";
import { createOwnerClinicWithPreferences } from "@/lib/clinicSetup";
import { CAPDENT_PRIVACY_URL, CAPDENT_TERMS_URL } from "@/lib/legalLinks";
import { recordCapDentLegalConsent } from "@/lib/pricingV25";
import { acceptStaffInviteByCode } from "@/lib/supabase";

type AccountType = "clinic" | "employee" | null;

const CAPDENT_TERMS_VERSION = "2026-08-14";
const CAPDENT_PRIVACY_VERSION = "2026-08-14";

function currentAppVersion() {
  return Constants.expoConfig?.version || "unknown";
}

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";

  if (error instanceof Error) return error.message;

  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const err = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };

    const parts = [
      err.message,
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ].filter(Boolean);

    if (parts.length) return parts.join("\n");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function openLegalUrl(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Unable to open link", "Please try again later.");
  });
}

export default function OnboardingScreen() {
  const { refreshProfile, session, signOut } = useAuth();
  const email = session?.user.email ?? "";

  const [accountType, setAccountType] = useState<AccountType>(null);
  const [inviteCode, setInviteCode] = useState("");

  const [clinicName, setClinicName] = useState("");
  const [ownerName, setOwnerName] = useState(
    session?.user.user_metadata?.full_name ?? ""
  );
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [preferences, setPreferences] = useState(() =>
    getDefaultClinicPreferences()
  );
  const [legalAccepted, setLegalAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const ownerCreateLockRef = useRef(false);
  const inviteJoinLockRef = useRef(false);
  const logoutLockRef = useRef(false);

  async function recordLegalAcceptance() {
    return recordCapDentLegalConsent({
      termsVersion: CAPDENT_TERMS_VERSION,
      privacyVersion: CAPDENT_PRIVACY_VERSION,
      appVersion: currentAppVersion(),
      platform: "android",
    });
  }

  async function attachConsentToCurrentClinicBestEffort() {
    try {
      await recordLegalAcceptance();
    } catch (error) {
      console.warn("Legal consent was recorded but could not be linked to the refreshed clinic profile:", error);
    }
  }

  async function finishOwnerSetup() {
    if (ownerCreateLockRef.current) return;

    if (!clinicName.trim() || !ownerName.trim()) {
      Alert.alert("Missing details", "Clinic name and head doctor name are required.");
      return;
    }

    if (!legalAccepted) {
      Alert.alert(
        "Agreement required",
        "Please read and agree to the CapDent Terms of Service and Privacy Policy before creating the clinic."
      );
      return;
    }

    const currencyCode = cleanCurrencyCode(
      preferences.currencyCode,
      preferences.countryCode
    );

    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      Alert.alert("Invalid currency", "Choose a valid three-letter clinic currency.");
      return;
    }

    ownerCreateLockRef.current = true;
    setLoading(true);

    try {
      // Record acceptance before clinic creation so an RPC/network failure cannot
      // leave a newly created clinic without auditable legal evidence.
      await recordLegalAcceptance();

      await createOwnerClinicWithPreferences({
        clinicName: clinicName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim() || undefined,
        email: email || undefined,
        address: address.trim() || undefined,
        preferences: {
          ...preferences,
          currencyCode,
          openingTime: normalizeClinicTime(preferences.openingTime, "09:00"),
          closingTime: normalizeClinicTime(preferences.closingTime, "21:00"),
        },
      });

      await refreshProfile();
      await attachConsentToCurrentClinicBestEffort();

      Alert.alert(
        "Clinic created",
        "Your clinic workspace is ready with its country, currency, and usual clinic hours.",
        [
          {
            text: "Open Dashboard",
            onPress: () => router.replace("/" as never),
          },
        ]
      );
    } catch (error) {
      Alert.alert("Clinic setup failed", getErrorMessage(error));
    } finally {
      ownerCreateLockRef.current = false;
      setLoading(false);
    }
  }

  async function joinInvite() {
    if (inviteJoinLockRef.current) return;

    if (!inviteCode.trim()) {
      Alert.alert("Invite code required", "Enter the clinic invite code.");
      return;
    }

    if (!legalAccepted) {
      Alert.alert(
        "Agreement required",
        "Please read and agree to the CapDent Terms of Service and Privacy Policy before joining the clinic."
      );
      return;
    }

    inviteJoinLockRef.current = true;
    setLoading(true);

    try {
      await recordLegalAcceptance();
      await acceptStaffInviteByCode(inviteCode.trim());
      await refreshProfile();
      await attachConsentToCurrentClinicBestEffort();
      router.replace("/" as never);
    } catch (error) {
      Alert.alert("Join failed", getErrorMessage(error));
    } finally {
      inviteJoinLockRef.current = false;
      setLoading(false);
    }
  }

  async function logout() {
    if (logoutLockRef.current) return;

    logoutLockRef.current = true;
    try {
      await signOut();
    } catch (error) {
      Alert.alert("Logout failed", getErrorMessage(error));
    } finally {
      logoutLockRef.current = false;
    }
  }

  function AccountChoice({
    type,
    title,
    subtitle,
    icon,
  }: {
    type: Exclude<AccountType, null>;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
  }) {
    const selected = accountType === type;

    return (
      <Pressable
        onPress={() => setAccountType(type)}
        style={{
          borderRadius: 22,
          borderWidth: 1,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 18,
            backgroundColor: colors.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={24} color={colors.primary} />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
            {title}
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>{subtitle}</Text>
        </View>

        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={24}
          color={selected ? colors.primary : colors.muted}
        />
      </Pressable>
    );
  }

  function LegalAgreement() {
    return (
      <View style={{ gap: 8, paddingTop: 4 }}>
        <Pressable
          onPress={() => setLegalAccepted((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: legalAccepted }}
          accessibilityLabel="Agree to CapDent Terms of Service and Privacy Policy"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
            paddingVertical: 8,
          }}
        >
          <Ionicons
            name={legalAccepted ? "checkbox" : "square-outline"}
            size={24}
            color={legalAccepted ? colors.primary : colors.muted}
          />

          <Text style={{ flex: 1, color: colors.text, lineHeight: 21 }}>
            I have read and agree to the CapDent Terms of Service and Privacy Policy.
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingLeft: 34 }}>
          <Pressable
            onPress={() => openLegalUrl(CAPDENT_TERMS_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open CapDent Terms of Service"
          >
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Terms of Service</Text>
          </Pressable>

          <Pressable
            onPress={() => openLegalUrl(CAPDENT_PRIVACY_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open CapDent Privacy Policy"
          >
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Privacy Policy</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <SectionCard title="Choose account type" subtitle="Select the correct path for this email account.">
        <Text selectable style={{ color: colors.muted, lineHeight: 21 }}>
          Signed in as {email || "this account"}
        </Text>

        <AccountChoice
          type="clinic"
          title="Clinic / Owner"
          icon="business-outline"
          subtitle="Start a new single-owner clinic workspace with free core management."
        />

        <AccountChoice
          type="employee"
          title="Employee / Staff"
          icon="people-outline"
          subtitle="Join an existing clinic using the invite code shared by the owner."
        />
      </SectionCard>

      {accountType === "clinic" ? (
        <SectionCard title="Create Clinic Profile" subtitle="For the clinic owner or head doctor starting the workspace.">
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            CapDent is built to help small clinics begin professionally without costly software. Upgrade when the clinic grows beyond the starting setup.
          </Text>

          <AppInput
            label="Clinic / Hospital Name"
            value={clinicName}
            onChangeText={setClinicName}
            placeholder="Example: Raja Dental Care"
          />

          <AppInput
            label="Owner / Head Doctor Name"
            value={ownerName}
            onChangeText={setOwnerName}
            placeholder="Doctor name"
          />

          <AppInput
            label="Clinic Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="Optional"
          />

          <AppInput
            label="Clinic Address"
            value={address}
            onChangeText={setAddress}
            multiline
            placeholder="Optional"
          />

          <View style={{ gap: 6, paddingTop: 4 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>
              Clinic Preferences
            </Text>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              Country and currency are suggested from this phone. Confirm the clinic's usual opening and closing time.
            </Text>
          </View>

          <ClinicPreferencesFields
            value={preferences}
            onChange={setPreferences}
          />

          <LegalAgreement />

          <AppButton
            title="Create Clinic Workspace"
            icon="medkit-outline"
            onPress={finishOwnerSetup}
            loading={loading}
          />
        </SectionCard>
      ) : null}

      {accountType === "employee" ? (
        <SectionCard title="Join Existing Clinic" subtitle="Employees cannot create a clinic. Use an invite code from the owner.">
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            Working doctors and receptionists should join the clinic workspace with a staff invite code. Dental Assistant access will appear only after the clinic role is enabled by CapDent.
          </Text>

          <AppInput
            label="Invite Code"
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Enter staff invite code"
          />

          <LegalAgreement />

          <AppButton
            title="Join With Staff Invite Code"
            variant="secondary"
            onPress={joinInvite}
            loading={loading}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Wrong account?" subtitle="Logout and sign in with the correct owner or staff email.">
        <AppButton
          title="Logout"
          icon="log-out-outline"
          variant="ghost"
          onPress={logout}
        />
      </SectionCard>
    </ScrollView>
  );
}
