type CapDentAnalyticsRole = "owner" | "doctor" | "reception" | "unknown";

type CapDentAnalyticsScreen =
  | "dashboard"
  | "authentication"
  | "onboarding"
  | "patient_workflow"
  | "appointment_workflow"
  | "payment_workflow"
  | "reports"
  | "staff"
  | "settings"
  | "clinic_settings"
  | "gallery"
  | "reminders"
  | "treatments"
  | "reception_workflow"
  | "image_viewer"
  | "other";

type CapDentQuotaResource = "patient" | "upload" | "storage";
type CapDentClinicalFileType =
  | "prescription"
  | "xray"
  | "before_photo"
  | "after_photo"
  | "report"
  | "other";
type CapDentAnalyticsPlatform = "android" | "ios" | "web" | "unknown";

type FirebaseAnalyticsParams = Record<string, string | number | boolean>;

type CapDentAnalyticsEvents = {
  capdent_app_ready: {
    role: CapDentAnalyticsRole;
  };
  capdent_screen_view: {
    screen_name: CapDentAnalyticsScreen;
    role: CapDentAnalyticsRole;
    signed_in: boolean;
  };
  capdent_patient_registered: {
    profile_photo_requested: boolean;
  };
  capdent_quota_blocked: {
    resource: CapDentQuotaResource;
    plan: "free" | "cloud" | "intelligence" | "unknown";
  };
  capdent_legal_consent_recorded: {
    platform: CapDentAnalyticsPlatform;
  };
  capdent_clinical_upload_complete: {
    file_type: CapDentClinicalFileType;
    billing_requested: boolean;
  };
};

const SAFE_ANALYTICS_EVENTS = new Set<keyof CapDentAnalyticsEvents>([
  "capdent_app_ready",
  "capdent_screen_view",
  "capdent_patient_registered",
  "capdent_quota_blocked",
  "capdent_legal_consent_recorded",
  "capdent_clinical_upload_complete",
]);

type FirebaseAnalyticsAdapter = {
  setConsent?: (consent: {
    analytics_storage: boolean;
    ad_storage: boolean;
    ad_user_data: boolean;
    ad_personalization: boolean;
  }) => void | Promise<unknown>;
  setAnalyticsCollectionEnabled?: (enabled: boolean) => void | Promise<unknown>;
  logEvent: (
    name: string,
    params?: FirebaseAnalyticsParams
  ) => void | Promise<unknown>;
};

export const FIREBASE_ANALYTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true";

let initialized = false;
let initializationPromise: Promise<boolean> | null = null;
let analyticsAdapter: FirebaseAnalyticsAdapter | null = null;

/** Keep the native SDK behind an adapter so privacy rules remain testable. */
export function configureFirebaseAnalyticsAdapter(
  adapter: FirebaseAnalyticsAdapter | null
) {
  analyticsAdapter = adapter;
  initialized = false;
  initializationPromise = null;
}

const SAFE_ANALYTICS_ROLES = new Set<CapDentAnalyticsRole>([
  "owner",
  "doctor",
  "reception",
  "unknown",
]);

const SAFE_ANALYTICS_SCREENS = new Set<CapDentAnalyticsScreen>([
  "dashboard",
  "authentication",
  "onboarding",
  "patient_workflow",
  "appointment_workflow",
  "payment_workflow",
  "reports",
  "staff",
  "settings",
  "clinic_settings",
  "gallery",
  "reminders",
  "treatments",
  "reception_workflow",
  "image_viewer",
  "other",
]);

const SAFE_QUOTA_RESOURCES = new Set<CapDentQuotaResource>([
  "patient",
  "upload",
  "storage",
]);

const SAFE_FILE_TYPES = new Set<CapDentClinicalFileType>([
  "prescription",
  "xray",
  "before_photo",
  "after_photo",
  "report",
  "other",
]);

const SAFE_PLATFORMS = new Set<CapDentAnalyticsPlatform>([
  "android",
  "ios",
  "web",
  "unknown",
]);

function safeAnalyticsRole(value: unknown): CapDentAnalyticsRole {
  return SAFE_ANALYTICS_ROLES.has(value as CapDentAnalyticsRole)
    ? (value as CapDentAnalyticsRole)
    : "unknown";
}

function safeAnalyticsScreen(value: unknown): CapDentAnalyticsScreen {
  return SAFE_ANALYTICS_SCREENS.has(value as CapDentAnalyticsScreen)
    ? (value as CapDentAnalyticsScreen)
    : "other";
}

function safePlan(value: unknown): "free" | "cloud" | "intelligence" | "unknown" {
  if (value === "free" || value === "cloud" || value === "intelligence") return value;
  return "unknown";
}

