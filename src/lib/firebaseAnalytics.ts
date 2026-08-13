type CapDentAnalyticsRole = "owner" | "doctor" | "reception" | "unknown";

type AnalyticsParams = Record<string, string | number | boolean>;

type FirebaseAnalyticsAdapter = {
  setConsent?: (consent: {
    analytics_storage: boolean;
    ad_storage: boolean;
    ad_user_data: boolean;
    ad_personalization: boolean;
  }) => Promise<unknown>;
  setAnalyticsCollectionEnabled?: (enabled: boolean) => Promise<unknown>;
  logEvent: (name: string, params?: AnalyticsParams) => Promise<unknown>;
};

export const FIREBASE_ANALYTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_ANALYTICS === "true";

let initialized = false;
let initializationPromise: Promise<boolean> | null = null;
let analyticsAdapter: FirebaseAnalyticsAdapter | null = null;

/**
 * Native Firebase is intentionally injected instead of imported here.
 *
 * Until @react-native-firebase/app and @react-native-firebase/analytics are
 * installed during the controlled V25 native/RC pass, Metro must not see a
 * static dependency on those packages. This keeps the current V24-compatible
 * bundle safe while allowing the native adapter to be connected later.
 */
export function configureFirebaseAnalyticsAdapter(
  adapter: FirebaseAnalyticsAdapter | null
) {
  analyticsAdapter = adapter;
  initialized = false;
  initializationPromise = null;
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

export async function logCapDentAnalyticsEvent(
  eventName: "capdent_app_ready" | "capdent_screen_view",
  params: AnalyticsParams = {}
) {
  if (!FIREBASE_ANALYTICS_ENABLED || !analyticsAdapter) return;

  try {
    const ready = await initializeFirebaseAnalytics();
    if (!ready || !analyticsAdapter) return;
    await analyticsAdapter.logEvent(eventName, sanitizeParams(params));
  } catch (error) {
    console.warn(`Firebase Analytics event failed (${eventName}):`, error);
  }
}
