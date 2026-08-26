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
type CapDentAnalyticsPlan = "free" | "cloud" | "intelligence" | "unknown";
type CapDentAuthMethod = "email" | "google";
type CapDentAuthOutcome = "success" | "failure";
type CapDentAuthFailureCategory =
  | "none"
  | "invalid_credentials"
  | "verification_required"
  | "rate_limited"
  | "network"
  | "cancelled"
  | "unknown";
type CapDentBillingRecoveryAction = "restore" | "recheck" | "manage";
type CapDentBillingRecoveryOutcome =
  | "success"
  | "refreshed"
  | "not_found"
  | "blocked"
  | "failure";
type CapDentBillingState =
  | "none"
  | "active"
  | "trial_started"
  | "grace_period"
  | "account_hold"
  | "pending_verification"
  | "expired"
  | "cancelled"
  | "unknown";
type CapDentNotificationHealthAction = "view" | "refresh" | "repair";
type CapDentNotificationHealthOutcome =
  | "healthy"
  | "attention"
  | "disabled"
  | "registered"
  | "permission_denied"
  | "not_completed"
  | "unavailable"
  | "failure";
type CapDentOwnerReviewAction = "view" | "refresh" | "open_card";
type CapDentOwnerReviewItem =
  | "none"
  | "missed_followups"
  | "paid_active"
  | "waived_op"
  | "patient_edits"
  | "other";
