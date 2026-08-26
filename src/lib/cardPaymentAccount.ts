import { supabase } from "@/lib/supabase";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

export async function startCardPaymentAccountOnboarding() {
  const { data, error } = await supabase.functions.invoke("connect-card-payment-account", {
    body: {},
  });
  if (error) throw new Error(errorMessage(error, "Card receiving-account onboarding failed"));
  if (data?.error) throw new Error(String(data.error));

  const onboardingUrl = String(data?.onboardingUrl || "").trim();
  if (!/^https:\/\//i.test(onboardingUrl)) {
    throw new Error("The card provider did not return a secure onboarding URL");
  }

  return {
    onboardingUrl,
    accountId: String(data?.accountId || ""),
    expiresAt: data?.expiresAt ? String(data.expiresAt) : null,
  };
}

export async function syncCardPaymentAccount() {
  const { data, error } = await supabase.functions.invoke("sync-card-payment-account", {
    body: {},
  });
  if (error) throw new Error(errorMessage(error, "Card receiving-account status refresh failed"));
  if (data?.error) throw new Error(String(data.error));

  return {
    status: String(data?.status || "not_connected"),
    paymentsEnabled: data?.paymentsEnabled === true,
    settlementsEnabled: data?.settlementsEnabled === true,
    detailsSubmitted: data?.detailsSubmitted === true,
    requirementsDue: Number(data?.requirementsDue || 0),
  };
}
