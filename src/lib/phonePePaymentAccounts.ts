import { supabase } from "@/lib/supabase";

export type PhonePePaymentAccount = {
  id: string;
  label: string;
  merchantIdMasked: string | null;
  status: string;
  paymentsEnabled: boolean;
  settlementsEnabled: boolean;
  isDefault: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disabledAt: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-phonepe-payment-accounts", { body });
  if (error) throw new Error(errorMessage(error, "PhonePe account management failed"));
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function listPhonePePaymentAccounts(): Promise<PhonePePaymentAccount[]> {
  const data = await invoke({ action: "list" });
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

export async function addPhonePePaymentAccount(merchantId: string, label: string) {
  return invoke({ action: "add", merchant_id: merchantId.trim(), label: label.trim() });
}

export async function setDefaultPhonePePaymentAccount(accountId: string) {
  return invoke({ action: "set_default", account_id: accountId });
}

export async function disablePhonePePaymentAccount(accountId: string) {
  return invoke({ action: "disable", account_id: accountId });
}