function sanitizeParams<EventName extends keyof CapDentAnalyticsEvents>(
  eventName: EventName,
  params: CapDentAnalyticsEvents[EventName]
): FirebaseAnalyticsParams {
  if (eventName === "capdent_app_ready") {
    const appReady = params as CapDentAnalyticsEvents["capdent_app_ready"];
    return { role: safeAnalyticsRole(appReady.role) };
  }

  if (eventName === "capdent_screen_view") {
    const screenParams = params as CapDentAnalyticsEvents["capdent_screen_view"];
    return {
      screen_name: safeAnalyticsScreen(screenParams.screen_name),
      role: safeAnalyticsRole(screenParams.role),
      signed_in: screenParams.signed_in === true,
    };
  }

  if (eventName === "capdent_patient_registered") {
    const patientParams = params as CapDentAnalyticsEvents["capdent_patient_registered"];
    return { profile_photo_requested: patientParams.profile_photo_requested === true };
  }

  if (eventName === "capdent_quota_blocked") {
    const quotaParams = params as CapDentAnalyticsEvents["capdent_quota_blocked"];
    return {
      resource: SAFE_QUOTA_RESOURCES.has(quotaParams.resource) ? quotaParams.resource : "patient",
      plan: safePlan(quotaParams.plan),
    };
  }

  if (eventName === "capdent_legal_consent_recorded") {
    const consentParams = params as CapDentAnalyticsEvents["capdent_legal_consent_recorded"];
    return {
      platform: SAFE_PLATFORMS.has(consentParams.platform) ? consentParams.platform : "unknown",
    };
  }

  const uploadParams = params as CapDentAnalyticsEvents["capdent_clinical_upload_complete"];
  return {
    file_type: SAFE_FILE_TYPES.has(uploadParams.file_type) ? uploadParams.file_type : "other",
    billing_requested: uploadParams.billing_requested === true,
  };
}

export function analyticsRole(role?: string | null): CapDentAnalyticsRole {
  if (role === "owner" || role === "head_doctor") return "owner";
  if (role === "doctor" || role === "working_doctor") return "doctor";
  if (role === "receptionist" || role === "reception" || role === "dental_assistant") {
    return "reception";
  }
  return "unknown";
}

export function analyticsScreenName(pathname?: string | null): CapDentAnalyticsScreen {
  const path = String(pathname || "/").toLowerCase();

  if (path === "/" || path === "/dashboard") return "dashboard";
  if (path.startsWith("/login") || path.startsWith("/auth/")) return "authentication";
  if (path.startsWith("/onboarding")) return "onboarding";
  if (path === "/patients" || path === "/patient" || path.startsWith("/patient/")) return "patient_workflow";
  if (path === "/appointments" || path === "/appointment" || path.startsWith("/appointment/")) return "appointment_workflow";
  if (path === "/billing" || path === "/payment" || path.startsWith("/payment/")) return "payment_workflow";
  if (path.startsWith("/reports/")) return "reports";
  if (path.startsWith("/staff/")) return "staff";
  if (path.startsWith("/settings/")) return "settings";
  if (path === "/profile" || path.startsWith("/clinic/")) return "clinic_settings";
  if (path.startsWith("/gallery")) return "gallery";
  if (path.startsWith("/reminders")) return "reminders";
  if (path.startsWith("/treatments")) return "treatments";
  if (path.startsWith("/reception/")) return "reception_workflow";
  if (path.startsWith("/image-viewer")) return "image_viewer";

  return "other";
}

export async function initializeFirebaseAnalytics() {
  if (initialized) return Boolean(analyticsAdapter) && FIREBASE_ANALYTICS_ENABLED;
  if (initializationPromise) return initializationPromise;
  if (!analyticsAdapter) {
    initialized = true;
    return false;
  }

  const adapter = analyticsAdapter;
  initializationPromise = (async () => {
    try {
      await adapter.setConsent?.({
        analytics_storage: FIREBASE_ANALYTICS_ENABLED,
        ad_storage: false,
        ad_user_data: false,
        ad_personalization: false,
      });
      await adapter.setAnalyticsCollectionEnabled?.(FIREBASE_ANALYTICS_ENABLED);
      initialized = true;
      return FIREBASE_ANALYTICS_ENABLED;
    } catch (error) {
      console.warn("Firebase Analytics initialization failed:", error);
      return false;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

export async function logCapDentAnalyticsEvent<EventName extends keyof CapDentAnalyticsEvents>(
  eventName: EventName,
  params: CapDentAnalyticsEvents[EventName]
) {
  if (!SAFE_ANALYTICS_EVENTS.has(eventName)) return;
  if (!FIREBASE_ANALYTICS_ENABLED || !analyticsAdapter) return;

  try {
    const ready = await initializeFirebaseAnalytics();
    if (!ready || !analyticsAdapter) return;
    await analyticsAdapter.logEvent(eventName, sanitizeParams(eventName, params));
  } catch (error) {
    console.warn(`Firebase Analytics event failed (${eventName}):`, error);
  }
}
