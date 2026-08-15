import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  canManageClinicFeatureSettings,
  ClinicFeatureSettings,
  DEFAULT_CLINIC_FEATURE_SETTINGS,
  getClinicFeatureSettings,
  invalidateClinicFeatureSettingsCache,
  updateClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  PAYMENT_PUSH_GLOBALLY_ENABLED,
  TOOTH_CHART_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";

function ToggleRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
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
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>{subtitle}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}

export default function ClinicFeatureSettingsScreen() {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<ClinicFeatureSettings | null>(null);
  const [draft, setDraft] = useState<ClinicFeatureSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = canManageClinicFeatureSettings(profile);
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(draft);

  async function load() {
    let active = true;
    try {
      setLoading(true);
      invalidateClinicFeatureSettingsCache();
      const current = await getClinicFeatureSettings({ force: true });
      if (!active) return;
      setSettings(current);
      setDraft(current);
    } catch (error) {
      Alert.alert(
        "Clinic settings failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      if (active) setLoading(false);
    }

    return () => {
      active = false;
    };
  }

  useEffect(() => {
    void load();
  }, [profile?.clinic_id]);

  function updateDraft(key: keyof ClinicFeatureSettings, value: boolean | number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            [key]: value,
          }
        : current
    );
  }

  async function save() {
    if (!draft || !canManage || saving) return;

    try {
      setSaving(true);
      const saved = await updateClinicFeatureSettings(draft);
      setSettings(saved);
      setDraft(saved);
      Alert.alert("Clinic settings saved", "V25 feature settings were updated for this clinic.");
    } catch (error) {
      Alert.alert(
        "Save failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <Screen>
        <EmptyState
          title="Clinic settings restricted"
          message="Only clinic owner or head doctor can change clinic feature settings."
          icon="lock-closed-outline"
        />
      </Screen>
    );
  }

  const current = draft ?? DEFAULT_CLINIC_FEATURE_SETTINGS;

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Clinic Feature Settings
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
          Enable V25 modules for this clinic while testing. These switches affect the current clinic only.
        </Text>
      </View>

      <SectionCard title="Build Flags" subtitle="Global feature switches compiled into this app build.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <StatusBadge
            label={`Dental Chart: ${TOOTH_CHART_GLOBALLY_ENABLED ? "ON" : "OFF"}`}
            tone={TOOTH_CHART_GLOBALLY_ENABLED ? "success" : "warning"}
          />
          <StatusBadge
            label={`Payment Push: ${PAYMENT_PUSH_GLOBALLY_ENABLED ? "ON" : "OFF"}`}
            tone={PAYMENT_PUSH_GLOBALLY_ENABLED ? "success" : "warning"}
          />
        </View>
        <Text style={{ color: colors.muted, lineHeight: 20 }}>
          If a global flag is OFF, turn it ON in .env and restart Expo with -c before testing that module.
        </Text>
      </SectionCard>

      <SectionCard title="Clinic Features" subtitle="Turn on modules for the currently logged-in clinic.">
        <ToggleRow
          title="Dental chart"
          subtitle={
            TOOTH_CHART_GLOBALLY_ENABLED
              ? "Shows the dental chart section on patient profile and enables tooth-chart workflow."
              : "Disabled by build flag. Set EXPO_PUBLIC_ENABLE_TOOTH_CHART=true."
          }
          value={current.tooth_chart_enabled}
          disabled={saving || loading || !TOOTH_CHART_GLOBALLY_ENABLED}
          onValueChange={(value) => updateDraft("tooth_chart_enabled", value)}
        />

        <ToggleRow
          title="Payment push notifications"
          subtitle={
            PAYMENT_PUSH_GLOBALLY_ENABLED
              ? "Allows payment notifications for owner/head doctor when receptionist records payments."
              : "Disabled by build flag. Set EXPO_PUBLIC_ENABLE_PAYMENT_PUSH=true."
          }
          value={current.payment_push_enabled}
          disabled={saving || loading || !PAYMENT_PUSH_GLOBALLY_ENABLED}
          onValueChange={(value) => updateDraft("payment_push_enabled", value)}
        />

        <ToggleRow
          title="Patient photos"
          subtitle="Enables before/after clinical photo workflows for this clinic."
          value={current.enable_patient_photos}
          disabled={saving || loading}
          onValueChange={(value) => updateDraft("enable_patient_photos", value)}
        />

        <ToggleRow
          title="Prescription medications"
          subtitle="Enables prescription medication helper options where available."
          value={current.enable_prescription_medications}
          disabled={saving || loading}
          onValueChange={(value) => updateDraft("enable_prescription_medications", value)}
        />
      </SectionCard>

      <SectionCard title="Current Clinic" subtitle="Use this screen only on a test clinic while validating V25.">
        <View style={{ gap: 8 }}>
          <Text selectable style={{ color: colors.text, fontWeight: "900" }}>
            {profile?.name ?? "Clinic user"}
          </Text>
          <Text selectable style={{ color: colors.muted }}>Role: {profile?.role}</Text>
          <Text selectable style={{ color: colors.muted }}>Clinic ID: {profile?.clinic_id}</Text>
        </View>
      </SectionCard>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="Reload"
          icon="refresh-outline"
          variant="secondary"
          onPress={load}
          loading={loading}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Save Settings"
          icon="save-outline"
          onPress={save}
          loading={saving}
          disabled={!hasChanges || loading || saving}
          style={{ flex: 1 }}
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
        <Text style={{ flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          After saving, reopen the patient profile or pull-to-refresh it so cached clinic settings reload.
        </Text>
      </View>
    </Screen>
  );
}
