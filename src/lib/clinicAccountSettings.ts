import {
  cleanCountryCode,
  cleanCurrencyCode,
  ClinicPreferences,
  normalizeClinicTime,
} from "@/lib/clinicLocale";
import {
  canManageClinicFeatureSettings,
  cleanClinicOpFee,
  ClinicFeatureSettings,
  invalidateClinicFeatureSettingsCache,
} from "@/lib/clinicOptions";
import { invalidateClinicPreferencesCache } from "@/lib/clinicPreferences";
import {
  PAYMENT_PUSH_GLOBALLY_ENABLED,
  TOOTH_CHART_GLOBALLY_ENABLED,
} from "@/lib/featureFlags";
import { getCurrentProfile, supabase } from "@/lib/supabase";

type ClinicAccountSettings = {
  preferences: ClinicPreferences;
  settings: ClinicFeatureSettings;
};

type ClinicAccountRow = Record<string, unknown>;

function normalizePreferences(input: ClinicPreferences): ClinicPreferences {
  const rawCountryCode = input.countryCode.trim().toUpperCase();
  const countryCode = cleanCountryCode(rawCountryCode);
  if (!/^[A-Z]{2}$/.test(rawCountryCode) || countryCode !== rawCountryCode) {
    throw new Error("Select a valid clinic country or region.");
  }

  const rawCurrencyCode = input.currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(rawCurrencyCode)) {
    throw new Error("Enter a valid three-letter currency code.");
  }

  const openingTime = normalizeClinicTime(input.openingTime, "");
  const closingTime = normalizeClinicTime(input.closingTime, "");
  if (!openingTime || !closingTime) {
    throw new Error("Enter valid opening and closing times.");
  }

  return {
    countryCode,
    currencyCode: cleanCurrencyCode(rawCurrencyCode, countryCode),
    openingTime,
    closingTime,
  };
}

function databaseTime(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return null;
  return normalizeClinicTime(`${match[1]}:${match[2]}`, "") || null;
}

function parseSavedSettings(
  value: unknown,
  fallback: ClinicAccountSettings
): ClinicAccountSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved clinic settings response was malformed.");
  }

  const row = value as ClinicAccountRow;
  const countryCode =
    typeof row.country_code === "string"
      ? row.country_code.trim().toUpperCase()
      : "";
  const currencyCode =
    typeof row.currency_code === "string"
      ? row.currency_code.trim().toUpperCase()
      : "";
  const openingTime = databaseTime(row.opening_time);
  const closingTime = databaseTime(row.closing_time);
  const opFeeAmount = Number(row.op_fee_amount);

  if (
    !/^[A-Z]{2}$/.test(countryCode) ||
    cleanCountryCode(countryCode) !== countryCode ||
    !/^[A-Z]{3}$/.test(currencyCode) ||
    !openingTime ||
    !closingTime ||
    typeof row.enable_patient_photos !== "boolean" ||
    typeof row.enable_prescription_medications !== "boolean" ||
    !Number.isFinite(opFeeAmount) ||
    opFeeAmount <= 0
  ) {
    throw new Error("The saved clinic settings response was malformed.");
  }

  if (
    (PAYMENT_PUSH_GLOBALLY_ENABLED &&
      typeof row.payment_push_enabled !== "boolean") ||
    (TOOTH_CHART_GLOBALLY_ENABLED &&
      typeof row.tooth_chart_enabled !== "boolean")
  ) {
    throw new Error("The saved clinic settings response was malformed.");
  }

  return {
    preferences: {
      countryCode,
      currencyCode,
      openingTime,
      closingTime,
    },
    settings: {
      enable_patient_photos: row.enable_patient_photos,
      enable_prescription_medications:
        row.enable_prescription_medications,
      payment_push_enabled: PAYMENT_PUSH_GLOBALLY_ENABLED
        ? Boolean(row.payment_push_enabled)
        : fallback.settings.payment_push_enabled,
      tooth_chart_enabled: TOOTH_CHART_GLOBALLY_ENABLED
        ? Boolean(row.tooth_chart_enabled)
        : fallback.settings.tooth_chart_enabled,
      op_fee_amount: cleanClinicOpFee(opFeeAmount),
    },
  };
}

/** Saves every Account Settings field in one atomic clinics-row update. */
export async function updateClinicAccountSettings(
  input: ClinicAccountSettings
): Promise<ClinicAccountSettings> {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found.");
  if (!canManageClinicFeatureSettings(profile)) {
    throw new Error("Only the clinic owner can update these options.");
  }

  const preferences = normalizePreferences(input.preferences);
  const rawOpFeeAmount = Number(input.settings.op_fee_amount);
  if (
    !Number.isFinite(rawOpFeeAmount) ||
    rawOpFeeAmount <= 0 ||
    rawOpFeeAmount > 99_999_999.99
  ) {
    throw new Error("OP fee must be greater than zero and within the supported range.");
  }

  const settings: ClinicFeatureSettings = {
    ...input.settings,
    op_fee_amount: cleanClinicOpFee(rawOpFeeAmount),
  };
  const updates: Record<string, string | number | boolean> = {
    country_code: preferences.countryCode,
    currency_code: preferences.currencyCode,
    opening_time: preferences.openingTime,
    closing_time: preferences.closingTime,
    op_fee_amount: settings.op_fee_amount,
    enable_patient_photos: settings.enable_patient_photos,
    enable_prescription_medications:
      settings.enable_prescription_medications,
  };
  const selectedColumns = [
    "country_code",
    "currency_code",
    "opening_time",
    "closing_time",
    "op_fee_amount",
    "enable_patient_photos",
    "enable_prescription_medications",
  ];

  // Omit staged fields when their global switch is off so masked false values
  // cannot overwrite an enabled production-clinic preference.
  if (PAYMENT_PUSH_GLOBALLY_ENABLED) {
    updates.payment_push_enabled = settings.payment_push_enabled;
    selectedColumns.push("payment_push_enabled");
  }
  if (TOOTH_CHART_GLOBALLY_ENABLED) {
    updates.tooth_chart_enabled = settings.tooth_chart_enabled;
    selectedColumns.push("tooth_chart_enabled");
  }

  try {
    const { data, error } = await supabase
      .from("clinics")
      .update(updates)
      .eq("id", profile.clinic_id)
      .select(selectedColumns.join(","))
      .single();

    if (error) throw error;
    return parseSavedSettings(data, { preferences, settings });
  } finally {
    // A lost or malformed response can follow a committed update. Never leave
    // either cache claiming that the pre-save values are authoritative.
    invalidateClinicFeatureSettingsCache();
    invalidateClinicPreferencesCache();
  }
}
