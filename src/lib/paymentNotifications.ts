import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getClinicFeatureSettings } from "@/lib/clinicOptions";
import {
  isPaymentPushEnabledForClinic,
  PAYMENT_PUSH_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";
import { getCurrentProfile, Profile, supabase } from "@/lib/supabase";

const INSTALL_ID_KEY = "capdent:payment-push:install-id:v1";
export const PAYMENT_NOTIFICATION_CHANNEL_ID = "payments_coin_drop_v1";
export const PAYMENT_NOTIFICATION_SOUND = "coin_drop.wav";

export type PaymentPushRegistrationResult =
  | { status: "registered"; token: string }
  | {
      status:
        | "disabled"
        | "ineligible-role"
        | "simulator"
        | "expo-go"
        | "permission-denied"
        | "missing-project-id"
        | "unavailable";
      reason?: string;
    };

export type PaymentPushHealth = {
  globallyEnabled: boolean;
  clinicEnabled: boolean;
  eligibleRole: boolean;
  physicalDevice: boolean;
  expoGo: boolean;
  permissionGranted: boolean;
  projectIdConfigured: boolean;
  ready: boolean;
  status:
    | "ready"
    | "disabled"
    | "ineligible-role"
    | "simulator"
    | "expo-go"
    | "permission-denied"
    | "missing-project-id"
    | "unavailable";
  reason?: string;
};

function normalizedRole(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isEligibleRecipient(profile: Profile | null | undefined) {
  const role = normalizedRole(profile?.role);
  return role === "owner" || role === "head_doctor";
}

function createInstallId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `capdent-${Date.now().toString(36)}-${random}`;
}

async function getInstallId() {
  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (existing) return existing;

  const created = createInstallId();
  await AsyncStorage.setItem(INSTALL_ID_KEY, created);
  return created;
}

export async function getCurrentPaymentPushInstallId() {
  return AsyncStorage.getItem(INSTALL_ID_KEY);
}

function getEasProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(
    PAYMENT_NOTIFICATION_CHANNEL_ID,
    {
      name: "Payment updates",
      description: "Clinic payment confirmations for authorized owners.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: "#0F766E",
      sound: PAYMENT_NOTIFICATION_SOUND,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PRIVATE,
    }
  );
}

async function requestNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Read-only V28 health check. This never requests notification permission and
 * never creates or updates a push token. It is safe to call from owner status
 * screens to explain why payment push is or is not ready on this device.
 */
export async function getPaymentPushHealth(
  suppliedProfile?: Profile | null
): Promise<PaymentPushHealth> {
  const base = {
    globallyEnabled: PAYMENT_PUSH_GLOBALLY_ENABLED,
    clinicEnabled: false,
    eligibleRole: false,
    physicalDevice: Device.isDevice,
    expoGo: isExpoGo(),
    permissionGranted: false,
    projectIdConfigured: Boolean(getEasProjectId()),
  };

  try {
    const profile = suppliedProfile ?? (await getCurrentProfile());
    const eligibleRole = isEligibleRecipient(profile);
    const clinicSettings = profile?.clinic_id
      ? await getClinicFeatureSettings()
      : null;
    const clinicEnabled = Boolean(clinicSettings?.payment_push_enabled);
    const permission = await Notifications.getPermissionsAsync();
    const permissionGranted = permission.granted;

    const snapshot = {
      ...base,
      clinicEnabled,
      eligibleRole,
      permissionGranted,
    };

    if (!snapshot.globallyEnabled || !snapshot.clinicEnabled) {
      return {
        ...snapshot,
        ready: false,
        status: "disabled",
        reason: !snapshot.globallyEnabled
          ? "Payment notifications are disabled in this build."
          : "Payment notifications are disabled in clinic settings.",
      };
    }

    if (!snapshot.eligibleRole) {
      return {
        ...snapshot,
        ready: false,
        status: "ineligible-role",
        reason: "Payment notifications are available to the owner or head doctor.",
      };
    }

    if (!snapshot.physicalDevice) {
      return {
        ...snapshot,
        ready: false,
        status: "simulator",
        reason: "Push notifications require a physical device.",
      };
    }

    if (snapshot.expoGo) {
      return {
        ...snapshot,
        ready: false,
        status: "expo-go",
        reason: "Remote Android push requires a development or release build.",
      };
    }

    if (!snapshot.permissionGranted) {
      return {
        ...snapshot,
        ready: false,
        status: "permission-denied",
        reason: "Notification permission has not been granted on this device.",
      };
    }

    if (!snapshot.projectIdConfigured) {
      return {
        ...snapshot,
        ready: false,
        status: "missing-project-id",
        reason: "The EAS project identifier is missing from this build.",
      };
    }

    return {
      ...snapshot,
      ready: true,
      status: "ready",
    };
  } catch (error) {
    return {
      ...base,
      ready: false,
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Push health is unavailable.",
    };
  }
}

export async function registerPaymentPushToken(
  suppliedProfile?: Profile | null
): Promise<PaymentPushRegistrationResult> {
  if (!PAYMENT_PUSH_GLOBALLY_ENABLED) return { status: "disabled" };

  const profile = suppliedProfile ?? (await getCurrentProfile());
  if (!profile?.clinic_id || !isEligibleRecipient(profile)) {
    return { status: "ineligible-role" };
  }

  const clinicSettings = await getClinicFeatureSettings();
  if (!isPaymentPushEnabledForClinic(clinicSettings.payment_push_enabled)) {
    return { status: "disabled" };
  }

  if (!Device.isDevice) return { status: "simulator" };
  if (isExpoGo()) {
    return {
      status: "expo-go",
      reason: "Remote Android push requires a development or release build.",
    };
  }

  try {
    // Android 13 does not surface the permission prompt until a channel exists.
    await ensureAndroidNotificationChannel();

    if (!(await requestNotificationPermission())) {
      return { status: "permission-denied" };
    }

    const projectId = getEasProjectId();
    if (!projectId) return { status: "missing-project-id" };

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const installId = await getInstallId();
    const now = new Date().toISOString();
    const platform = Platform.OS === "ios" ? "ios" : "android";

    const { error } = await supabase.from("device_push_tokens").upsert(
      {
        user_id: profile.id,
        clinic_id: profile.clinic_id,
        install_id: installId,
        expo_push_token: token.data,
        platform,
        device_name: Device.deviceName ?? null,
        app_version: Constants.expoConfig?.version ?? null,
        active: true,
        disabled_at: null,
        last_error: null,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,install_id" }
    );

    if (error) throw error;
    return { status: "registered", token: token.data };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Push registration unavailable.";
    console.warn("Payment push registration skipped:", reason);
    return { status: "unavailable", reason };
  }
}

/**
 * Best-effort logout cleanup. Call this while the Supabase session still
 * exists so RLS can deactivate only the current user's installation.
 */
export async function deactivateCurrentDevicePushToken(userId?: string | null) {
  try {
    const installId = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (!installId) return;

    const currentUserId =
      userId ?? (await supabase.auth.getUser()).data.user?.id ?? null;
    if (!currentUserId) return;

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("device_push_tokens")
      .update({
        active: false,
        disabled_at: now,
        updated_at: now,
      })
      .eq("user_id", currentUserId)
      .eq("install_id", installId);

    if (error) throw error;
  } catch (error) {
    console.warn(
      "Payment push token deactivation skipped:",
      error instanceof Error ? error.message : error
    );
  }
}

export function isSafePaymentNotificationData(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return (
    record.type === "payment_received" &&
    record.route === "/reports/payments"
  );
}
