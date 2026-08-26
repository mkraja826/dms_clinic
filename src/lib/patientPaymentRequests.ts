import { supabase } from "@/lib/supabase";

export type PatientPaymentRequestStatus =
  | "prepared"
  | "provider_pending"
  | "pending"
  | "provider_verified"
  | "reconciled"
  | "failed"
  | "expired"
  | "cancelled"
  | "superseded";

export type PatientPaymentRequest = {
  id: string;
  billId: string;
  provider: "phonepe" | "card";
  amount: number;
  currencyCode: string;
  status: PatientPaymentRequestStatus;
  checkoutUrl: string | null;
  expiresAt: string | null;
  providerVerifiedAt: string | null;
  reconciledAt: string | null;
};

export type PatientPaymentRequestResult = {
  backendReady: boolean;
  request: PatientPaymentRequest | null;
  reason?: string;
};

function isMissingBackend(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42883" ||
    code === "42P01" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    message.includes("patient_payment_requests") ||
    message.includes("prepare_v28_patient_payment_request")
  );
}

function mapRow(row: any): PatientPaymentRequest {
  return {
    id: String(row.id || row.payment_request_id || ""),
    billId: String(row.consolidated_bill_id || row.bill_id || ""),
    provider: String(row.provider || "card") === "phonepe" ? "phonepe" : "card",
    amount: Number(row.amount || 0),
    currencyCode: String(row.currency_code || ""),
    status: String(row.status || row.request_status || "prepared") as PatientPaymentRequestStatus,
    checkoutUrl: row.checkout_url ? String(row.checkout_url) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    providerVerifiedAt: row.provider_verified_at ? String(row.provider_verified_at) : null,
    reconciledAt: row.reconciled_at ? String(row.reconciled_at) : null,
  };
}

export function canSharePatientPaymentRequest(request: PatientPaymentRequest | null) {
  if (!request?.checkoutUrl) return false;
  if (request.status !== "pending") return false;
  if (!/^https:\/\//i.test(request.checkoutUrl)) return false;
  if (request.expiresAt) {
    const expires = new Date(request.expiresAt).getTime();
    if (Number.isFinite(expires) && expires <= Date.now()) return false;
  }
  return true;
}

export async function getLatestPatientPaymentRequest(
  billId: string
): Promise<PatientPaymentRequestResult> {
  const cleanBillId = billId.trim();
  if (!cleanBillId) return { backendReady: true, request: null };

  try {
    const { data, error } = await supabase
      .from("patient_payment_requests")
      .select(
        "id,consolidated_bill_id,provider,amount,currency_code,status,checkout_url,expires_at,provider_verified_at,reconciled_at"
      )
      .eq("consolidated_bill_id", cleanBillId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { backendReady: true, request: data ? mapRow(data) : null };
  } catch (error) {
    if (isMissingBackend(error)) {
      return {
        backendReady: false,
        request: null,
        reason: "The V28 online-payment request backend is not deployed in this environment yet.",
      };
    }
    throw error;
  }
}

/**
 * Prepares the exact current remaining balance on a finalized consolidated
 * invoice. This does not contact PhonePe/card provider and cannot mark an
 * invoice paid. The trusted provider adapter must attach the hosted checkout
 * URL later.
 */
export async function preparePatientPaymentRequest(
  billId: string
): Promise<PatientPaymentRequestResult> {
  const cleanBillId = billId.trim();
  if (!cleanBillId) throw new Error("Final invoice ID is required");

  const { data, error } = await supabase.rpc("prepare_v28_patient_payment_request", {
    p_bill_id: cleanBillId,
  });

  if (error) {
    if (isMissingBackend(error)) {
      return {
        backendReady: false,
        request: null,
        reason: "The V28 online-payment request backend is not deployed in this environment yet.",
      };
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.payment_request_id) throw new Error("Payment request was not returned by the server");

  return {
    backendReady: true,
    request: mapRow({ ...row, consolidated_bill_id: cleanBillId }),
  };
}
