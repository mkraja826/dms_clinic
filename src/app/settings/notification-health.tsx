import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  getPaymentNotificationHealth,
  repairPaymentPushRegistration,
  type PaymentNotificationHealth,
  type PaymentNotificationHealthStatus,
} from "@/lib/paymentNotificationHealth";

function healthTone(status: PaymentNotificationHealthStatus) {
  if (status === "healthy") return "success" as const;
  if (status === "attention") return "warning" as const;
  return "primary" as const;
}

function healthLabel(status: PaymentNotificationHealthStatus) {
  if (status === "healthy") return "Ready";
  if (status === "attention") return "Action needed";
  return "Disabled";
}

function formatDateTime(value?: string | null) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTitle(value?: string | null) {
  if (!value) return "No activity yet";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function CheckRow({
  icon,
  title,
  detail,
  ok,
  neutral = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  ok: boolean;
  neutral?: boolean;
}) {
  const tone = neutral ? colors.primary : ok ? colors.success : colors.warning;
  const background = neutral
    ? colors.primarySoft
    : ok
      ? colors.successSoft
      : colors.warningSoft;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          backgroundColor: background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
          {title}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
          {detail}
        </Text>
      </View>
      <Ionicons
        name={neutral ? "information-circle" : ok ? "checkmark-circle" : "alert-circle"}
        size={22}
        color={tone}
      />
    </View>
  );
}

