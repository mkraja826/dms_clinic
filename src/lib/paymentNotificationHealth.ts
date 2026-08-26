import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { getClinicFeatureSettings } from "@/lib/clinicOptions";
import { PAYMENT_PUSH_GLOBALLY_ENABLED } from "@/lib/featureFlags";
import {
  getCurrentPaymentPushInstallId,
  registerPaymentPushToken,
  type PaymentPushRegistrationResult,
} from "@/lib/paymentNotifications";
import { getCurrentProfile, type Profile, supabase } from "@/lib/supabase";

export type PaymentNotificationHealthStatus = "healthy" | "attention" | "disabled";

export type PaymentPushTokenHealthRow = {
  id: string;
  active: boolean;
  platform: string;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  disabled_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

export type PaymentNotificationJobHealthRow = {
  status: string;
  attempts: number;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type PaymentNotificationDeliveryHealthRow = {
  status: string;
  attempt_count: number;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  receipt_checked_at: string | null;
  created_at: string;
};

export type PaymentNotificationHealth = {
  status: PaymentNotificationHealthStatus;
  summary: string;
  globalEnabled: boolean;
  clinicEnabled: boolean;
  eligibleRole: boolean;
  physicalDevice: boolean;
  expoGo: boolean;
  permissionGranted: boolean;
  permissionStatus: string;
  projectIdPresent: boolean;
  installIdPresent: boolean;
  tokenRecord: PaymentPushTokenHealthRow | null;
  activeDeviceCount: number;
  latestJob: PaymentNotificationJobHealthRow | null;
  latestDelivery: PaymentNotificationDeliveryHealthRow | null;
  diagnosticErrors: string[];
};

function normalizedRole(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isEligibleRecipient(profile?: Profile | null) {
  const role = normalizedRole(profile?.role);
  return role === "owner" || role === "head_doctor";
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

function attentionSummary(input: {
  physicalDevice: boolean;
  expoGo: boolean;
  permissionGranted: boolean;
  projectIdPresent: boolean;
  installIdPresent: boolean;
  tokenRecord: PaymentPushTokenHealthRow | null;
  latestJob: PaymentNotificationJobHealthRow | null;
  latestDelivery: PaymentNotificationDeliveryHealthRow | null;
  diagnosticErrors: string[];
}) {
  if (!input.physicalDevice) return "Remote notifications require a physical device.";
  if (input.expoGo) return "Remote notifications require a development or release build, not Expo Go.";
  if (!input.permissionGranted) return "Android notification permission is blocked for CapDent.";
  if (!input.projectIdPresent) return "This build is missing the EAS project identity required for Expo push.";
  if (!input.installIdPresent) return "This installation has not registered for payment notifications yet.";
  if (!input.tokenRecord) return "This installation does not have a server-side push registration yet.";
  if (!input.tokenRecord.active) {
    return input.tokenRecord.last_error
      ? `This device registration was disabled after a delivery error: ${input.tokenRecord.last_error}`
      : "This device registration is disabled and should be repaired.";
  }
  if (["invalid", "receipt_error", "retry", "ticket_error"].includes(input.latestDelivery?.status || "")) {
    return input.latestDelivery?.error_detail ||
      input.latestDelivery?.error_code ||
      "The latest payment notification delivery needs attention.";
  }
  if (["failed", "retry"].includes(input.latestJob?.status || "")) {
    return input.latestJob?.last_error || "The latest payment notification job needs retry.";
  }
  if (input.diagnosticErrors.length) {
    return "Device registration is present, but some server delivery diagnostics could not be loaded.";
  }
  return "Payment notification registration needs attention.";
}

export async function getPaymentNotificationHealth(): Promise<PaymentNotificationHealth> {
  const diagnosticErrors: string[] = [];
  const profile = await getCurrentProfile();
  const eligibleRole = isEligibleRecipient(profile);
  const physicalDevice = Device.isDevice;
  const expoGo = isExpoGo();
  const projectIdPresent = Boolean(getEasProjectId());

  const permission = await Notifications.getPermissionsAsync().catch((error) => {
    diagnosticErrors.push(
      `Permission status unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  });
  const permissionGranted = Boolean(permission?.granted);
  const permissionStatus = String(permission?.status || "unknown");

  const clinicSettings = await getClinicFeatureSettings({ force: true }).catch((error) => {
    diagnosticErrors.push(
      `Clinic notification setting unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  });
  const clinicEnabled = Boolean(clinicSettings?.payment_push_enabled);

  const installId = await getCurrentPaymentPushInstallId().catch((error) => {
    diagnosticErrors.push(
      `Installation identity unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  });

  let tokenRecord: PaymentPushTokenHealthRow | null = null;
  let activeDeviceCount = 0;
  let latestJob: PaymentNotificationJobHealthRow | null = null;
  let latestDelivery: PaymentNotificationDeliveryHealthRow | null = null;

  if (profile?.id && profile.clinic_id && eligibleRole) {
    if (installId) {
      const { data, error } = await supabase
        .from("device_push_tokens")
        .select(
          "id,active,platform,device_name,app_version,last_seen_at,disabled_at,last_error,updated_at"
        )
        .eq("user_id", profile.id)
        .eq("clinic_id", profile.clinic_id)
        .eq("install_id", installId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        diagnosticErrors.push(`Device registration unavailable: ${error.message}`);
      } else {
        tokenRecord = (data as PaymentPushTokenHealthRow | null) ?? null;
      }
    }

    const { count, error: countError } = await supabase
      .from("device_push_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("clinic_id", profile.clinic_id)
      .eq("active", true);

    if (countError) {
      diagnosticErrors.push(`Active device count unavailable: ${countError.message}`);
    } else {
      activeDeviceCount = count ?? 0;
    }

    const { data: jobData, error: jobError } = await supabase
      .from("payment_notification_jobs")
      .select("status,attempts,processed_at,last_error,created_at")
      .eq("clinic_id", profile.clinic_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (jobError) {
      diagnosticErrors.push(`Latest notification job unavailable: ${jobError.message}`);
    } else {
      latestJob = (jobData as PaymentNotificationJobHealthRow | null) ?? null;
    }

    const { data: deliveryData, error: deliveryError } = await supabase
      .from("payment_notification_deliveries")
      .select(
        "status,attempt_count,error_code,error_detail,sent_at,receipt_checked_at,created_at"
      )
      .eq("clinic_id", profile.clinic_id)
      .eq("recipient_user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (deliveryError) {
      diagnosticErrors.push(`Latest delivery status unavailable: ${deliveryError.message}`);
    } else {
      latestDelivery =
        (deliveryData as PaymentNotificationDeliveryHealthRow | null) ?? null;
    }
  }

  if (!PAYMENT_PUSH_GLOBALLY_ENABLED) {
    return {
      status: "disabled",
      summary: "Payment notifications are disabled in this CapDent build.",
      globalEnabled: false,
      clinicEnabled,
      eligibleRole,
      physicalDevice,
      expoGo,
      permissionGranted,
      permissionStatus,
      projectIdPresent,
      installIdPresent: Boolean(installId),
      tokenRecord,
      activeDeviceCount,
      latestJob,
      latestDelivery,
      diagnosticErrors,
    };
  }

  if (!eligibleRole) {
    return {
      status: "disabled",
      summary: "Payment notifications are registered only for clinic owners and head doctors.",
      globalEnabled: true,
      clinicEnabled,
      eligibleRole,
      physicalDevice,
      expoGo,
      permissionGranted,
      permissionStatus,
      projectIdPresent,
      installIdPresent: Boolean(installId),
      tokenRecord,
      activeDeviceCount,
      latestJob,
      latestDelivery,
      diagnosticErrors,
    };
  }

  if (!clinicEnabled) {
    return {
      status: "disabled",
      summary: "Payment notifications are turned off in Clinic Feature Settings.",
      globalEnabled: true,
      clinicEnabled: false,
      eligibleRole,
      physicalDevice,
      expoGo,
      permissionGranted,
      permissionStatus,
      projectIdPresent,
      installIdPresent: Boolean(installId),
      tokenRecord,
      activeDeviceCount,
      latestJob,
      latestDelivery,
      diagnosticErrors,
    };
  }

  const deliveryNeedsAttention = ["invalid", "receipt_error", "retry", "ticket_error"].includes(
    latestDelivery?.status || ""
  );
  const jobNeedsAttention = ["failed", "retry"].includes(latestJob?.status || "");
  const healthy =
    physicalDevice &&
    !expoGo &&
    permissionGranted &&
    projectIdPresent &&
    Boolean(installId) &&
    Boolean(tokenRecord?.active) &&
    !deliveryNeedsAttention &&
    !jobNeedsAttention &&
    diagnosticErrors.length === 0;

  if (healthy) {
    return {
      status: "healthy",
      summary: "This device is registered and ready for payment notifications.",
      globalEnabled: true,
      clinicEnabled: true,
      eligibleRole,
      physicalDevice,
      expoGo,
      permissionGranted,
      permissionStatus,
      projectIdPresent,
      installIdPresent: true,
      tokenRecord,
      activeDeviceCount,
      latestJob,
      latestDelivery,
      diagnosticErrors,
    };
  }

  return {
    status: "attention",
    summary: attentionSummary({
      physicalDevice,
      expoGo,
      permissionGranted,
      projectIdPresent,
      installIdPresent: Boolean(installId),
      tokenRecord,
      latestJob,
      latestDelivery,
      diagnosticErrors,
    }),
    globalEnabled: true,
    clinicEnabled: true,
    eligibleRole,
    physicalDevice,
    expoGo,
    permissionGranted,
    permissionStatus,
    projectIdPresent,
    installIdPresent: Boolean(installId),
    tokenRecord,
    activeDeviceCount,
    latestJob,
    latestDelivery,
    diagnosticErrors,
  };
}

export async function repairPaymentPushRegistration(
  profile?: Profile | null
): Promise<PaymentPushRegistrationResult> {
  return registerPaymentPushToken(profile);
}