type CapDentAttentionBucket = "none" | "low" | "medium" | "high";

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
  capdent_auth_result: {
    method: CapDentAuthMethod;
    outcome: CapDentAuthOutcome;
    failure_category: CapDentAuthFailureCategory;
  };
  capdent_patient_registered: {
    profile_photo_requested: boolean;
  };
  capdent_quota_blocked: {
    resource: CapDentQuotaResource;
    plan: CapDentAnalyticsPlan;
  };
  capdent_plan_viewed: {
    plan: CapDentAnalyticsPlan;
    locked_context: boolean;
  };
  capdent_billing_recovery: {
    action: CapDentBillingRecoveryAction;
    outcome: CapDentBillingRecoveryOutcome;
    plan: CapDentAnalyticsPlan;
    state: CapDentBillingState;
  };
  capdent_notification_health: {
    action: CapDentNotificationHealthAction;
    outcome: CapDentNotificationHealthOutcome;
  };
  capdent_owner_review: {
    action: CapDentOwnerReviewAction;
    item: CapDentOwnerReviewItem;
    attention: CapDentAttentionBucket;
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
  "capdent_auth_result",
  "capdent_patient_registered",
  "capdent_quota_blocked",
  "capdent_plan_viewed",
  "capdent_billing_recovery",
  "capdent_notification_health",
  "capdent_owner_review",
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

const SAFE_AUTH_METHODS = new Set<CapDentAuthMethod>(["email", "google"]);
const SAFE_AUTH_OUTCOMES = new Set<CapDentAuthOutcome>(["success", "failure"]);
const SAFE_AUTH_FAILURE_CATEGORIES = new Set<CapDentAuthFailureCategory>([
  "none",
  "invalid_credentials",
  "verification_required",
  "rate_limited",
  "network",
  "cancelled",
  "unknown",
]);
const SAFE_BILLING_ACTIONS = new Set<CapDentBillingRecoveryAction>([
  "restore",
  "recheck",
  "manage",
]);
const SAFE_BILLING_OUTCOMES = new Set<CapDentBillingRecoveryOutcome>([
  "success",
  "refreshed",
  "not_found",
  "blocked",
  "failure",
]);
const SAFE_BILLING_STATES = new Set<CapDentBillingState>([
  "none",
  "active",
  "trial_started",
  "grace_period",
  "account_hold",
  "pending_verification",
  "expired",
  "cancelled",
  "unknown",
]);
const SAFE_NOTIFICATION_ACTIONS = new Set<CapDentNotificationHealthAction>([
  "view",
  "refresh",
  "repair",
]);
const SAFE_NOTIFICATION_OUTCOMES = new Set<CapDentNotificationHealthOutcome>([
  "healthy",
  "attention",
  "disabled",
  "registered",
  "permission_denied",
  "not_completed",
  "unavailable",
  "failure",
]);
const SAFE_OWNER_REVIEW_ACTIONS = new Set<CapDentOwnerReviewAction>([
  "view",
  "refresh",
  "open_card",
]);
const SAFE_OWNER_REVIEW_ITEMS = new Set<CapDentOwnerReviewItem>([
  "none",
  "missed_followups",
  "paid_active",
  "waived_op",
  "patient_edits",
  "other",
]);
const SAFE_ATTENTION_BUCKETS = new Set<CapDentAttentionBucket>([
  "none",
  "low",
  "medium",
  "high",
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

function safePlan(value: unknown): CapDentAnalyticsPlan {
  if (value === "free" || value === "cloud" || value === "intelligence") return value;
  return "unknown";
}

export function analyticsPlan(value: unknown): CapDentAnalyticsPlan {
  return safePlan(value);
}

export function analyticsAuthFailureCategory(error: unknown): CapDentAuthFailureCategory {
  const record = error && typeof error === "object"
    ? (error as { code?: unknown; message?: unknown; status?: unknown })
    : null;
  const text = `${String(record?.code ?? "")} ${String(record?.message ?? error ?? "")}`.toLowerCase();
  const status = Number(record?.status ?? 0);

  if (
    text.includes("invalid_credentials") ||
    text.includes("invalid login credentials") ||
    text.includes("invalid password")
  ) {
    return "invalid_credentials";
  }
  if (
    text.includes("email_not_confirmed") ||
    text.includes("email not confirmed") ||
    text.includes("verify your email")
  ) {
    return "verification_required";
  }
  if (
    status === 429 ||
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("over_email_send_rate_limit")
  ) {
    return "rate_limited";
  }
  if (
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("connection") ||
    text.includes("timeout")
  ) {
    return "network";
  }
  if (
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("user cancelled") ||
    text.includes("user canceled")
  ) {
    return "cancelled";
  }
  return "unknown";
}

export function analyticsBillingState(value: unknown): CapDentBillingState {
  return SAFE_BILLING_STATES.has(value as CapDentBillingState)
    ? (value as CapDentBillingState)
    : value == null || value === ""
      ? "none"
      : "unknown";
}

export function analyticsOwnerReviewItem(value: unknown): CapDentOwnerReviewItem {
  if (value === "missed-followups") return "missed_followups";
  if (value === "paid-active") return "paid_active";
  if (value === "waived-op") return "waived_op";
  if (value === "patient-edits") return "patient_edits";
  return value == null || value === "" ? "none" : "other";
}

export function analyticsAttentionBucket(count: unknown): CapDentAttentionBucket {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  if (value === 0) return "none";
  if (value <= 2) return "low";
  if (value <= 7) return "medium";
  return "high";
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

  if (eventName === "capdent_auth_result") {
    const authParams = params as CapDentAnalyticsEvents["capdent_auth_result"];
    return {
      method: SAFE_AUTH_METHODS.has(authParams.method) ? authParams.method : "email",
      outcome: SAFE_AUTH_OUTCOMES.has(authParams.outcome) ? authParams.outcome : "failure",
      failure_category: SAFE_AUTH_FAILURE_CATEGORIES.has(authParams.failure_category)
        ? authParams.failure_category
        : "unknown",
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

  if (eventName === "capdent_plan_viewed") {
    const planParams = params as CapDentAnalyticsEvents["capdent_plan_viewed"];
    return {
      plan: safePlan(planParams.plan),
      locked_context: planParams.locked_context === true,
    };
  }

  if (eventName === "capdent_billing_recovery") {
    const recoveryParams = params as CapDentAnalyticsEvents["capdent_billing_recovery"];
    return {
      action: SAFE_BILLING_ACTIONS.has(recoveryParams.action) ? recoveryParams.action : "restore",
      outcome: SAFE_BILLING_OUTCOMES.has(recoveryParams.outcome) ? recoveryParams.outcome : "failure",
      plan: safePlan(recoveryParams.plan),
      state: SAFE_BILLING_STATES.has(recoveryParams.state) ? recoveryParams.state : "unknown",
    };
  }

  if (eventName === "capdent_notification_health") {
    const notificationParams = params as CapDentAnalyticsEvents["capdent_notification_health"];
    return {
      action: SAFE_NOTIFICATION_ACTIONS.has(notificationParams.action) ? notificationParams.action : "view",
      outcome: SAFE_NOTIFICATION_OUTCOMES.has(notificationParams.outcome)
        ? notificationParams.outcome
        : "failure",
    };
  }

  if (eventName === "capdent_owner_review") {
    const ownerReviewParams = params as CapDentAnalyticsEvents["capdent_owner_review"];
    return {
      action: SAFE_OWNER_REVIEW_ACTIONS.has(ownerReviewParams.action)
        ? ownerReviewParams.action
        : "view",
      item: SAFE_OWNER_REVIEW_ITEMS.has(ownerReviewParams.item)
        ? ownerReviewParams.item
        : "other",
      attention: SAFE_ATTENTION_BUCKETS.has(ownerReviewParams.attention)
        ? ownerReviewParams.attention
        : "none",
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
