import { logCapDentAnalyticsEvent } from "@/lib/firebaseAnalytics";
import { supabase } from "@/lib/supabase";
import { CAPDENT_V25_LIMITS, formatStorageBytes } from "@/lib/v25Limits";

export const CAPDENT_TERMS_VERSION = "2026-08-14";
export const CAPDENT_PRIVACY_VERSION = "2026-08-14";
export const CAPDENT_APP_VERSION = "1.2.3";

export type CapDentPlanCodeV25 = "free" | "cloud" | "intelligence";

export type CapDentEntitlementsV25 = {
  version: 25;
  clinicId: string | null;
  plan: CapDentPlanCodeV25;
  planLabel: string;
  monthlyPrice: number;
  patientCount: number;
  patientLimit: number | null;
  remainingPatients: number | null;
  patientLimitEnforced: boolean;
  uploadCount: number;
  uploadLimit: number | null;
  remainingUploads: number | null;
  uploadLimitEnforced: boolean;
  storageUsedBytes: number;
  storageLimitBytes: number;
  storageLimitEnforced: boolean;
  canAddPatient: boolean;
  canUpload: boolean;
  grandfathered: boolean;
  pricingVisible: boolean;
  subscriptionStatus: string;
};

const FREE = CAPDENT_V25_LIMITS.free;

export const SAFE_V25_ENTITLEMENTS: CapDentEntitlementsV25 = {
  version: 25,
  clinicId: null,
  plan: "free",
  planLabel: "Free",
  monthlyPrice: 0,
  patientCount: 0,
  patientLimit: FREE.patientLimit,
  remainingPatients: FREE.patientLimit,
  patientLimitEnforced: false,
  uploadCount: 0,
  uploadLimit: FREE.uploadLimit,
  remainingUploads: FREE.uploadLimit,
  uploadLimitEnforced: false,
  storageUsedBytes: 0,
  storageLimitBytes: FREE.storageLimitBytes,
  storageLimitEnforced: false,
  canAddPatient: true,
  canUpload: true,
  grandfathered: true,
  pricingVisible: false,
  subscriptionStatus: "free",
};

function numberOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePlan(value: unknown): CapDentPlanCodeV25 {
  if (value === "cloud" || value === "intelligence") return value;
  return "free";
}

export function normalizeCapDentEntitlementsV25(value: unknown): CapDentEntitlementsV25 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...SAFE_V25_ENTITLEMENTS };
  }

  const row = value as Record<string, unknown>;
  const patientCount = Math.max(0, numberOr(row.patientCount, 0));
  const patientLimit = nullableNumber(row.patientLimit);
  const uploadCount = Math.max(0, numberOr(row.uploadCount, 0));
  const uploadLimit = nullableNumber(row.uploadLimit);
  const storageUsedBytes = Math.max(0, numberOr(row.storageUsedBytes, 0));
  const storageLimitBytes = Math.max(1, numberOr(row.storageLimitBytes, FREE.storageLimitBytes));

  return {
    version: 25,
    clinicId: typeof row.clinicId === "string" ? row.clinicId : null,
    plan: normalizePlan(row.plan),
    planLabel: typeof row.planLabel === "string" ? row.planLabel : "Free",
    monthlyPrice: Math.max(0, numberOr(row.monthlyPrice, 0)),
    patientCount,
    patientLimit,
    remainingPatients:
      row.remainingPatients === null
        ? null
        : Math.max(0, numberOr(row.remainingPatients, patientLimit === null ? 0 : patientLimit - patientCount)),
    patientLimitEnforced: row.patientLimitEnforced === true,
    uploadCount,
    uploadLimit,
    remainingUploads:
      row.remainingUploads === null
        ? null
        : Math.max(0, numberOr(row.remainingUploads, uploadLimit === null ? 0 : uploadLimit - uploadCount)),
    uploadLimitEnforced: row.uploadLimitEnforced === true,
    storageUsedBytes,
    storageLimitBytes,
    storageLimitEnforced: row.storageLimitEnforced === true,
    canAddPatient: row.canAddPatient !== false,
    canUpload: row.canUpload !== false,
    grandfathered: row.grandfathered !== false,
    pricingVisible: row.pricingVisible === true,
    subscriptionStatus:
      typeof row.subscriptionStatus === "string" ? row.subscriptionStatus : "free",
  };
}

