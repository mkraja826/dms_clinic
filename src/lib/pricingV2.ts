import { supabase } from "@/lib/supabase";

export type CapDentPlanCode = "free" | "cloud" | "intelligence";

export type CapDentEntitlementsV2 = {
  version: 2;
  clinicId: string | null;
  legacyPlanName: string;
  plan: CapDentPlanCode;
  planLabel: string;
  monthlyPrice: number;
  patientCount: number;
  patientLimit: number | null;
  remainingPatients: number | null;
  canAddPatient: boolean;
  wouldBlockAtCurrentCount: boolean;
  patientLimitEnforced: boolean;
  shadowMode: boolean;
  pricingVisible: boolean;
  storageUsedBytes: number;
  storageLimitBytes: number;
  analyticsEnabled: boolean;
  multiClinicEnabled: boolean;
  clinicLimit: number;
  grandfathered: boolean;
  pricingPolicyVersion: number;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
};

const ONE_GB = 1024 * 1024 * 1024;

export const SAFE_PRICING_V2_FALLBACK: CapDentEntitlementsV2 = {
  version: 2,
  clinicId: null,
  legacyPlanName: "free",
  plan: "free",
  planLabel: "Free",
  monthlyPrice: 0,
  patientCount: 0,
  patientLimit: 300,
  remainingPatients: 300,
  canAddPatient: true,
  wouldBlockAtCurrentCount: false,
  patientLimitEnforced: false,
  shadowMode: false,
  pricingVisible: false,
  storageUsedBytes: 0,
  storageLimitBytes: ONE_GB,
  analyticsEnabled: false,
  multiClinicEnabled: false,
  clinicLimit: 1,
  grandfathered: true,
  pricingPolicyVersion: 1,
  subscriptionStatus: "free",
  currentPeriodEnd: null,
};

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function planCode(value: unknown): CapDentPlanCode {
  if (value === "cloud" || value === "intelligence") return value;
  return "free";
}

export function normalizeCapDentEntitlementsV2(value: unknown): CapDentEntitlementsV2 {
  if (!value || typeof value !== "object") return SAFE_PRICING_V2_FALLBACK;

  const row = value as Record<string, unknown>;
  const patientLimit = nullableNumber(row.patientLimit);
  const patientCount = Math.max(0, numberOr(row.patientCount, 0));
  const fallbackRemaining = patientLimit === null ? null : Math.max(patientLimit - patientCount, 0);

  return {
    version: 2,
    clinicId: typeof row.clinicId === "string" ? row.clinicId : null,
    legacyPlanName: typeof row.legacyPlanName === "string" ? row.legacyPlanName : "free",
    plan: planCode(row.plan),
    planLabel: typeof row.planLabel === "string" ? row.planLabel : "Free",
    monthlyPrice: Math.max(0, numberOr(row.monthlyPrice, 0)),
    patientCount,
    patientLimit,
    remainingPatients: row.remainingPatients === null ? null : nullableNumber(row.remainingPatients) ?? fallbackRemaining,
    canAddPatient: row.canAddPatient !== false,
    wouldBlockAtCurrentCount: row.wouldBlockAtCurrentCount === true,
    patientLimitEnforced: row.patientLimitEnforced === true,
    shadowMode: row.shadowMode === true,
    pricingVisible: row.pricingVisible === true,
    storageUsedBytes: Math.max(0, numberOr(row.storageUsedBytes, 0)),
    storageLimitBytes: Math.max(1, numberOr(row.storageLimitBytes, ONE_GB)),
    analyticsEnabled: row.analyticsEnabled === true,
    multiClinicEnabled: row.multiClinicEnabled === true,
    clinicLimit: Math.max(1, numberOr(row.clinicLimit, 1)),
    grandfathered: row.grandfathered !== false,
    pricingPolicyVersion: Math.max(1, numberOr(row.pricingPolicyVersion, 1)),
    subscriptionStatus: typeof row.subscriptionStatus === "string" ? row.subscriptionStatus : "free",
    currentPeriodEnd: typeof row.currentPeriodEnd === "string" ? row.currentPeriodEnd : null,
  };
}

/**
 * Reads the dormant V2 entitlement snapshot.
 *
 * This helper is intentionally not wired into patient creation or navigation yet.
 * When the RPC is unavailable or returns an unexpected response, it fails open so
 * the currently released clinic workflow cannot be locked by pricing work.
 */
export async function getCapDentEntitlementsV2(): Promise<CapDentEntitlementsV2> {
  try {
    const { data, error } = await supabase.rpc("get_capdent_entitlements_v2");

    if (error) {
      console.warn("CapDent pricing V2 unavailable; using safe fallback:", error.message);
      return SAFE_PRICING_V2_FALLBACK;
    }

    return normalizeCapDentEntitlementsV2(data);
  } catch (error) {
    console.warn("CapDent pricing V2 failed open:", error);
    return SAFE_PRICING_V2_FALLBACK;
  }
}
