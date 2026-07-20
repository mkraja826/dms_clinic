import {
  cleanCountryCode,
  cleanCurrencyCode,
  ClinicPreferences,
  normalizeClinicTime,
} from "@/lib/clinicLocale";
import {
  invalidateSupabaseCache,
  Profile,
  supabase,
} from "@/lib/supabase";

export async function createOwnerClinicWithPreferences(input: {
  clinicName: string;
  ownerName: string;
  phone?: string;
  email?: string;
  address?: string;
  preferences: ClinicPreferences;
}) {
  const countryCode = cleanCountryCode(input.preferences.countryCode);
  const currencyCode = cleanCurrencyCode(
    input.preferences.currencyCode,
    countryCode
  );

  const { data, error } = await supabase.rpc("create_owner_clinic", {
    clinic_name: input.clinicName,
    owner_name: input.ownerName,
    clinic_phone: input.phone || null,
    clinic_email: input.email || null,
    clinic_address: input.address || null,
    clinic_country_code: countryCode,
    clinic_currency_code: currencyCode,
    clinic_opening_time: normalizeClinicTime(
      input.preferences.openingTime,
      "09:00"
    ),
    clinic_closing_time: normalizeClinicTime(
      input.preferences.closingTime,
      "21:00"
    ),
  });

  if (error) throw error;
  invalidateSupabaseCache();
  return data as Profile;
}
