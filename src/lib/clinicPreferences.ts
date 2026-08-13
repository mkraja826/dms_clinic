import {
  cleanCountryCode,
  cleanCurrencyCode,
  ClinicPreferences,
  getDefaultClinicPreferences,
  normalizeClinicTime,
} from "@/lib/clinicLocale";
import { getCurrentProfile, Profile, supabase } from "@/lib/supabase";

const CLINIC_PREFERENCES_CACHE_TTL_MS = 120_000;

let cachedClinicPreferences:
  | {
      clinicId: string;
      preferences: ClinicPreferences;
      expiresAt: number;
    }
  | null = null;

export function invalidateClinicPreferencesCache() {
  cachedClinicPreferences = null;
}

function cleanStoredClinicTime(value: string | null | undefined, fallback: string) {
  const raw = (value || "").trim();
  const databaseTime = raw.match(
    /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/
  );

  return normalizeClinicTime(
    databaseTime ? `${databaseTime[1]}:${databaseTime[2]}` : raw,
    fallback
  );
}

function cleanPreferences(input?: Partial<ClinicPreferences> | null): ClinicPreferences {
  const defaults = getDefaultClinicPreferences();
  const countryCode = cleanCountryCode(input?.countryCode || defaults.countryCode);

  return {
    countryCode,
    currencyCode: cleanCurrencyCode(input?.currencyCode, countryCode),
    openingTime: cleanStoredClinicTime(input?.openingTime, defaults.openingTime),
    closingTime: cleanStoredClinicTime(input?.closingTime, defaults.closingTime),
  };
}

function copyPreferences(preferences: ClinicPreferences): ClinicPreferences {
  return { ...preferences };
}

export function canManageClinicPreferences(profile?: Profile | null) {
  return profile?.role === "head_doctor" || profile?.role === "owner";
}

export async function getClinicPreferences(options?: {
  force?: boolean;
}): Promise<ClinicPreferences> {
  const profile = await getCurrentProfile();
  const defaults = getDefaultClinicPreferences();

  if (!profile?.clinic_id) return copyPreferences(defaults);

  const now = Date.now();
  if (
    !options?.force &&
    cachedClinicPreferences?.clinicId === profile.clinic_id &&
    cachedClinicPreferences.expiresAt > now
  ) {
    return copyPreferences(cachedClinicPreferences.preferences);
  }

  const { data, error } = await supabase
    .from("clinics")
    .select("country_code,currency_code,opening_time,closing_time")
    .eq("id", profile.clinic_id)
    .maybeSingle();

  if (error) throw error;

  const preferences = cleanPreferences({
    countryCode: data?.country_code,
    currencyCode: data?.currency_code,
    openingTime: data?.opening_time,
    closingTime: data?.closing_time,
  });

  cachedClinicPreferences = {
    clinicId: profile.clinic_id,
    preferences,
    expiresAt: Date.now() + CLINIC_PREFERENCES_CACHE_TTL_MS,
  };

  return copyPreferences(preferences);
}

export async function updateClinicPreferences(input: ClinicPreferences) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  if (!canManageClinicPreferences(profile)) {
    throw new Error("Only the clinic owner can change country, currency, or usual hours.");
  }

  const preferences = cleanPreferences(input);

  const { data, error } = await supabase
    .from("clinics")
    .update({
      country_code: preferences.countryCode,
      currency_code: preferences.currencyCode,
      opening_time: preferences.openingTime,
      closing_time: preferences.closingTime,
    })
    .eq("id", profile.clinic_id)
    .select("country_code,currency_code,opening_time,closing_time")
    .single();

  if (error) throw error;

  const updated = cleanPreferences({
    countryCode: data?.country_code,
    currencyCode: data?.currency_code,
    openingTime: data?.opening_time,
    closingTime: data?.closing_time,
  });

  cachedClinicPreferences = {
    clinicId: profile.clinic_id,
    preferences: updated,
    expiresAt: Date.now() + CLINIC_PREFERENCES_CACHE_TTL_MS,
  };

  return copyPreferences(updated);
}
