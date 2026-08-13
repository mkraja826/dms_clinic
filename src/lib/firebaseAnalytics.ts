type CapDentAnalyticsRole = "owner" | "doctor" | "reception" | "unknown";

type AnalyticsParams = Record<string, string | number | boolean>;

export const FIREBASE_ANALYTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true";

let initialized = false;
let analyticsInstance: any | null | undefined;

function getAnalyticsInstance() {
  if (analyticsInstance !== undefined) return analyticsInstance;

  try {
    const module = require("@react-native-firebase/analytics");
    const factory = module?.default ?? module;
    analyticsInstance = typeof factory === "function" ? factory() : null;
  } catch {
    analyticsInstance = null;
  }

  return analyticsInstance;
}

function cleanString(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeParams(params: AnalyticsParams) {
  const safe: AnalyticsParams = {};

  for (const [key, value] of Object.entries(params)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
    if (!safeKey) continue;

    if (typeof value === "string") safe[safeKey] = cleanString(value);
    else if (typeof value === "number" && Number.isFinite(value)) safe[safeKey] = value;
    else if (typeof value === "boolean") safe[safeKey] = value;
  }

  return safe;
}

export function analyticsRole(role?: string | null): CapDentAnalyticsRole {
  if (role === "owner" || role === "head_doctor") return "owner";
  if (role === "doctor" || role === "working_doctor") return "doctor";
  if (role === "receptionist") return "reception";
  return "unknown";
}

export function analyticsScreenName(pathname?: string | null) {
  const path = String(pathname || "/").toLowerCase();

  if (path === "/" || path.includes("/(tabs)")) return "dashboard";
  if (path.startsWith("/login") || path.startsWith("/auth/")) return "authentication";
  if (path.startsWith("/onboarding")) return "onboarding";
  if (path.startsWith("/patient/")) return "patient_workflow";
  if (path.startsWith("/appointment/")) return "appointment_workflow";
  if (path.startsWith("/payment/")) return "payment_workflow";
  if (path.startsWith("/reports/")) return "reports";
  if (path.startsWith("/staff/")) return "staff";
  if (path.startsWith("/settings/")) return "settings";
  if (path.startsWith("/clinic/")) return "clinic_settings";
  if (path.startsWith("/gallery")) return "gallery";
  if (path.startsWith("/reminders")) return "reminders";
  if (path.startsWith("/treatments")) return "treatments";
  if (path.startsWith("/reception/")) return "reception_workflow";
  if (path.startsWith("/image-viewer")) return "image_viewer";

  return "other";
}

export async function initializeFirebaseAnalytics() {
  if (initialized) return Boolean(getAnalyticsInstance());
  initialized = true;

  const analytics = getAnalyticsInstance();
  if (!analytics) return false;

  try {
    await analytics.setConsent?.({
      analytics_storage: FIREBASE_ANALYTICS_ENABLED,
      ad_storage: false,
      ad_user_data: false,
      ad_personalization: false,
    });
    await analytics.setAnalyticsCollectionEnabled?.(FIREBASE_ANALYTICS_ENABLED);
    return FIREBASE_ANALYTICS_ENABLED;
  } catch (error) {
    console.warn("Firebase Analytics initialization failed:", error);
    return false;
  }
}

export async function logCapDentAnalyticsEvent(
  eventName: "capdent_app_ready" | "capdent_screen_view",
  params: AnalyticsParams = {}
) {
  if (!FIREBASE_ANALYTICS_ENABLED) return;

  const analytics = getAnalyticsInstance();
  if (!analytics) return;

  try {
    await analytics.logEvent(eventName, sanitizeParams(params));
  } catch (error) {
    console.warn(`Firebase Analytics event failed (${eventName}):`, error);
  }
}
