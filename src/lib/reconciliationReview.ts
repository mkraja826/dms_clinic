import { supabase } from "@/lib/supabase";

export type ReconciliationRequiredCase = {
  paymentRequestId: string;
  patientName: string;
  patientCode: string;
  provider: string;
  accountLabel: string;
  merchantIdMasked: string;
  verifiedAmount: number;
  currentDue: number;
  currencyCode: string;
  failureCode: string;
  failureMessage: string;
  providerVerifiedAt: string | null;
  lastCheckedAt: string | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getReconciliationRequiredCases(): Promise<ReconciliationRequiredCase[]> {
  const { data, error } = await supabase.rpc("get_v28_reconciliation_required_cases");
  if (error) throw error;

  return (Array.isArray(data) ? data : []).map((row: any) => ({
    paymentRequestId: String(row.payment_request_id || ""),
    patientName: String(row.patient_name || "Patient"),
    patientCode: String(row.patient_code || ""),
    provider: String(row.provider || "").toUpperCase(),
    accountLabel: String(row.account_label || "Receiving account"),
    merchantIdMasked: String(row.merchant_id_masked || ""),
    verifiedAmount: numberValue(row.verified_amount),
    currentDue: numberValue(row.current_due),
    currencyCode: String(row.currency_code || "INR").toUpperCase(),
    failureCode: String(row.failure_code || ""),
    failureMessage: String(row.failure_message || ""),
    providerVerifiedAt: row.provider_verified_at ? String(row.provider_verified_at) : null,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
  }));
}