/**
 * Reads the V25 server-authoritative entitlement snapshot.
 *
 * The fallback is deliberately non-enforcing so an unavailable RPC cannot
 * brick older production clients. Actual quota rejection is owned by the
 * database triggers once rollout flags are enabled.
 */
export async function getCapDentEntitlementsV25(): Promise<CapDentEntitlementsV25> {
  try {
    const { data, error } = await supabase.rpc("get_capdent_entitlements_v25");
    if (error) throw error;
    return normalizeCapDentEntitlementsV25(data);
  } catch (error) {
    console.warn("CapDent V25 entitlements failed open:", error);
    return { ...SAFE_V25_ENTITLEMENTS };
  }
}

export async function hasCurrentCapDentLegalConsent() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) return false;

  const { data, error } = await supabase
    .from("capdent_legal_consents")
    .select("id")
    .eq("user_id", user.id)
    .eq("terms_version", CAPDENT_TERMS_VERSION)
    .eq("privacy_version", CAPDENT_PRIVACY_VERSION)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) throw error;
  return Boolean(data?.id);
}

export function patientQuotaMessage(entitlements: CapDentEntitlementsV25) {
  if (!entitlements.patientLimitEnforced || entitlements.patientLimit === null) return null;
  if (entitlements.canAddPatient) return null;

  void logCapDentAnalyticsEvent("capdent_quota_blocked", {
    resource: "patient",
    plan: entitlements.plan,
  });

  return `This clinic has reached its ${entitlements.patientLimit}-patient ${entitlements.planLabel} limit. Upgrade the plan to register another patient.`;
}

export function uploadQuotaMessage(entitlements: CapDentEntitlementsV25) {
  if (!entitlements.canUpload) {
    if (
      entitlements.uploadLimitEnforced &&
      entitlements.uploadLimit !== null &&
      entitlements.uploadCount >= entitlements.uploadLimit
    ) {
      void logCapDentAnalyticsEvent("capdent_quota_blocked", {
        resource: "upload",
        plan: entitlements.plan,
      });
      return `This clinic has reached its ${entitlements.uploadLimit}-upload ${entitlements.planLabel} limit. Upgrade the plan before uploading another clinical file.`;
    }

    if (
      entitlements.storageLimitEnforced &&
      entitlements.storageUsedBytes >= entitlements.storageLimitBytes
    ) {
      void logCapDentAnalyticsEvent("capdent_quota_blocked", {
        resource: "storage",
        plan: entitlements.plan,
      });
      return `This clinic has reached its ${formatStorageBytes(entitlements.storageLimitBytes)} storage limit. Upgrade the plan or remove unneeded files before uploading.`;
    }

    void logCapDentAnalyticsEvent("capdent_quota_blocked", {
      resource: "upload",
      plan: entitlements.plan,
    });
    return "This clinic cannot upload another file under its current plan.";
  }

  return null;
}

export async function recordCapDentLegalConsent(input: {
  termsVersion: string;
  privacyVersion: string;
  appVersion?: string | null;
  platform?: "android" | "ios" | "web";
}) {
  const platform = input.platform ?? "android";
  const { data, error } = await supabase.rpc("record_capdent_legal_consent", {
    p_terms_version: input.termsVersion,
    p_privacy_version: input.privacyVersion,
    p_app_version: input.appVersion ?? null,
    p_platform: platform,
  });

  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Consent could not be confirmed by the server.");
  }

  void logCapDentAnalyticsEvent("capdent_legal_consent_recorded", {
    platform,
  });

  return data as {
    id: string;
    acceptedAt: string;
    termsVersion: string;
    privacyVersion: string;
  };
}
