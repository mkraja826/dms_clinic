import { getCurrentProfile, Profile, supabase } from "@/lib/supabase";
import {
  PAYMENT_PUSH_GLOBALLY_ENABLED,
  TOOTH_CHART_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";

export type ClinicFeatureSettings = {
  enable_patient_photos: boolean;
  enable_prescription_medications: boolean;
  payment_push_enabled: boolean;
  tooth_chart_enabled: boolean;
  op_fee_amount: number;
};

export const DEFAULT_OP_FEE_AMOUNT = 300;

export const DEFAULT_CLINIC_FEATURE_SETTINGS: ClinicFeatureSettings = {
  enable_patient_photos: false,
  enable_prescription_medications: false,
  payment_push_enabled: false,
  tooth_chart_enabled: false,
  op_fee_amount: DEFAULT_OP_FEE_AMOUNT,
};

const CLINIC_FEATURE_CACHE_TTL_MS = 120_000;

let cachedClinicFeatures:
  | {
      clinicId: string;
      settings: ClinicFeatureSettings;
      expiresAt: number;
    }
  | null = null;

export function invalidateClinicFeatureSettingsCache() {
  cachedClinicFeatures = null;
}

export function cleanClinicOpFee(value: unknown) {
  const amount = Math.round(Number(value || DEFAULT_OP_FEE_AMOUNT));
  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_OP_FEE_AMOUNT;
  return amount;
}

export function canManageClinicFeatureSettings(profile?: Profile | null) {
  return profile?.role === "head_doctor" || profile?.role === "owner";
}

export async function getClinicFeatureSettings(options?: { force?: boolean }): Promise<ClinicFeatureSettings> {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) return { ...DEFAULT_CLINIC_FEATURE_SETTINGS };

  const now = Date.now();
  if (
    !options?.force &&
    cachedClinicFeatures?.clinicId === profile.clinic_id &&
    cachedClinicFeatures.expiresAt > now
  ) {
    return { ...cachedClinicFeatures.settings };
  }

  const { data, error } = await supabase
    .from("clinics")
    .select("enable_patient_photos,enable_prescription_medications,op_fee_amount")
    .eq("id", profile.clinic_id)
    .maybeSingle();

  if (error) throw error;

  let stagedSettings = {
    payment_push_enabled: false,
    tooth_chart_enabled: false,
  };

  // Keep old databases compatible while staged modules are globally off. Once
  // either build flag is enabled, a missing additive migration still fails
  // closed to disabled instead of breaking the existing settings screen.
  if (PAYMENT_PUSH_GLOBALLY_ENABLED || TOOTH_CHART_GLOBALLY_ENABLED) {
    const { data: stagedData, error: stagedError } = await supabase
      .from("clinics")
      .select("payment_push_enabled,tooth_chart_enabled")
      .eq("id", profile.clinic_id)
      .maybeSingle();

    if (stagedError) {
      console.warn("Staged clinic features are unavailable:", stagedError.message);
    } else {
      stagedSettings = {
        payment_push_enabled:
          PAYMENT_PUSH_GLOBALLY_ENABLED &&
          Boolean(stagedData?.payment_push_enabled),
        tooth_chart_enabled:
          TOOTH_CHART_GLOBALLY_ENABLED &&
          Boolean(stagedData?.tooth_chart_enabled),
      };
    }
  }

  const settings = {
    enable_patient_photos: Boolean(data?.enable_patient_photos),
    enable_prescription_medications: Boolean(data?.enable_prescription_medications),
    ...stagedSettings,
    op_fee_amount: cleanClinicOpFee(data?.op_fee_amount),
  };

  cachedClinicFeatures = {
    clinicId: profile.clinic_id,
    settings,
    expiresAt: Date.now() + CLINIC_FEATURE_CACHE_TTL_MS,
  };

  return { ...settings };
}

export async function updateClinicFeatureSettings(input: ClinicFeatureSettings) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  if (!canManageClinicFeatureSettings(profile)) {
    throw new Error("Only clinic owner can change optional clinic features.");
  }

  const updates: Record<string, boolean | number> = {
    enable_patient_photos: input.enable_patient_photos,
    enable_prescription_medications: input.enable_prescription_medications,
    op_fee_amount: cleanClinicOpFee(input.op_fee_amount),
  };

  if (PAYMENT_PUSH_GLOBALLY_ENABLED) {
    updates.payment_push_enabled = input.payment_push_enabled;
  }
  if (TOOTH_CHART_GLOBALLY_ENABLED) {
    updates.tooth_chart_enabled = input.tooth_chart_enabled;
  }

  const selectColumns = [
    "enable_patient_photos",
    "enable_prescription_medications",
    "op_fee_amount",
    ...(PAYMENT_PUSH_GLOBALLY_ENABLED ? ["payment_push_enabled"] : []),
    ...(TOOTH_CHART_GLOBALLY_ENABLED ? ["tooth_chart_enabled"] : []),
  ].join(",");

  const { data, error } = await supabase
    .from("clinics")
    .update(updates)
    .eq("id", profile.clinic_id)
    .select(selectColumns)
    .single();

  if (error) throw error;

  const saved = data as unknown as Partial<ClinicFeatureSettings>;
  const settings = {
    enable_patient_photos: Boolean(saved.enable_patient_photos),
    enable_prescription_medications: Boolean(
      saved.enable_prescription_medications
    ),
    payment_push_enabled:
      PAYMENT_PUSH_GLOBALLY_ENABLED &&
      Boolean(saved.payment_push_enabled),
    tooth_chart_enabled:
      TOOTH_CHART_GLOBALLY_ENABLED &&
      Boolean(saved.tooth_chart_enabled),
    op_fee_amount: cleanClinicOpFee(saved.op_fee_amount),
  };

  cachedClinicFeatures = {
    clinicId: profile.clinic_id,
    settings,
    expiresAt: Date.now() + CLINIC_FEATURE_CACHE_TTL_MS,
  };

  return { ...settings };
}
