import { invalidateAppDataCache, invalidateSupabaseCache, supabase } from "@/lib/supabase";

export const PHONEPE_PAYMENTS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_PHONEPE_PAYMENTS === "true";

export type PhonePeCheckoutStart = {
  merchantOrderId: string;
  state: string;
  amountPaise: number;
  redirectUrl: string;
  expireAt: number | null;
};

export type PhonePeCheckoutStatus = {
  merchantOrderId: string;
  invoiceId: string;
  state: string;
  settled: boolean;
  idempotent: boolean;
  amountVerified: boolean;
};

function functionErrorMessage(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return message || fallback;
}

export async function createPhonePeInvoicePayment(
  invoiceId: string
): Promise<PhonePeCheckoutStart> {
  if (!PHONEPE_PAYMENTS_ENABLED) {
    throw new Error("PhonePe payments are not enabled in this CapDent build.");
  }

  const { data, error } = await supabase.functions.invoke("phonepe-create-payment", {
    body: { invoice_id: invoiceId },
  });
  if (error) throw new Error(functionErrorMessage(error, "PhonePe payment could not be started."));
  if (!data?.merchantOrderId || !data?.redirectUrl) {
    throw new Error(data?.error || "PhonePe did not return a checkout session.");
  }

  return {
    merchantOrderId: String(data.merchantOrderId),
    state: String(data.state || "PENDING"),
    amountPaise: Number(data.amountPaise || 0),
    redirectUrl: String(data.redirectUrl),
    expireAt: data.expireAt ? Number(data.expireAt) : null,
  };
}

export async function checkPhonePeInvoicePayment(
  merchantOrderId: string
): Promise<PhonePeCheckoutStatus> {
  if (!PHONEPE_PAYMENTS_ENABLED) {
    throw new Error("PhonePe payments are not enabled in this CapDent build.");
  }

  const { data, error } = await supabase.functions.invoke("phonepe-check-payment", {
    body: { merchant_order_id: merchantOrderId },
  });
  if (error) throw new Error(functionErrorMessage(error, "PhonePe payment status could not be verified."));
  if (!data?.merchantOrderId) {
    throw new Error(data?.error || "PhonePe payment status was unavailable.");
  }

  const result: PhonePeCheckoutStatus = {
    merchantOrderId: String(data.merchantOrderId),
    invoiceId: String(data.invoiceId || ""),
    state: String(data.state || "UNKNOWN").toUpperCase(),
    settled: data.settled === true,
    idempotent: data.idempotent === true,
    amountVerified: data.amountVerified === true,
  };

  if (result.settled) {
    invalidateAppDataCache("payments");
    invalidateAppDataCache("dashboard");
    invalidateSupabaseCache();
  }

  return result;
}
