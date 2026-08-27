import { supabase } from "@/lib/supabase";

export type AccountDeletionMode = "clinic_and_account" | "profile_only";

export type AccountDeletionResult = {
  ok: boolean;
  mode: AccountDeletionMode;
  message?: string;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

export async function deleteCurrentCapDentAccount(confirmation: string) {
  const { data, error } = await supabase.functions.invoke("delete-capdent-account", {
    body: { confirmation },
  });

  if (error) throw new Error(errorMessage(error, "Account deletion failed"));
  if (data?.error) throw new Error(String(data.error));
  return data as AccountDeletionResult;
}
