import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  getPaymentPushHealth,
  registerPaymentPushToken,
  type PaymentPushHealth,
} from "@/lib/paymentNotifications";
import {
  getCapDentEntitlementsV25,
  type CapDentEntitlementsV25,
} from "@/lib/pricingV25";
import { formatStorageBytes } from "@/lib/v25Limits";

function percent(value: number, limit: number | null) {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / limit) * 100)));
}

function limitText(value: number | null, suffix = "") {
  return value === null ? "Unlimited" : `${value.toLocaleString("en-IN")}${suffix}`;
}

function usageTone(value: number, limit: number | null, warningAt?: number | null) {
  if (limit !== null && value >= limit) return colors.danger;
  if (warningAt !== null && warningAt !== undefined && value >= warningAt) return colors.warning;
  return colors.primary;
}

function UsageMeter({
  label,
  value,
  limit,
  displayValue,
  displayLimit,
  warningAt,
}: {
  label: string;
  value: number;
  limit: number | null;
  displayValue?: string;
  displayLimit?: string;
  warningAt?: number | null;
}) {
  const progress = percent(value, limit);
  const tone = usageTone(value, limit, warningAt);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }}>{label}</Text>
        <Text style={{ color: colors.muted, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
          {displayValue ?? value.toLocaleString("en-IN")} / {displayLimit ?? limitText(limit)}
        </Text>
      </View>
      <View style={{ height: 9, borderRadius: 999, backgroundColor: colors.surfaceSoft, overflow: "hidden" }}>
        <View
          style={{
            width: limit === null ? "10%" : `${progress}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: tone,
          }}
        />
      </View>
    </View>
  );
}

function HealthRow({
  icon,
  title,
  detail,
  status,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  status: string;
  tone: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
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
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{detail}</Text>
      </View>
      <StatusBadge label={status} tone={tone} />
    </View>
  );
}

export default function ClinicHealthScreen() {
  const { profile } = useAuth();
  const [entitlements, setEntitlements] = useState<CapDentEntitlementsV25 | null>(null);
  const [pushHealth, setPushHealth] = useState<PaymentPushHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairingPush, setRepairingPush] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const [nextEntitlements, nextPushHealth] = await Promise.all([
        getCapDentEntitlementsV25(),
        getPaymentPushHealth(profile),
      ]);
      setEntitlements(nextEntitlements);
      setPushHealth(nextPushHealth);
    } catch (error) {
      Alert.alert(
        "Clinic health unavailable",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [profile?.id, profile?.clinic_id]);

  async function repairPush() {
    try {
      setRepairingPush(true);
      const result = await registerPaymentPushToken(profile);
      if (result.status === "registered") {
        Alert.alert("Payment notifications ready", "This device is registered for eligible clinic payment updates.");
      } else {
        Alert.alert(
          "Payment notifications not ready",
          result.reason || result.status.replaceAll("-", " ")
        );
      }
      await load();
    } catch (error) {
      Alert.alert(
        "Notification setup failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setRepairingPush(false);
    }
  }

  const planTone = entitlements?.plan === "free" ? "primary" : "success";
  const pushTone = pushHealth?.ready
    ? "success"
    : pushHealth?.status === "permission-denied"
    ? "warning"
    : "danger";

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
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
          <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>Clinic Health</Text>
          <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>
            V28 owner readiness for plan usage, storage, billing access, and payment notifications.
          </Text>
        </View>
      </View>

      <SectionCard
        title="Plan & quota health"
        subtitle="Usage is read from the server entitlement snapshot. The database remains authoritative for enforcement."
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
              {entitlements?.planLabel || "Loading plan…"}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 3 }}>
              Status: {entitlements?.subscriptionStatus || "checking"}
            </Text>
          </View>
          <StatusBadge label={entitlements?.planLabel || "Checking"} tone={planTone} />
        </View>

        {entitlements ? (
          <View style={{ gap: 16 }}>
            <UsageMeter
              label="Patients"
              value={entitlements.patientCount}
              limit={entitlements.patientLimit}
            />
            <UsageMeter
              label="Uploads"
              value={entitlements.uploadCount}
              limit={entitlements.uploadLimit}
              warningAt={entitlements.plan === "free" ? 120 : null}
            />
            <UsageMeter
              label="Storage"
              value={entitlements.storageUsedBytes}
              limit={entitlements.storageLimitBytes}
              displayValue={formatStorageBytes(entitlements.storageUsedBytes)}
              displayLimit={formatStorageBytes(entitlements.storageLimitBytes)}
            />
            {entitlements.grandfathered ? (
              <Text style={{ color: colors.warning, fontSize: 12, lineHeight: 18, fontWeight: "700" }}>
                This clinic currently has grandfathered quota protection. Server rollout rules remain authoritative.
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: colors.muted }}>Checking clinic entitlement usage…</Text>
        )}

        <AppButton
          title="View Plans & Billing"
          icon="card-outline"
          variant="secondary"
          onPress={() => router.push("/settings/subscription" as never)}
        />
      </SectionCard>

      <SectionCard
        title="Payment notification health"
        subtitle="This check does not request permission or modify tokens until you choose Repair / Register."
      >
        <HealthRow
          icon="notifications-outline"
          title="Owner payment push"
          detail={pushHealth?.reason || (pushHealth?.ready ? "Build, clinic setting, device, permission, and EAS project are ready." : "Checking notification readiness…")}
          status={pushHealth?.ready ? "Ready" : pushHealth?.status?.replaceAll("-", " ") || "Checking"}
          tone={pushHealth ? pushTone : "primary"}
        />
        <AppButton
          title="Repair / Register Notifications"
          icon="refresh-outline"
          loading={repairingPush}
          loadingTitle="Checking notification setup…"
          onPress={() => void repairPush()}
        />
      </SectionCard>

      <SectionCard title="V28 owner controls" subtitle="Fast access to setup, permissions, support, and safe clinic configuration.">
        <HealthRow
          icon="shield-checkmark-outline"
          title="Legal consent"
          detail="Versioned Terms and Privacy consent remains mandatory for signed-in users."
          status="Protected"
          tone="success"
        />
        <HealthRow
          icon="lock-closed-outline"
          title="Clinical files"
          detail="Protected file flows remain on signed-storage URLs where the release flag is enabled."
          status="Private"
          tone="success"
        />
        <AppButton
          title="Open Setup Guide"
          icon="book-outline"
          variant="secondary"
          onPress={() => router.push("/settings/guide" as never)}
        />
        <AppButton
          title="Clinic Feature Settings"
          icon="options-outline"
          variant="secondary"
          onPress={() => router.push("/settings/clinic-features" as never)}
        />
        <AppButton
          title="Report an Issue / Feedback"
          icon="chatbox-ellipses-outline"
          variant="ghost"
          onPress={() => router.push("/settings/report-issue" as never)}
        />
      </SectionCard>
    </Screen>
  );
}
