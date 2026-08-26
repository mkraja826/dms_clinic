import { getClinicPreferences } from "@/lib/clinicPreferences";
import { supabase } from "@/lib/supabase";

export type PatientPaymentProvider = "phonepe" | "card" | "unconfigured";
export type PatientPaymentAccountState =
  | "not_connected"
  | "pending"
  | "connected"
  | "restricted"
  | "disabled"
  | "country_required"
  | "unavailable";

export type PatientPaymentAccountStatus = {
  provider: PatientPaymentProvider;
  providerLabel: string;
  status: PatientPaymentAccountState;
  paymentsEnabled: boolean;
  settlementsEnabled: boolean;
  countryCode: string | null;
  currencyCode: string | null;
  connectedAt: string | null;
  backendReady: boolean;
};

export function expectedPatientPaymentProvider(countryCode?: string | null): PatientPaymentProvider {
  const code = String(countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "unconfigured";
  return code === "IN" ? "phonepe" : "card";
}

export function patientPaymentProviderLabel(provider: PatientPaymentProvider) {
  if (provider === "phonepe") return "PhonePe";
  if (provider === "card") return "Card";
  return "Country required";
}

function fallbackStatus(countryCode: string | null, currencyCode: string | null): PatientPaymentAccountStatus {
  const provider = expectedPatientPaymentProvider(countryCode);
  return {
    provider,
    providerLabel: patientPaymentProviderLabel(provider),
    status: provider === "unconfigured" ? "country_required" : "unavailable",
    paymentsEnabled: false,
    settlementsEnabled: false,
    countryCode,
    currencyCode,
    connectedAt: null,
    backendReady: false,
  };
}

export async function getPatientPaymentAccountStatus(): Promise<PatientPaymentAccountStatus> {
  const preferences = await getClinicPreferences().catch(() => null);
  const countryCode = preferences?.countryCode || null;
  const currencyCode = preferences?.currencyCode || null;

  try {
    const { data, error } = await supabase.rpc("get_clinic_patient_payment_status");
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fallbackStatus(countryCode, currencyCode);

    const provider = String(row.provider || "unconfigured") as PatientPaymentProvider;
    const status = String(row.account_status || "not_connected") as PatientPaymentAccountState;

    return {
      provider,
      providerLabel: String(row.provider_label || patientPaymentProviderLabel(provider)),
      status,
      paymentsEnabled: Boolean(row.payments_enabled),
      settlementsEnabled: Boolean(row.settlements_enabled),
      countryCode: row.country_code ? String(row.country_code) : countryCode,
      currencyCode: row.currency_code ? String(row.currency_code) : currencyCode,
      connectedAt: row.connected_at ? String(row.connected_at) : null,
      backendReady: Boolean(row.backend_ready),
    };
  } catch {
    // Backward-safe fallback while the additive V28 migration has not yet been
    // applied to an environment. Existing billing remains unaffected.
    return fallbackStatus(countryCode, currencyCode);
  }
}
