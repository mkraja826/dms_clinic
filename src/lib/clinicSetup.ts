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

export type CreateOwnerClinicInput = {
  clinicName: string;
  ownerName: string;
  phone?: string;
  email?: string;
  address?: string;
  preferences: ClinicPreferences;
};

type CreateOwnerClinicRpcParams = {
  clinic_name: string;
  owner_name: string;
  clinic_phone: string | null;
  clinic_email: string | null;
  clinic_address: string | null;
  clinic_country_code: string;
  clinic_currency_code: string;
  clinic_opening_time: string;
  clinic_closing_time: string;
};

const CREATE_OWNER_CLINIC_RPC_KEYS = [
  "clinic_name",
  "owner_name",
  "clinic_phone",
  "clinic_email",
  "clinic_address",
  "clinic_country_code",
  "clinic_currency_code",
  "clinic_opening_time",
  "clinic_closing_time",
] as const;

function requiredText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function optionalText(value?: string) {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

export function buildCreateOwnerClinicRpcParams(
  input: CreateOwnerClinicInput
): CreateOwnerClinicRpcParams {
  const countryCode = cleanCountryCode(input.preferences.countryCode);
  const currencyCode = cleanCurrencyCode(
    input.preferences.currencyCode,
    countryCode
  );

  const payload = {
    clinic_name: requiredText(input.clinicName, "Clinic name"),
    owner_name: requiredText(input.ownerName, "Owner or head doctor name"),
    clinic_phone: optionalText(input.phone),
    clinic_email: optionalText(input.email),
    clinic_address: optionalText(input.address),
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
  } satisfies CreateOwnerClinicRpcParams;

  const payloadKeys = Object.keys(payload).sort();
  const expectedKeys = [...CREATE_OWNER_CLINIC_RPC_KEYS].sort();

  if (
    payloadKeys.length !== expectedKeys.length ||
    expectedKeys.some((key, index) => payloadKeys[index] !== key)
  ) {
    throw new Error("Clinic setup request is incomplete. Please try again.");
  }

  return payload;
}

export async function createOwnerClinicWithPreferences(
  input: CreateOwnerClinicInput
) {
  const payload = buildCreateOwnerClinicRpcParams(input);
  const { data, error } = await supabase.rpc("create_owner_clinic", payload);

  if (error) throw error;
  invalidateSupabaseCache();
  return data as Profile;
}
