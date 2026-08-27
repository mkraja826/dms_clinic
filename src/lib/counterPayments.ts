import { supabase } from "@/lib/supabase";

export type CounterPaymentCategory =
  | "op_fee"
  | "xray_fee"
  | "medication_fee"
  | "treatment_fee"
  | "pending_collection"
  | "other";

export type CounterPaymentRequest = {
  paymentRequestId: string;
  provider: string;
  amount: number;
  currencyCode: string;
  status: string;
  paymentCategory: CounterPaymentCategory;
};

export type CounterPaymentQr = CounterPaymentRequest & {
  checkoutUrl: string;
  qrSvg: string;
  expiresAt: string | null;
};

function asNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function rowOf(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

export async function prepareCounterPaymentRequest(input: {
  patientId: string;
  paymentCategory: CounterPaymentCategory;
  amount: number;
}): Promise<CounterPaymentRequest> {
  const { data, error } = await supabase.rpc("prepare_v28_counter_payment_request", {
    p_patient_id: input.patientId,
    p_payment_category: input.paymentCategory,
    p_amount: input.amount,
  });
  if (error) throw error;
  const row = rowOf(data) as any;
  if (!row?.payment_request_id) throw new Error("Counter payment request was not created");
  return {
    paymentRequestId: String(row.payment_request_id),
    provider: String(row.provider || ""),
    amount: asNumber(row.amount),
    currencyCode: String(row.currency_code || "INR").toUpperCase(),
    status: String(row.request_status || "prepared"),
    paymentCategory: String(row.payment_category || input.paymentCategory) as CounterPaymentCategory,
  };
}

export async function createCounterPaymentCheckout(paymentRequestId: string) {
  const { data, error } = await supabase.functions.invoke("create-counter-payment-checkout", {
    body: { payment_request_id: paymentRequestId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (!data?.checkoutUrl) throw new Error("Provider checkout URL was not returned");
  return data as {
    paymentRequestId: string;
    provider: string;
    amount: number;
    currencyCode: string;
    checkoutUrl: string;
    expiresAt: string | null;
  };
}

export async function getCounterPaymentQr(paymentRequestId: string): Promise<CounterPaymentQr> {
  const { data, error } = await supabase.functions.invoke("get-counter-payment-qr", {
    body: { payment_request_id: paymentRequestId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (!data?.qrSvg) throw new Error("Counter payment QR was not returned");
  return {
    paymentRequestId: String(data.paymentRequestId || paymentRequestId),
    provider: String(data.provider || "phonepe"),
    amount: asNumber(data.amount),
    currencyCode: String(data.currencyCode || "INR").toUpperCase(),
    status: String(data.status || "pending"),
    paymentCategory: String(data.paymentCategory || "other") as CounterPaymentCategory,
    checkoutUrl: String(data.checkoutUrl || ""),
    qrSvg: String(data.qrSvg || ""),
    expiresAt: data.expiresAt ? String(data.expiresAt) : null,
  };
}

export async function getCounterPaymentStatus(paymentRequestId: string) {
  const { data, error } = await supabase
    .from("patient_payment_requests")
    .select("id,status,provider_status,amount,currency_code,payment_category,reconciled_at,failure_code,failure_message")
    .eq("id", paymentRequestId)
    .eq("request_mode", "counter_qr")
    .single();
  if (error) throw error;
  return {
    status: String(data.status || ""),
    providerStatus: data.provider_status ? String(data.provider_status) : null,
    amount: asNumber(data.amount),
    currencyCode: String(data.currency_code || "INR").toUpperCase(),
    paymentCategory: String(data.payment_category || "other") as CounterPaymentCategory,
    reconciledAt: data.reconciled_at ? String(data.reconciled_at) : null,
    failureCode: data.failure_code ? String(data.failure_code) : null,
    failureMessage: data.failure_message ? String(data.failure_message) : null,
  };
}
