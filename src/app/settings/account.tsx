import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { ClinicPreferencesFields } from "@/components/ClinicPreferencesFields";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  PAYMENT_PUSH_GLOBALLY_ENABLED,
  TOOTH_CHART_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";
import {
  canManageClinicFeatureSettings,
  cleanClinicOpFee,
  ClinicFeatureSettings,
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  formatClinicMoney,
  formatClinicTime,
  getCountryCurrencyOption,
  getDefaultClinicPreferences,
} from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import { updateClinicAccountSettings } from "@/lib/clinicAccountSettings";
import { getDashboardPath } from "@/lib/supabase";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return fallback;
}

export default function AccountSettingsScreen() {
  const { profile, signOut } = useAuth();
  const [settings, setSettings] = useState<ClinicFeatureSettings>(
    DEFAULT_CLINIC_FEATURE_SETTINGS
  );
  const [preferences, setPreferences] = useState(() =>
    getDefaultClinicPreferences()
  );
  const [opFeeAmount, setOpFeeAmount] = useState(
    String(DEFAULT_CLINIC_FEATURE_SETTINGS.op_fee_amount)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const saveMutation = useImmediateMutationLock();
  const logoutMutation = useImmediateMutationLock();

  const canManage = canManageClinicFeatureSettings(profile);
  const homePath = getDashboardPath(profile?.role ?? "receptionist");
  const selectedCountry = getCountryCurrencyOption(preferences.countryCode);

  async function load() {
    try {
      setLoading(true);
      const [featureData, preferenceData] = await Promise.all([
        getClinicFeatureSettings({ force: true }),
        getClinicPreferences({ force: true }),
      ]);
      setSettings(featureData);
      setPreferences(preferenceData);
      setOpFeeAmount(String(featureData.op_fee_amount));
    } catch (error) {
      Alert.alert(
        "Settings load failed",
        error instanceof Error
          ? error.message
          : "Refresh Account Settings and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [profile?.clinic_id]);

  function setFeature(key: keyof ClinicFeatureSettings, value: boolean) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving || !saveMutation.tryLock()) return;

    const enteredOpFee = toNumber(opFeeAmount);

    if (enteredOpFee <= 0) {
      saveMutation.release();
      Alert.alert("Invalid OP fee", "OP fee must be greater than zero.");
      return;
    }

    const cleanedOpFee = cleanClinicOpFee(enteredOpFee);

    if (!/^[A-Z]{3}$/.test(preferences.currencyCode.trim().toUpperCase())) {
      saveMutation.release();
      Alert.alert("Invalid currency", "Enter a valid three-letter currency code.");
      return;
    }

    try {
      setSaving(true);
      const saved = await updateClinicAccountSettings({
        settings: {
          ...settings,
          op_fee_amount: cleanedOpFee,
        },
        preferences,
      });

      setSettings(saved.settings);
      setPreferences(saved.preferences);
      setOpFeeAmount(String(saved.settings.op_fee_amount));
      Alert.alert(
        "Settings saved",
        "Clinic currency, usual hours, OP fee, and optional features were updated together."
      );
    } catch (error) {
      Alert.alert(
        "Save could not be confirmed",
        `${getErrorMessage(
          error,
          "The clinic settings update could not be confirmed."
        )}\n\nRefresh Account Settings before trying again.`
      );
    } finally {
      saveMutation.release();
      setSaving(false);
    }
  }

  async function logout() {
    if (loggingOut || !logoutMutation.tryLock()) return;

    try {
      setLoggingOut(true);
      await signOut();
    } catch (error) {
      Alert.alert(
        "Logout failed",
        error instanceof Error ? error.message : "Please try again."
      );
      logoutMutation.release();
      setLoggingOut(false);
    }
  }

  if (!canManage) {
    return (
      <Screen>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
            Account Settings
          </Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
            Clinic account settings are controlled by the clinic owner only.
          </Text>
        </View>

        <SectionCard>
          <EmptyState
            title="Owner access only"
            message="Ask the clinic owner or head doctor to change clinic currency, usual hours, OP fee, patient photos, or prescribed tablets settings."
            icon="lock-closed-outline"
          />
        </SectionCard>

        <View style={{ gap: 12 }}>
          <AppButton
            title="Back to Dashboard"
            icon="arrow-back-outline"
            variant="ghost"
            onPress={() => router.replace(homePath as never)}
          />

          <AppButton
            title="Logout"
            icon="log-out-outline"
            variant="danger"
            onPress={logout}
            loading={loggingOut}
            loadingTitle="Logging out..."
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Account Settings
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Clinic owner can manage the clinic's country, currency, usual hours,
          OP fee, and optional modules.
        </Text>
      </View>

      <SectionCard
        title="Clinic Country, Currency & Hours"
        subtitle="Currency is used for clinic amounts. Hours are guidance only and never block emergency work."
      >
        <ClinicPreferencesFields
          value={preferences}
          onChange={setPreferences}
        />
      </SectionCard>

      <SectionCard
        title="Clinic OP Fee"
        subtitle="This becomes the default amount for quick check-in and OP fee collection."
      >
        <View
          style={{
            padding: 16,
            borderRadius: 24,
            backgroundColor: colors.successSoft,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 6,
          }}
        >
          <Text style={{ color: colors.muted, fontWeight: "800" }}>
            Current OP Fee
          </Text>
          <Text style={{ color: colors.text, fontSize: 42, fontWeight: "900" }}>
            {formatClinicMoney(opFeeAmount, preferences.currencyCode)}
          </Text>
          <Text style={{ color: colors.success, fontWeight: "900" }}>
            Used by reception desk
          </Text>
        </View>

        <AppInput
          label="OP Fee Amount"
          value={opFeeAmount}
          onChangeText={setOpFeeAmount}
          keyboardType="numeric"
          placeholder="300"
          helper="Reception can still edit this amount for an individual patient when needed."
        />
      </SectionCard>

      <SectionCard
        title="Optional Clinic Features"
        subtitle="Keep these off unless the clinic really wants to use them."
      >
        <FeatureSwitch
          title="Patient profile photos"
          subtitle="When on, receptionist can upload a patient photo and reception dashboard will show it."
          value={settings.enable_patient_photos}
          onValueChange={(value) => setFeature("enable_patient_photos", value)}
        />

        <FeatureSwitch
          title="Prescribed tablets section"
          subtitle="When on, receptionist can enter tablets prescribed to a patient and reuse repeated medicine names. Medication fee collection is not changed."
          value={settings.enable_prescription_medications}
          onValueChange={(value) =>
            setFeature("enable_prescription_medications", value)
          }
        />

        {PAYMENT_PUSH_GLOBALLY_ENABLED ? (
          <FeatureSwitch
            title="Owner payment notifications"
            subtitle="Notify eligible owner devices after a clinic payment is saved. The payment never waits for notification delivery."
            value={settings.payment_push_enabled}
            onValueChange={(value) =>
              setFeature("payment_push_enabled", value)
            }
          />
        ) : null}

        {TOOTH_CHART_GLOBALLY_ENABLED ? (
          <FeatureSwitch
            title="Interactive dental chart"
            subtitle="Allow dentists to record structured FDI tooth findings during visits."
            value={settings.tooth_chart_enabled}
            onValueChange={(value) =>
              setFeature("tooth_chart_enabled", value)
            }
          />
        ) : null}

        <AppButton
          title="Save Clinic Settings"
          icon="save-outline"
          onPress={save}
          loading={saving || loading}
        />
      </SectionCard>

      <SectionCard title="Current Behavior">
        <Text style={{ color: colors.muted, lineHeight: 21 }}>
          Country: {selectedCountry.countryName}
          {"\n"}
          Currency: {preferences.currencyCode}
          {"\n"}
          Usual hours: {formatClinicTime(preferences.openingTime)} to{" "}
          {formatClinicTime(preferences.closingTime)}
          {"\n"}
          OP fee default:{" "}
          {formatClinicMoney(settings.op_fee_amount, preferences.currencyCode)}
          {"\n"}
          Patient photos: {settings.enable_patient_photos ? "ON" : "OFF"}
          {"\n"}
          Prescribed tablets section:{" "}
          {settings.enable_prescription_medications ? "ON" : "OFF"}
          {"\n"}
          Emergency and outside-hours work: always allowed
        </Text>
      </SectionCard>

      <View style={{ gap: 12 }}>
        <AppButton
          title="Back to Dashboard"
          icon="arrow-back-outline"
          variant="ghost"
          onPress={() => router.replace(homePath as never)}
        />

        <AppButton
          title="Logout"
          icon="log-out-outline"
          variant="danger"
          onPress={logout}
          loading={loggingOut}
          loadingTitle="Logging out..."
        />
      </View>
    </Screen>
  );
}

function FeatureSwitch({
  title,
  subtitle,
  value,
  onValueChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
          {title}
        </Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>{subtitle}</Text>
      </View>

      <Switch
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ checked: value }}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.primarySoft, false: colors.border }}
        thumbColor={value ? colors.primary : "#FFFFFF"}
      />
    </View>
  );
}
