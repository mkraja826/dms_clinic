import { supabase } from "@/lib/supabase";

export const MANUAL_QR_BUCKET = "clinic-payment-qr";

export type ManualPaymentQrAccount = {
  id: string;
  clinicId: string;
  label: string;
  accountName: string | null;
  upiId: string | null;
  qrStoragePath: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  signedUrl: string | null;
};

type ProfileContext = {
  userId: string;
  clinicId: string;
  role: string;
};

function cleanNullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function profileContext(): Promise<ProfileContext> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("Authentication required");

  const { data, error } = await supabase
    .from("profiles")
    .select("clinic_id, role, active")
    .eq("id", userId)
    .single();
  if (error) throw error;
  if (!data?.active || !data.clinic_id) throw new Error("Active clinic profile not found");

  return {
    userId,
    clinicId: String(data.clinic_id),
    role: String(data.role || "").toLowerCase(),
  };
}

export async function listManualPaymentQrAccounts(options?: { activeOnly?: boolean }) {
  let query = supabase
    .from("clinic_payment_qr_accounts")
    .select("id, clinic_id, label, account_name, upi_id, qr_storage_path, is_default, is_active, created_at, updated_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (options?.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const paths = rows.map((row) => String(row.qr_storage_path));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: signedData } = await supabase.storage
      .from(MANUAL_QR_BUCKET)
      .createSignedUrls(paths, 60 * 10);
    signedData?.forEach((item) => {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    });
  }

  return rows.map((row): ManualPaymentQrAccount => ({
    id: String(row.id),
    clinicId: String(row.clinic_id),
    label: String(row.label),
    accountName: row.account_name ? String(row.account_name) : null,
    upiId: row.upi_id ? String(row.upi_id) : null,
    qrStoragePath: String(row.qr_storage_path),
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    signedUrl: signed.get(String(row.qr_storage_path)) || null,
  }));
}

export async function uploadManualPaymentQrImage(input: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}) {
  const profile = await profileContext();
  if (!["owner", "head_doctor"].includes(profile.role)) {
    throw new Error("Only the clinic owner or head doctor can upload payment QR images");
  }

  const mimeType = input.mimeType || "image/jpeg";
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const safeBase = (input.fileName || `payment-qr-${Date.now()}`)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 60) || `payment-qr-${Date.now()}`;
  const path = `${profile.clinicId}/${safeBase}-${Date.now()}.${extension}`;

  const response = await fetch(input.uri);
  if (!response.ok) throw new Error("Could not read the selected QR image");
  const body = await response.arrayBuffer();

  const { error } = await supabase.storage.from(MANUAL_QR_BUCKET).upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function createManualPaymentQrAccount(input: {
  label: string;
  accountName?: string | null;
  upiId?: string | null;
  qrStoragePath: string;
  makeDefault?: boolean;
}) {
  const profile = await profileContext();
  if (!["owner", "head_doctor"].includes(profile.role)) {
    throw new Error("Only the clinic owner or head doctor can add payment QRs");
  }

  const { data: current, error: currentError } = await supabase
    .from("clinic_payment_qr_accounts")
    .select("id")
    .eq("clinic_id", profile.clinicId)
    .eq("is_active", true)
    .limit(1);
  if (currentError) throw currentError;
  const makeDefault = input.makeDefault || !current?.length;

  if (makeDefault) {
    const { error } = await supabase
      .from("clinic_payment_qr_accounts")
      .update({ is_default: false })
      .eq("clinic_id", profile.clinicId)
      .eq("is_default", true);
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("clinic_payment_qr_accounts")
    .insert({
      clinic_id: profile.clinicId,
      label: input.label.trim(),
      account_name: cleanNullable(input.accountName),
      upi_id: cleanNullable(input.upiId),
      qr_storage_path: input.qrStoragePath,
      is_default: makeDefault,
      is_active: true,
      created_by: profile.userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function updateManualPaymentQrAccount(
  accountId: string,
  patch: { label?: string; accountName?: string | null; upiId?: string | null; isActive?: boolean }
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.accountName !== undefined) update.account_name = cleanNullable(patch.accountName);
  if (patch.upiId !== undefined) update.upi_id = cleanNullable(patch.upiId);
  if (patch.isActive !== undefined) update.is_active = patch.isActive;

  const { error } = await supabase.from("clinic_payment_qr_accounts").update(update).eq("id", accountId);
  if (error) throw error;
}

export async function setDefaultManualPaymentQrAccount(accountId: string) {
  const profile = await profileContext();
  if (!["owner", "head_doctor"].includes(profile.role)) {
    throw new Error("Only the clinic owner or head doctor can change the default payment QR");
  }

  const { error: clearError } = await supabase
    .from("clinic_payment_qr_accounts")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("clinic_id", profile.clinicId)
    .eq("is_default", true);
  if (clearError) throw clearError;

  const { error } = await supabase
    .from("clinic_payment_qr_accounts")
    .update({ is_default: true, is_active: true, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("clinic_id", profile.clinicId);
  if (error) throw error;
}

export async function deleteManualPaymentQrAccount(account: ManualPaymentQrAccount) {
  const { error } = await supabase.from("clinic_payment_qr_accounts").delete().eq("id", account.id);
  if (error) throw error;
  await supabase.storage.from(MANUAL_QR_BUCKET).remove([account.qrStoragePath]);
}

export async function confirmManualQrCollection(input: {
  patientId: string;
  qrAccountId: string;
  feeType: "op_fee" | "xray_fee" | "medication_fee" | "treatment_fee" | "other";
  amount: number;
  note?: string | null;
}) {
  const { data, error } = await supabase.rpc("confirm_manual_qr_collection", {
    p_patient_id: input.patientId,
    p_qr_account_id: input.qrAccountId,
    p_fee_type: input.feeType,
    p_amount: input.amount,
    p_note: cleanNullable(input.note),
  });
  if (error) throw error;
  return data || [];
}