export default function NotificationHealthScreen() {
  const { profile } = useAuth();
  const [health, setHealth] = useState<PaymentNotificationHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);

  async function loadHealth() {
    try {
      setLoading(true);
      setHealth(await getPaymentNotificationHealth());
    } catch (error) {
      Alert.alert(
        "Notification health unavailable",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHealth();
  }, [profile?.clinic_id, profile?.id]);

  async function repairRegistration() {
    try {
      setRepairing(true);
      const result = await repairPaymentPushRegistration(profile);
      await loadHealth();

      if (result.status === "registered") {
        Alert.alert(
          "Registration repaired",
          "This device is registered again for verified CapDent payment notifications."
        );
        return;
      }

      if (result.status === "permission-denied") {
        Alert.alert(
          "Notification permission blocked",
          "Allow notifications for CapDent in Android settings, then return here and run Repair Registration again.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() },
          ]
        );
        return;
      }

      Alert.alert(
        "Registration not completed",
        result.reason || `Registration status: ${statusTitle(result.status)}.`
      );
    } catch (error) {
      Alert.alert(
        "Registration repair failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setRepairing(false);
    }
  }

  const tone = health ? healthTone(health.status) : "primary";
  const canRepair = Boolean(
    health?.globalEnabled && health?.clinicEnabled && health?.eligibleRole
  );
  const tokenReady = Boolean(health?.tokenRecord?.active);
  const latestDeliveryHealthy =
    !health?.latestDelivery ||
    ["ticket_ok", "delivered"].includes(health.latestDelivery.status);
  const latestJobHealthy =
    !health?.latestJob ||
    ["queued", "processing", "sent", "skipped"].includes(health.latestJob.status);

  return (
    <Screen refreshing={loading} onRefresh={loadHealth}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
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
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>
            Notification Health
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            Permission, device registration, and payment push delivery status.
          </Text>
        </View>
      </View>

      <SectionCard title="Overall Status" subtitle="Checks this device without sending a test payment.">
        <View
          style={{
            borderRadius: 22,
            padding: 16,
            gap: 10,
            backgroundColor:
              health?.status === "healthy"
                ? colors.successSoft
                : health?.status === "attention"
                  ? colors.warningSoft
                  : colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons
              name={health?.status === "healthy" ? "notifications-circle" : "notifications-outline"}
              size={28}
              color={
                health?.status === "healthy"
                  ? colors.success
                  : health?.status === "attention"
                    ? colors.warning
                    : colors.primary
              }
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
                {loading && !health ? "Checking notifications..." : health?.summary || "Status unavailable"}
              </Text>
            </View>
            {health ? <StatusBadge label={healthLabel(health.status)} tone={tone} /> : null}
          </View>
        </View>
      </SectionCard>

      {health ? (
        <SectionCard title="Device Readiness" subtitle="Everything required before a payment push can reach this device.">
          <CheckRow
            icon="options-outline"
            title="Clinic payment notifications"
            detail={health.clinicEnabled ? "Enabled in Clinic Feature Settings." : "Disabled in Clinic Feature Settings."}
            ok={health.clinicEnabled && health.globalEnabled}
          />
          <CheckRow
            icon="notifications-outline"
            title="Notification permission"
            detail={health.permissionGranted ? "Allowed by the device." : `Blocked or unavailable (${health.permissionStatus}).`}
            ok={health.permissionGranted}
          />
          <CheckRow
            icon="phone-portrait-outline"
            title="Physical app installation"
            detail={health.physicalDevice && !health.expoGo ? "Release/development build can receive remote push." : "Remote push is unavailable on this runtime."}
            ok={health.physicalDevice && !health.expoGo}
          />
          <CheckRow
            icon="cloud-done-outline"
            title="This device registration"
            detail={tokenReady ? `Registered. Last seen ${formatDateTime(health.tokenRecord?.last_seen_at)}.` : health.tokenRecord?.last_error || "No active registration for this installation."}
            ok={tokenReady}
          />
          <CheckRow
            icon="phone-portrait"
            title="Your active registered devices"
            detail={`${health.activeDeviceCount} active device${health.activeDeviceCount === 1 ? "" : "s"} for this owner account.`}
            ok={health.activeDeviceCount > 0}
            neutral={health.status === "disabled"}
          />
          {health.tokenRecord?.device_name || health.tokenRecord?.app_version ? (
            <CheckRow
              icon="information-circle-outline"
              title="Registered installation"
              detail={`${health.tokenRecord.device_name || "Device"}${health.tokenRecord.app_version ? ` • CapDent ${health.tokenRecord.app_version}` : ""}`}
              ok
              neutral
            />
          ) : null}
        </SectionCard>
      ) : null}

      {health ? (
        <SectionCard title="Delivery Health" subtitle="Latest server outbox and delivery receipt visible to this clinic owner.">
          <CheckRow
            icon="server-outline"
            title="Latest notification job"
            detail={health.latestJob ? `${statusTitle(health.latestJob.status)} • ${formatDateTime(health.latestJob.created_at)}${health.latestJob.last_error ? ` • ${health.latestJob.last_error}` : ""}` : "No payment notification job has been recorded yet."}
            ok={latestJobHealthy}
            neutral={!health.latestJob}
          />
          <CheckRow
            icon="paper-plane-outline"
            title="Latest delivery to you"
            detail={health.latestDelivery ? `${statusTitle(health.latestDelivery.status)} • ${formatDateTime(health.latestDelivery.sent_at || health.latestDelivery.created_at)}${health.latestDelivery.error_detail ? ` • ${health.latestDelivery.error_detail}` : health.latestDelivery.error_code ? ` • ${health.latestDelivery.error_code}` : ""}` : "No delivery attempt to this owner account has been recorded yet."}
            ok={latestDeliveryHealthy}
            neutral={!health.latestDelivery}
          />

          {health.diagnosticErrors.length ? (
            <View
              style={{
                borderRadius: 18,
                padding: 12,
                gap: 6,
                backgroundColor: colors.warningSoft,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Some diagnostics are unavailable
              </Text>
              {health.diagnosticErrors.map((message, index) => (
                <Text key={`${index}-${message}`} style={{ color: colors.muted, lineHeight: 19 }}>
                  {message}
                </Text>
              ))}
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Recovery" subtitle="Repair registration without changing patient or payment records.">
        <AppButton
          title="Repair Registration"
          icon="refresh-circle-outline"
          onPress={repairRegistration}
          loading={repairing}
          loadingTitle="Repairing registration..."
          disabled={!canRepair}
        />
        {health && !health.permissionGranted ? (
          <AppButton
            title="Open Notification Settings"
            icon="settings-outline"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        ) : null}
        <AppButton
          title="Clinic Feature Settings"
          icon="options-outline"
          variant="secondary"
          onPress={() => router.push("/settings/clinic-features" as never)}
        />
        <AppButton
          title="Refresh Health"
          icon="reload-outline"
          variant="ghost"
          onPress={loadHealth}
          loading={loading}
        />
      </SectionCard>
    </Screen>
  );
}
