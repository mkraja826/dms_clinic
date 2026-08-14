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
};

const SAFE_ANALYTICS_EVENTS = new Set<keyof CapDentAnalyticsEvents>([
  "capdent_app_ready",
  "capdent_screen_view",
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

function sanitizeParams<EventName extends keyof CapDentAnalyticsEvents>(
  eventName: EventName,
  params: CapDentAnalyticsEvents[EventName]
): FirebaseAnalyticsParams {
  if (eventName === "capdent_app_ready") {
    return { role: safeAnalyticsRole(params.role) };
  }

  const screenParams = params as CapDentAnalyticsEvents["capdent_screen_view"];
  return {
    screen_name: safeAnalyticsScreen(screenParams.screen_name),
    role: safeAnalyticsRole(screenParams.role),
    signed_in: screenParams.signed_in === true,
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
