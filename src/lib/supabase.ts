import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { createClient, processLock } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { optimizeUploadImage, withImageExtension } from "@/lib/imageCompression";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "";

const hasRealSupabaseUrl =
  /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co$/.test(supabaseUrl) &&
  !supabaseUrl.includes("your-project");

const hasRealSupabaseKey =
  supabaseAnonKey.length > 40 &&
  !supabaseAnonKey.includes("your-anon-key");

export const isSupabaseConfigured = hasRealSupabaseUrl && hasRealSupabaseKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

// Native apps do not have a browser tab lifecycle, so refresh the session only
// while the app is active. Register this once alongside the singleton client.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

const supabaseProjectRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
const supabaseAuthStorageKey = supabaseProjectRef ? `sb-${supabaseProjectRef}-auth-token` : null;
const forceSignedOutKey = "midms.force-signed-out";
const PROFILE_CACHE_TTL_MS = 60_000;
const DASHBOARD_CACHE_TTL_MS = 20_000;
const PATIENT_LIST_CACHE_TTL_MS = 45_000;
const APPOINTMENT_CACHE_TTL_MS = 20_000;
const PAYMENT_CACHE_TTL_MS = 20_000;
const STAFF_CACHE_TTL_MS = 60_000;
export const FREE_PATIENT_LIMIT = 100;
export const FREE_PATIENT_NOTICE_REMAINING = 50;
export const FREE_PATIENT_WARNING_REMAINING = 10;
export const CAPDENT_CURRENTLY_FREE_MESSAGE = "CapDent is currently free for all clinics.";

type CacheOptions = { force?: boolean };
type AppDataCacheScope = "dashboard" | "patients" | "appointments" | "payments" | "treatments" | "staff";
type QueryCacheEntry<T> = {
  data: T;
  expiresAt: number;
};

let cachedProfile:
  | {
      userId: string;
      profile: Profile | null;
      expiresAt: number;
    }
  | null = null;
let profileLoadPromise: Promise<Profile | null> | null = null;
const queryCache = new Map<string, QueryCacheEntry<unknown>>();
const queryInflight = new Map<string, Promise<unknown>>();

function clearQueryCache(scope?: AppDataCacheScope) {
  if (!scope) {
    queryCache.clear();
    queryInflight.clear();
    return;
  }

  const prefix = `${scope}:`;
  Array.from(queryCache.keys()).forEach((key) => {
    if (key.startsWith(prefix)) queryCache.delete(key);
  });
  Array.from(queryInflight.keys()).forEach((key) => {
    if (key.startsWith(prefix)) queryInflight.delete(key);
  });
}

function invalidateAppDataScopes(scopes: AppDataCacheScope[]) {
  scopes.forEach((scope) => clearQueryCache(scope));
}

export function invalidateAppDataCache(scope?: AppDataCacheScope) {
  clearQueryCache(scope);
}

async function cachedQuery<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options?: CacheOptions
) {
  const now = Date.now();
  const cached = queryCache.get(key) as QueryCacheEntry<T> | undefined;

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.data;
  }

  const inflight = queryInflight.get(key) as Promise<T> | undefined;
  if (!options?.force && inflight) {
    return inflight;
  }

  const request = loader()
    .then((data) => {
      queryCache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
      });
      return data;
    })
    .finally(() => {
      queryInflight.delete(key);
    });

  queryInflight.set(key, request);
  return request;
}

export function invalidateSupabaseCache() {
  cachedProfile = null;
  profileLoadPromise = null;
  clearQueryCache();
}

export async function clearSupabaseAuthStorage() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const authKeys = keys.filter(
      (key) =>
        key === supabaseAuthStorageKey ||
        key === "supabase.auth.token" ||
        (key.startsWith("sb-") && key.endsWith("-auth-token"))
    );

    if (supabaseAuthStorageKey && !authKeys.includes(supabaseAuthStorageKey)) {
      authKeys.push(supabaseAuthStorageKey);
    }

    if (authKeys.length > 0) {
      await AsyncStorage.multiRemove(authKeys);
    }
  } catch (error) {
    console.warn("Failed to clear stored auth session:", error);
  }
}

export async function markForceSignedOut() {
  try {
    await AsyncStorage.setItem(forceSignedOutKey, "1");
  } catch (error) {
    console.warn("Failed to mark signed-out state:", error);
  }
}

export async function clearForceSignedOut() {
  try {
    await AsyncStorage.removeItem(forceSignedOutKey);
  } catch (error) {
    console.warn("Failed to clear signed-out state:", error);
  }
}

export async function shouldForceSignedOut() {
  try {
    return (await AsyncStorage.getItem(forceSignedOutKey)) === "1";
  } catch (error) {
    console.warn("Failed to read signed-out state:", error);
    return false;
  }
}

export type Role =
  | "head_doctor"
  | "working_doctor"
  | "receptionist"
  | "owner"
  | "doctor";

export type NormalizedRole = "head_doctor" | "working_doctor" | "receptionist";

export type AppointmentStatus =
  | "scheduled"
  | "waiting"
  | "checked_in"
  | "booked"
  | "completed"
  | "done"
  | "cancelled"
  | "canceled"
  | "no_show"
  | "followup"
  | "reminded";
export type InvoiceStatus = "unpaid" | "partial" | "paid";
export type PaymentCategory =
  | "op_fee"
  | "xray_fee"
  | "medication_fee"
  | "treatment_fee"
  | "pending_collection"
  | "other";
export type FileType =
  | "prescription"
  | "xray"
  | "before_photo"
  | "after_photo"
  | "report"
  | "other";

export type UploadProgressPhase = "preparing" | "uploading" | "saving" | "complete";

export type UploadProgressState = {
  phase: UploadProgressPhase;
  percent: number;
  bytesSent?: number;
  totalBytes?: number;
  message: string;
};

type StorageUploadResult = {
  provider: "supabase";
  storagePath: string;
  publicUrl: string;
};

export type Profile = {
  id: string;
  clinic_id: string | null;
  name: string;
  email: string | null;
  role: Role;
  invite_code?: string | null;
  active: boolean;
  created_at: string;
};

export type Clinic = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
};

export type Patient = {
  id: string;
  clinic_id: string;
  patient_code: string | null;
  name: string;
  gender: string | null;
  age: number | null;
  dob?: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact: string | null;
  created_at: string;
};

export type MedicalHistory = {
  id: string;
  patient_id: string;
  heart_issue: boolean;
  kidney_issue: boolean;
  brain_issue: boolean;
  diabetes: boolean;
  blood_pressure: boolean;
  allergies: string | null;
  current_medicines: string | null;
  other_notes: string | null;
  created_at: string;
};

export type Appointment = {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string | null;
  appointment_time: string;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
  patients?: Pick<Patient, "id" | "name" | "phone"> | null;
  profiles?: Pick<Profile, "id" | "name"> | null;
};

export type Visit = {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string | null;
  visit_date: string;
  chief_complaint: string | null;
  diagnosis: string | null;
  doctor_notes: string | null;
  next_appointment_date: string | null;
  created_at: string;
};

export type Treatment = {
  id: string;
  clinic_id: string;
  visit_id: string | null;
  patient_id: string;
  treatment_name: string;
  description: string | null;
  cost: number;
  status: "planned" | "ongoing" | "completed" | "cancelled";
  created_at: string;
};

export type PatientFile = {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id: string | null;
  file_type: FileType;
  file_url: string;
  file_name: string;
  file_note?: string | null;
  xray_amount?: number | null;
  xray_fee_status?: "not_applicable" | "pending" | "paid" | "waived" | null;
  uploaded_by: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  original_size_bytes?: number | null;
  stored_size_bytes?: number | null;
  created_at: string;
};

export type Invoice = {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id: string | null;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  status: InvoiceStatus;
  payment_category?: PaymentCategory | null;
  notes?: string | null;
  created_at: string;
  patients?: Pick<Patient, "id" | "name" | "phone"> | null;
};

export type PatientAuditLog = {
  id: string;
  clinic_id: string;
  patient_id: string;
  changed_by: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
};

export type DashboardStats = {
  todayAppointments: number;
  totalPatients: number;
  pendingPayments: number;
  todayRevenue: number;
  recentPatients: Patient[];
  todayAppointmentList: Appointment[];
};

export type WorkflowDashboardSummary = {
  today_revenue?: number | null;
  pending_payments?: number | null;
  op_fee_revenue_today?: number | null;
  xray_revenue_today?: number | null;
  medication_revenue_today?: number | null;
  treatment_revenue_today?: number | null;
  pending_collected_today?: number | null;
  other_revenue_today?: number | null;
  today_patient_count?: number | null;
  waiting_count?: number | null;
  completed_count?: number | null;
};

export type ClinicPatientLimitStatus = {
  count: number;
  limit: number;
  remaining: number | null;
  unlimited: boolean;
  level: "none" | "notice" | "warning" | "blocked";
  message: string;
};

export type StaffInvite = {
  id: string;
  clinic_id: string;
  email: string | null;
  name: string;
  role: Role;
  invite_code: string | null;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export function normalizeRole(role: Role): NormalizedRole {
  if (role === "owner") return "head_doctor";
  if (role === "doctor") return "working_doctor";
  return role;
}

export function getDashboardPath(role: Role) {
  const normalized = normalizeRole(role);
  if (normalized === "head_doctor") return "/(head)/dashboard";
  if (normalized === "working_doctor") return "/(doctor)/dashboard";
  return "/(reception)/dashboard";
}

export function getRoleSegment(role: Role) {
  const normalized = normalizeRole(role);
  if (normalized === "head_doctor") return "(head)";
  if (normalized === "working_doctor") return "(doctor)";
  return "(reception)";
}

export function getRoleLabel(role: Role) {
  const normalized = normalizeRole(role);
  if (normalized === "head_doctor") return "Head Doctor / Owner";
  if (normalized === "working_doctor") return "Working Doctor";
  return "Receptionist";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function invoiceStatus(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

function normalizeForAudit(value: unknown) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function rangeForPreset(preset: "today" | "yesterday" | "week" | "month") {
  const start = new Date();
  const end = new Date();

  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }

  if (preset === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }

  if (preset === "month") {
    start.setDate(1);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start: start.toISOString(), end: end.toISOString() };
}

function isoDateBoundary(value: string, endOfDay = false) {
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dashboardWarn(label: string, error: unknown) {
  if (!error) return;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);

  console.warn(`${label}:`, message);
}

async function safeDashboardQuery(label: string, query: PromiseLike<any>) {
  try {
    const result = await query;
    if (result?.error) dashboardWarn(label, result.error);
    return result ?? { data: [], error: null, count: 0 };
  } catch (error) {
    dashboardWarn(label, error);
    return { data: [], error, count: 0 };
  }
}

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function clampUploadPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function emitUploadProgress(
  onProgress: ((progress: UploadProgressState) => void) | undefined,
  progress: UploadProgressState
) {
  onProgress?.({
    ...progress,
    percent: clampUploadPercent(progress.percent),
  });
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function storageUploadError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.message || parsed.error || `Storage upload failed with status ${status}`;
  } catch {
    return body || `Storage upload failed with status ${status}`;
  }
}

async function readFileBlob(uri: string) {
  const fileResponse = await fetch(uri);
  if (!fileResponse.ok) {
    throw new Error("Unable to read the selected file.");
  }

  return fileResponse.blob();
}

async function uploadBlobToUrlWithProgress(input: {
  url: string;
  method: "POST" | "PUT";
  body: Blob;
  headers: Record<string, string>;
  onProgress?: (progress: UploadProgressState) => void;
  startPercent: number;
  endPercent: number;
  message: string;
}) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(input.method, input.url);
    Object.entries(input.headers).forEach(([key, value]) => {
      if (value) xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      const totalBytes = event.lengthComputable ? event.total : input.body.size;
      const rawPercent = totalBytes > 0 ? event.loaded / totalBytes : 0;

      emitUploadProgress(input.onProgress, {
        phase: "uploading",
        percent: input.startPercent + rawPercent * (input.endPercent - input.startPercent),
        bytesSent: event.loaded,
        totalBytes,
        message: input.message,
      });
    };

    xhr.onerror = () => reject(new Error("Network error while uploading file."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        emitUploadProgress(input.onProgress, {
          phase: "saving",
          percent: input.endPercent,
          bytesSent: input.body.size,
          totalBytes: input.body.size,
          message: "Upload received, saving patient record",
        });
        resolve();
        return;
      }

      reject(new Error(storageUploadError(xhr.status, xhr.responseText)));
    };

    xhr.send(input.body);
  });
}

async function uploadSupabaseStorageObjectWithProgress(input: {
  bucket: "prescriptions" | "xrays" | "patient-files";
  storagePath: string;
  uri: string;
  mimeType?: string | null;
  onProgress?: (progress: UploadProgressState) => void;
}): Promise<StorageUploadResult> {
  emitUploadProgress(input.onProgress, {
    phase: "preparing",
    percent: 0,
    message: "Preparing selected file",
  });

  try {
    const body = await readFileBlob(input.uri);
    const uploadUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${input.bucket}/${encodeStoragePath(
      input.storagePath
    )}`;
    const { data: sessionData } = await supabase.auth.getSession();
    const bearerToken = sessionData.session?.access_token ?? supabaseAnonKey;

    emitUploadProgress(input.onProgress, {
      phase: "uploading",
      percent: 3,
      bytesSent: 0,
      totalBytes: body.size,
      message: "Starting secure upload",
    });

    await uploadBlobToUrlWithProgress({
      url: uploadUrl,
      method: "POST",
      body,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${bearerToken}`,
        "cache-control": "max-age=31536000, immutable",
        "content-type": input.mimeType || body.type || "application/octet-stream",
        "x-upsert": "false",
      },
      onProgress: input.onProgress,
      startPercent: 3,
      endPercent: 93,
      message: "Uploading file",
    });
  } catch (progressUploadError) {
    emitUploadProgress(input.onProgress, {
      phase: "uploading",
      percent: 35,
      message: "Retrying secure upload",
    });

    const base64 = await FileSystem.readAsStringAsync(input.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);

    const { error: uploadError } = await supabase.storage
      .from(input.bucket)
      .upload(input.storagePath, bytes, {
        contentType: input.mimeType ?? "application/octet-stream",
        cacheControl: "31536000",
      });

    if (uploadError) {
      const originalMessage =
        progressUploadError instanceof Error ? progressUploadError.message : "Progress upload failed";
      throw new Error(`${uploadError.message}\n${originalMessage}`);
    }

    emitUploadProgress(input.onProgress, {
      phase: "saving",
      percent: 93,
      message: "Upload received, saving patient record",
    });
  }

  const { data: publicUrl } = supabase.storage
    .from(input.bucket)
    .getPublicUrl(input.storagePath);

  return {
    provider: "supabase",
    storagePath: input.storagePath,
    publicUrl: publicUrl.publicUrl,
  };
}

export async function getCurrentProfile(options?: CacheOptions) {
  const now = Date.now();
  if (!options?.force && cachedProfile && cachedProfile.expiresAt > now) {
    return cachedProfile.profile;
  }

  if (!options?.force && profileLoadPromise) {
    return profileLoadPromise;
  }

  profileLoadPromise = loadCurrentProfile();

  try {
    return await profileLoadPromise;
  } finally {
    profileLoadPromise = null;
  }
}

async function loadCurrentProfile() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) {
    cachedProfile = {
      userId: "",
      profile: null,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    };
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .eq("active", true)
    .maybeSingle<Profile>();

  if (error) throw error;
  cachedProfile = {
    userId: authData.user.id,
    profile: data,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  };
  return data;
}

export async function createOwnerClinic(input: {
  clinicName: string;
  ownerName: string;
  phone?: string;
  email?: string;
  address?: string;
}) {
  const { data, error } = await supabase.rpc("create_owner_clinic", {
    clinic_name: input.clinicName,
    owner_name: input.ownerName,
    clinic_phone: input.phone || null,
    clinic_email: input.email || null,
    clinic_address: input.address || null,
  });

  if (error) throw error;
  invalidateSupabaseCache();
  return data as Profile;
}

export async function acceptStaffInviteByCode(code: string) {
  const { data, error } = await supabase.rpc("accept_staff_invite_by_code", {
    code: code.trim().toUpperCase(),
  });

  if (error) throw error;
  invalidateSupabaseCache();
  return data as Profile;
}

export async function acceptStaffInvite() {
  const { data, error } = await supabase.rpc("accept_staff_invite");
  if (error) throw error;
  invalidateSupabaseCache();
  return data as Profile;
}

export async function getDashboardStats(options?: CacheOptions): Promise<DashboardStats> {
  return cachedQuery(
    "dashboard:stats",
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const todayStart = startOfToday();
      const todayEnd = endOfToday();

      const [
        patients,
        appointments,
        invoices,
        todayPayments,
        todayInvoices,
        pendingCharges,
        paidChargesToday,
      ] = await Promise.all([
        safeDashboardQuery(
          "Dashboard patients query failed",
          supabase
            .from("patients")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })
            .limit(5)
        ),

        safeDashboardQuery(
          "Dashboard appointments query failed",
          supabase
            .from("appointments")
            .select("id,clinic_id,patient_id,doctor_id,appointment_time,status,notes,created_at,patients(id,name,phone)")
            .gte("appointment_time", todayStart)
            .lte("appointment_time", todayEnd)
            .in("status", ["scheduled", "waiting", "checked_in", "booked"])
            .order("appointment_time", { ascending: true })
        ),

        safeDashboardQuery(
          "Dashboard invoices query failed",
          supabase
            .from("invoices")
            .select("total_amount, paid_amount, due_amount, status")
            .gt("due_amount", 0)
            .in("status", ["unpaid", "partial"])
        ),

        safeDashboardQuery(
          "Dashboard payments query failed",
          supabase
            .from("payments")
            .select("amount, created_at")
            .gte("created_at", todayStart)
            .lte("created_at", todayEnd)
        ),

        safeDashboardQuery(
          "Dashboard today invoices query failed",
          supabase
            .from("invoices")
            .select("paid_amount, created_at")
            .gte("created_at", todayStart)
            .lte("created_at", todayEnd)
        ),

        safeDashboardQuery(
          "Dashboard pending charges query failed",
          supabase
            .from("charges")
            .select("amount, payment_status")
            .in("payment_status", ["pending", "partial"])
        ),

        safeDashboardQuery(
          "Dashboard paid charges query failed",
          supabase
            .from("charges")
            .select("amount, payment_status, created_at")
            .eq("payment_status", "paid")
            .gte("created_at", todayStart)
            .lte("created_at", todayEnd)
        ),
      ]);

      const patientRows = patients.error || !Array.isArray(patients.data) ? [] : patients.data;
      const appointmentRows =
        appointments.error || !Array.isArray(appointments.data) ? [] : appointments.data;
      const invoiceRows = invoices.error || !Array.isArray(invoices.data) ? [] : invoices.data;
      const todayPaymentRows =
        todayPayments.error || !Array.isArray(todayPayments.data) ? [] : todayPayments.data;
      const todayInvoiceRows =
        todayInvoices.error || !Array.isArray(todayInvoices.data) ? [] : todayInvoices.data;
      const pendingChargeRows =
        pendingCharges.error || !Array.isArray(pendingCharges.data) ? [] : pendingCharges.data;
      const paidChargeRows =
        paidChargesToday.error || !Array.isArray(paidChargesToday.data) ? [] : paidChargesToday.data;

      const paymentRevenue = todayPaymentRows.reduce(
        (sum: number, row: { amount?: number | string | null }) => sum + Number(row.amount || 0),
        0
      );

      const invoicePaidToday = todayInvoiceRows.reduce(
        (sum: number, row: { paid_amount?: number | string | null }) =>
          sum + Number(row.paid_amount || 0),
        0
      );

      const paidChargesRevenue = paidChargeRows.reduce(
        (sum: number, row: { amount?: number | string | null }) => sum + Number(row.amount || 0),
        0
      );

      // Prefer actual payments. If no payment rows exist yet, fallback to invoices/charges.
      const todayRevenue =
        paymentRevenue > 0 ? paymentRevenue : invoicePaidToday + paidChargesRevenue;

      const invoicePending = invoiceRows.reduce(
        (sum: number, row: { due_amount?: number | string | null }) =>
          sum + Number(row.due_amount || 0),
        0
      );

      const chargePending = pendingChargeRows.reduce(
        (sum: number, row: { amount?: number | string | null }) => sum + Number(row.amount || 0),
        0
      );

      return {
        totalPatients: patients.count ?? 0,
        recentPatients: patientRows as Patient[],
        todayAppointments: appointmentRows.length,
        todayAppointmentList: appointmentRows as Appointment[],
        pendingPayments: invoicePending + chargePending,
        todayRevenue,
      };
    },
    options
  );
}

export async function getWorkflowDashboardSummary(
  options?: CacheOptions
): Promise<WorkflowDashboardSummary | null> {
  return cachedQuery(
    "dashboard:workflow-summary",
    DASHBOARD_CACHE_TTL_MS,
    async () => {
      const result = await safeDashboardQuery(
        "Dashboard workflow summary query failed",
        supabase.rpc("get_workflow_dashboard_summary")
      );

      if (result.error) return null;

      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      return (row ?? null) as WorkflowDashboardSummary | null;
    },
    options
  );
}


export async function getPatients(options?: CacheOptions) {
  return cachedQuery(
    "patients:list",
    PATIENT_LIST_CACHE_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id,clinic_id,patient_code,name,gender,age,dob,phone,email,address,emergency_contact,created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Patient[];
    },
    options
  );
}

export async function searchPatients(query: string) {
  const term = query.trim().replace(/[,()%]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  if (!term) return getPatients();

  const { data, error } = await supabase
    .from("patients")
    .select("id,clinic_id,patient_code,name,gender,age,dob,phone,email,address,emergency_contact,created_at")
    .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return data as Patient[];
}

export async function searchPatientsAdvanced(input: {
  query?: string;
  dateField?: "registered" | "visit" | "appointment" | "followup" | "payment";
  preset?: "all" | "today" | "yesterday" | "week" | "month" | "custom";
  startDate?: string;
  endDate?: string;
}) {
  const term = input.query?.trim() ?? "";
  const preset = input.preset ?? "all";
  const dateField = input.dateField ?? "registered";

  let start: string | null = null;
  let end: string | null = null;

  if (preset !== "all") {
    if (preset === "custom") {
      start = input.startDate ? isoDateBoundary(input.startDate) : null;
      end = input.endDate ? isoDateBoundary(input.endDate, true) : null;
    } else {
      const range = rangeForPreset(preset);
      start = range.start;
      end = range.end;
    }
  }

  let patientIds: string[] | null = null;

  if (start && end && dateField !== "registered") {
    const table =
      dateField === "visit" || dateField === "followup"
        ? "patient_visits"
        : dateField === "appointment"
        ? "appointments"
        : "payments";

    const column =
      dateField === "visit"
        ? "visit_date"
        : dateField === "followup"
        ? "next_appointment_date"
        : dateField === "appointment"
        ? "appointment_time"
        : "created_at";

    const { data, error } = await supabase
      .from(table)
      .select("patient_id")
      .gte(column, start)
      .lte(column, end);

    if (error) throw error;

    patientIds = Array.from(
      new Set((data ?? []).map((row: { patient_id?: string | null }) => row.patient_id).filter(Boolean))
    ) as string[];

    if (!patientIds.length) return [];
  }

  let queryBuilder = supabase
    .from("patients")
    .select("*")
    .order("created_at", { ascending: false });

  if (term) {
    queryBuilder = queryBuilder.or(
      `name.ilike.%${term}%,phone.ilike.%${term}%,patient_code.ilike.%${term}%`
    );
  }

  if (start && end && dateField === "registered") {
    queryBuilder = queryBuilder.gte("created_at", start).lte("created_at", end);
  }

  if (patientIds) {
    queryBuilder = queryBuilder.in("id", patientIds);
  }

  const { data, error } = await queryBuilder;

  if (error) throw error;
  return data as Patient[];
}

async function getClinicPatientLimitStatusForClinic(
  clinicId: string
): Promise<ClinicPatientLimitStatus> {
  const { count, error } = await supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);

  if (error) throw error;

  return {
    count: count ?? 0,
    limit: FREE_PATIENT_LIMIT,
    remaining: null,
    unlimited: true,
    level: "none",
    message: CAPDENT_CURRENTLY_FREE_MESSAGE,
  };
}

export async function getClinicPatientLimitStatus() {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  return getClinicPatientLimitStatusForClinic(profile.clinic_id);
}

async function assertCanCreatePatient(clinicId: string) {
  const usage = await getClinicPatientLimitStatusForClinic(clinicId);
  if (usage.level === "blocked") throw new Error(usage.message);
  return usage;
}

export async function createPatient(input: {
  name: string;
  gender?: string;
  age?: number;
  phone?: string;
  email?: string;
  address?: string;
  emergency_contact?: string;
  medical_history?: Partial<MedicalHistory>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  await assertCanCreatePatient(profile.clinic_id);

  const { medical_history, ...patientInput } = input;

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      ...patientInput,
      clinic_id: profile.clinic_id,
      patient_code: `DMS-${Date.now().toString().slice(-6)}`,
    })
    .select("*")
    .single<Patient>();

  if (error) throw error;

  invalidateAppDataScopes(["dashboard", "patients"]);
  await createMedicalHistory(patient.id, medical_history ?? {});
  return patient;
}

function optionalDateToIso(value?: string | null) {
  const clean = value?.trim();
  if (!clean) return undefined;

  const date = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toISOString();
}

export async function createOldPatient(input: {
  name: string;
  gender?: string;
  age?: number;
  phone?: string;
  email?: string;
  address?: string;
  emergency_contact?: string;
  old_patient_code?: string;
  registered_date?: string;
  last_visit_date?: string;
  old_record_notes?: string;
  opening_balance?: number;
  opening_balance_note?: string;
  medical_history?: Partial<MedicalHistory>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  await assertCanCreatePatient(profile.clinic_id);

  const registeredAt = optionalDateToIso(input.registered_date);
  const lastVisitAt = optionalDateToIso(input.last_visit_date);
  const oldCode = input.old_patient_code?.trim();
  const balance = Math.max(Number(input.opening_balance ?? 0), 0);

  const { medical_history, old_record_notes, opening_balance_note, ...patientInput } = input;
  const { old_patient_code, registered_date, last_visit_date, opening_balance, ...cleanPatientInput } = patientInput;

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      ...cleanPatientInput,
      clinic_id: profile.clinic_id,
      patient_code: oldCode || `OLD-${Date.now().toString().slice(-6)}`,
      created_at: registeredAt ?? new Date().toISOString(),
    })
    .select("*")
    .single<Patient>();

  if (error) throw error;

  invalidateAppDataScopes(["dashboard", "patients", "payments"]);
  await createMedicalHistory(patient.id, medical_history ?? {});

  if (lastVisitAt || old_record_notes?.trim()) {
    const { error: visitError } = await supabase.from("patient_visits").insert({
      clinic_id: profile.clinic_id,
      patient_id: patient.id,
      doctor_id: profile.id,
      visit_date: lastVisitAt ?? new Date().toISOString(),
      chief_complaint: "Old patient record",
      diagnosis: null,
      doctor_notes: old_record_notes?.trim() || "Old clinic record imported into CapDent.",
      next_appointment_date: null,
    });

    if (visitError) throw visitError;
  }

  if (balance > 0) {
    const { error: invoiceError } = await supabase.from("invoices").insert({
      clinic_id: profile.clinic_id,
      patient_id: patient.id,
      visit_id: null,
      total_amount: balance,
      paid_amount: 0,
      due_amount: balance,
      status: "unpaid",
    });

    if (invoiceError) throw invoiceError;
  }

  invalidateAppDataScopes(["dashboard", "patients", "payments"]);
  return patient;
}

export async function getPatientById(id: string) {
  const [patient, history, visits, treatments, invoices, files] = await Promise.all([
    supabase.from("patients").select("*").eq("id", id).single<Patient>(),
    supabase
      .from("medical_history")
      .select("*")
      .eq("patient_id", id)
      .maybeSingle<MedicalHistory>(),
    getPatientVisits(id),
    getPatientTreatments(id),
    getPatientInvoices(id),
    getPatientFiles(id),
  ]);

  if (patient.error) throw patient.error;
  if (history.error) throw history.error;

  return {
    patient: patient.data,
    history: history.data,
    visits,
    treatments,
    invoices,
    files,
  };
}

export async function updatePatient(id: string, input: Partial<Patient>) {
  const { data, error } = await supabase
    .from("patients")
    .update(input)
    .eq("id", id)
    .select("*")
    .single<Patient>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "patients", "appointments", "payments"]);
  return data;
}

export async function updatePatientWithAudit(
  id: string,
  input: Pick<Partial<Patient>, "name" | "phone" | "age" | "gender" | "address">,
  reason?: string
) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { data: before, error: beforeError } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .single<Patient>();

  if (beforeError) throw beforeError;

  const updated = await updatePatient(id, input);

  const fields = ["name", "phone", "age", "gender", "address"] as const;
  const auditRows = fields
    .filter((field) => normalizeForAudit(before[field]) !== normalizeForAudit(input[field]))
    .map((field) => ({
      clinic_id: profile.clinic_id,
      patient_id: id,
      changed_by: profile.id,
      field_name: field,
      old_value: normalizeForAudit(before[field]),
      new_value: normalizeForAudit(input[field]),
      reason: reason?.trim() || null,
    }));

  if (auditRows.length) {
    const { error: auditError } = await supabase.from("patient_audit_logs").insert(auditRows);
    if (auditError) {
      console.warn("Patient audit insert failed:", auditError.message);
    }
  }

  return updated;
}

export async function getPatientAuditLogs(patientId: string) {
  const { data, error } = await supabase
    .from("patient_audit_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.warn("Patient audit load failed:", error.message);
    return [] as PatientAuditLog[];
  }

  return data as PatientAuditLog[];
}

export async function createMedicalHistory(
  patientId: string,
  input: Partial<MedicalHistory>
) {
  const { data, error } = await supabase
    .from("medical_history")
    .insert({
      patient_id: patientId,
      heart_issue: false,
      kidney_issue: false,
      brain_issue: false,
      diabetes: false,
      blood_pressure: false,
      ...input,
    })
    .select("*")
    .single<MedicalHistory>();

  if (error) throw error;
  return data;
}

export async function updateMedicalHistory(
  patientId: string,
  input: Partial<MedicalHistory>
) {
  const { data, error } = await supabase
    .from("medical_history")
    .update(input)
    .eq("patient_id", patientId)
    .select("*")
    .single<MedicalHistory>();

  if (error) throw error;
  return data;
}

export async function createAppointment(input: {
  patient_id: string;
  doctor_id?: string | null;
  appointment_time: string;
  notes?: string;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { data, error } = await supabase
    .from("appointments")
    .insert({ ...input, clinic_id: profile.clinic_id, status: "scheduled" })
    .select("*")
    .single<Appointment>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "appointments"]);
  return data;
}

export async function getTodayAppointments(options?: CacheOptions) {
  return cachedQuery(
    "appointments:today",
    APPOINTMENT_CACHE_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*, patients(id,name,phone)")
        .gte("appointment_time", startOfToday())
        .lte("appointment_time", endOfToday())
        .order("appointment_time", { ascending: true });

      if (error) throw error;
      return data as Appointment[];
    },
    options
  );
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus) {
  const { data, error } = await supabase
    .from("appointments")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single<Appointment>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "appointments"]);
  return data;
}

async function appointmentNotePatch(id: string, note?: string) {
  const cleanNote = note?.trim();
  if (!cleanNote) return {};

  const { data, error } = await supabase
    .from("appointments")
    .select("notes")
    .eq("id", id)
    .single<Pick<Appointment, "notes">>();

  if (error) throw error;

  return {
    notes: [data?.notes?.trim(), cleanNote].filter(Boolean).join("\n"),
  };
}

export async function rescheduleAppointment(id: string, appointment_time: string, note?: string) {
  const noteUpdate = await appointmentNotePatch(id, note);
  const { data, error } = await supabase
    .from("appointments")
    .update({ appointment_time, status: "scheduled", ...noteUpdate })
    .eq("id", id)
    .select("*")
    .single<Appointment>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "appointments"]);
  return data;
}

export async function closeWaitingAppointment(id: string, note?: string) {
  const noteUpdate = await appointmentNotePatch(id, note);
  const { data, error } = await supabase
    .from("appointments")
    .update({ status: "no_show", ...noteUpdate })
    .eq("id", id)
    .select("*")
    .single<Appointment>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "appointments"]);
  return data;
}

export async function createVisit(input: {
  patient_id: string;
  doctor_id?: string | null;
  chief_complaint?: string;
  diagnosis?: string;
  doctor_notes?: string;
  next_appointment_date?: string | null;
  treatment_name?: string;
  treatment_cost?: number;
  treatment_category?: string;
  treatment_status?: Treatment["status"];
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { doctor_id, treatment_name, treatment_cost, treatment_category, treatment_status, ...visitInput } = input;

  const { data: visit, error } = await supabase
    .from("patient_visits")
    .insert({
      ...visitInput,
      clinic_id: profile.clinic_id,
      doctor_id: doctor_id ?? profile.id,
      visit_date: new Date().toISOString(),
      visit_status: "completed",
    })
    .select("*")
    .single<Visit>();

  if (error) throw error;

  if (treatment_name && treatment_cost !== undefined) {
    await createTreatment({
      patient_id: input.patient_id,
      visit_id: visit.id,
      treatment_name,
      cost: treatment_cost,
      status: treatment_status ?? "planned",
      category: treatment_category,
    });
  }

  invalidateAppDataScopes(["dashboard", "patients", "appointments"]);
  return visit;
}

export type AtomicVisitTreatmentInput = {
  treatment_name: string;
  category?: string | null;
  description?: string | null;
  cost: number;
  paid_amount: number;
  payment_method?: string;
  status: "planned" | "ongoing" | "completed";
};

export async function saveVisitWithToothChart(input: {
  patient_id: string;
  doctor_id: string;
  chief_complaint: string;
  doctor_notes?: string | null;
  next_appointment_date?: string | null;
  followup_notes?: string | null;
  existing_treatment_id?: string | null;
  existing_treatment_status?: "planned" | "ongoing" | "completed" | null;
  existing_payment_amount?: number;
  existing_payment_method?: string | null;
  treatments: AtomicVisitTreatmentInput[];
  chart_entries: Record<string, unknown>[];
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { data, error } = await supabase.rpc(
    "save_visit_with_tooth_chart",
    {
      p_patient_id: input.patient_id,
      p_doctor_id: input.doctor_id,
      p_chief_complaint: input.chief_complaint,
      p_doctor_notes: input.doctor_notes ?? null,
      p_next_appointment_date: input.next_appointment_date ?? null,
      p_followup_notes: input.followup_notes ?? null,
      p_existing_treatment_id: input.existing_treatment_id ?? null,
      p_existing_treatment_status:
        input.existing_treatment_status ?? null,
      p_existing_payment_amount: Number(
        input.existing_payment_amount ?? 0
      ),
      p_existing_payment_method:
        input.existing_payment_method ?? "Cash",
      p_treatments: input.treatments,
      p_chart_entries: input.chart_entries,
    }
  );

  if (error) throw error;
  invalidateAppDataScopes([
    "dashboard",
    "patients",
    "appointments",
    "payments",
  ]);
  return data as {
    visit_id: string;
    treatment_ids: string[];
    invoice_ids: string[];
    appointment_id: string | null;
    queue_rows_completed: number;
    chart_entries_created: number;
  };
}

export async function getPatientVisits(patientId: string) {
  const { data, error } = await supabase
    .from("patient_visits")
    .select("*")
    .eq("patient_id", patientId)
    .order("visit_date", { ascending: false });

  if (error) throw error;
  return data as Visit[];
}

export async function createTreatment(input: {
  patient_id: string;
  visit_id?: string | null;
  treatment_name: string;
  description?: string;
  cost: number;
  status?: Treatment["status"];
  category?: string;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { data, error } = await supabase
    .from("treatments")
    .insert({
      patient_id: input.patient_id,
      visit_id: input.visit_id ?? null,
      treatment_name: input.treatment_name,
      description: input.description ?? null,
      cost: input.cost,
      status: input.status ?? "planned",
      category: input.category ?? null,
      clinic_id: profile.clinic_id,
    })
    .select("*")
    .single<Treatment>();

  if (error) throw error;
  invalidateAppDataScopes(["dashboard", "patients"]);
  return data;
}

export async function getPatientTreatments(patientId: string) {
  const { data, error } = await supabase
    .from("treatments")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Treatment[];
}

export async function uploadPatientFile(input: {
  patient_id: string;
  visit_id?: string | null;
  file_type: FileType;
  bucket: "prescriptions" | "xrays" | "patient-files";
  uri: string;
  file_name: string;
  mimeType?: string | null;
  file_note?: string | null;
  xray_amount?: number;
  xray_fee_status?: "not_applicable" | "pending" | "paid" | "waived";
  onProgress?: (progress: UploadProgressState) => void;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  emitUploadProgress(input.onProgress, {
    phase: "preparing",
    percent: 1,
    message: "Optimizing image without visible quality loss",
  });

  const optimized = await optimizeUploadImage(input.uri, input.file_type);
  const optimizedFileName = withImageExtension(input.file_name, optimized.extension);
  const storagePath = `${profile.clinic_id}/${input.patient_id}/${Date.now()}-${optimizedFileName}`;
  const storageResult = await uploadSupabaseStorageObjectWithProgress({
    bucket: input.bucket,
    storagePath,
    uri: optimized.uri,
    mimeType: optimized.mimeType,
    onProgress: input.onProgress,
  });

  emitUploadProgress(input.onProgress, {
    phase: "saving",
    percent: 96,
    message: "Saving file details",
  });

  const filePayload = {
    clinic_id: profile.clinic_id,
    patient_id: input.patient_id,
    visit_id: input.visit_id ?? null,
    file_type: input.file_type,
    file_url: storageResult.publicUrl,
    file_name: optimizedFileName,
    storage_bucket: input.bucket,
    storage_path: storageResult.storagePath,
    mime_type: optimized.mimeType,
    original_size_bytes: optimized.originalSizeBytes,
    stored_size_bytes: optimized.storedSizeBytes,
    uploaded_by: profile.id,
    file_note: input.file_note ?? null,
    xray_amount: input.file_type === "xray" ? Number(input.xray_amount ?? 0) : 0,
    xray_fee_status:
      input.file_type === "xray" ? input.xray_fee_status ?? "not_applicable" : "not_applicable",
  };

  let response = await supabase
    .from("files")
    .insert(filePayload)
    .select("*")
    .single<PatientFile>();

  if (response.error && response.error.code === "PGRST204") {
    response = await supabase
      .from("files")
      .insert({
        clinic_id: profile.clinic_id,
        patient_id: input.patient_id,
        visit_id: input.visit_id ?? null,
        file_type: input.file_type,
        file_url: storageResult.publicUrl,
        file_name: optimizedFileName,
        storage_bucket: input.bucket,
        storage_path: storageResult.storagePath,
        mime_type: optimized.mimeType,
        original_size_bytes: optimized.originalSizeBytes,
        stored_size_bytes: optimized.storedSizeBytes,
        uploaded_by: profile.id,
      })
      .select("*")
      .single<PatientFile>();
  }

  if (response.error) {
    const { error: cleanupError } = await supabase.storage
      .from(input.bucket)
      .remove([storageResult.storagePath]);

    if (cleanupError) {
      console.warn("Unable to remove orphaned Storage upload:", cleanupError.message);
    }

    throw response.error;
  }

  const xrayAmount = Number(input.xray_amount ?? 0);
  if (input.file_type === "xray" && xrayAmount > 0 && input.xray_fee_status !== "waived") {
    await createInvoice({
      patient_id: input.patient_id,
      visit_id: input.visit_id ?? null,
      total_amount: xrayAmount,
      paid_amount: input.xray_fee_status === "paid" ? xrayAmount : 0,
      payment_category: "xray_fee",
      notes: input.file_note ?? "X-ray fee",
    });
  }

  emitUploadProgress(input.onProgress, {
    phase: "complete",
    percent: 100,
    message: "Upload complete",
  });

  return response.data;
}

export async function getPatientFiles(patientId: string) {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as PatientFile[];
}

async function deletePatientFileDirect(fileId: string) {
  const { data, error } = await supabase
    .from("files")
    .delete()
    .eq("id", fileId)
    .select("id");

  if (error) throw error;

  if (!data?.length) {
    throw new Error("File was not deleted. Run supabase/dms-upload-fix.sql in Supabase SQL Editor, then try again.");
  }
}

type PatientFileDeletionTarget = Pick<
  PatientFile,
  "id" | "file_type" | "file_url" | "storage_bucket" | "storage_path"
>;

function defaultPatientFileBucket(fileType: FileType) {
  if (fileType === "xray") return "xrays";
  if (fileType === "prescription") return "prescriptions";
  return "patient-files";
}

function decodeStorageUrlPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function storageReferenceFromPatientFile(file: PatientFileDeletionTarget) {
  if (file.storage_bucket && file.storage_path) {
    return { bucket: file.storage_bucket, path: file.storage_path };
  }

  const value = file.file_url?.trim();
  if (!value) return null;

  if (value.startsWith("supabase://")) {
    const objectReference = value.slice("supabase://".length).split("?")[0];
    const separator = objectReference.indexOf("/");
    if (separator > 0) {
      return {
        bucket: decodeStorageUrlPart(objectReference.slice(0, separator)),
        path: decodeStorageUrlPart(objectReference.slice(separator + 1)),
      };
    }
  }

  const markers = [
    "/storage/v1/object/public/",
    "/storage/v1/object/sign/",
    "/storage/v1/object/authenticated/",
  ];

  for (const marker of markers) {
    const markerIndex = value.indexOf(marker);
    if (markerIndex === -1) continue;

    const objectReference = value.slice(markerIndex + marker.length).split("?")[0];
    const separator = objectReference.indexOf("/");
    if (separator <= 0) continue;

    return {
      bucket: decodeStorageUrlPart(objectReference.slice(0, separator)),
      path: decodeStorageUrlPart(objectReference.slice(separator + 1)),
    };
  }

  return null;
}

async function deletePatientFileStorageObject(file: PatientFileDeletionTarget) {
  const reference = storageReferenceFromPatientFile(file);
  const bucket = reference?.bucket || defaultPatientFileBucket(file.file_type);
  const path = reference?.path;

  // Legacy external links do not point to Supabase Storage and have no object to remove.
  if (!path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`Stored file could not be deleted: ${error.message}`);
  }
}

export async function deletePatientFileRecord(fileId: string) {
  const { data: file, error: lookupError } = await supabase
    .from("files")
    .select("id,file_type,file_url,storage_bucket,storage_path")
    .eq("id", fileId)
    .maybeSingle<PatientFileDeletionTarget>();

  if (lookupError) throw lookupError;
  if (!file) {
    throw new Error("File not found or you do not have permission to delete it.");
  }

  await deletePatientFileStorageObject(file);

  const { data, error } = await supabase.rpc("delete_patient_file", {
    p_file_id: fileId,
  });

  if (error) {
    const message = error.message || "";
    const functionMissing =
      error.code === "PGRST202" ||
      message.includes("delete_patient_file") ||
      message.includes("Could not find the function");

    if (functionMissing) {
      await deletePatientFileDirect(fileId);
      return true;
    }

    throw error;
  }

  if (data === false) {
    throw new Error("File not found or you do not have permission to delete it.");
  }

  return true;
}

export async function createInvoice(input: {
  patient_id: string;
  visit_id?: string | null;
  total_amount: number;
  paid_amount?: number;
  payment_category?: PaymentCategory;
  notes?: string | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const paid = Number(input.paid_amount ?? 0);
  const due = Math.max(Number(input.total_amount) - paid, 0);

  const payload = {
    ...input,
    clinic_id: profile.clinic_id,
    paid_amount: paid,
    due_amount: due,
    status: invoiceStatus(Number(input.total_amount), paid),
    payment_category: input.payment_category ?? "treatment_fee",
    notes: input.notes ?? null,
  };

  let response = await supabase
    .from("invoices")
    .insert(payload)
    .select("*")
    .single<Invoice>();

  if (response.error && response.error.code === "PGRST204") {
    response = await supabase
      .from("invoices")
      .insert({
        patient_id: input.patient_id,
        visit_id: input.visit_id ?? null,
        total_amount: input.total_amount,
        clinic_id: profile.clinic_id,
        paid_amount: paid,
        due_amount: due,
        status: invoiceStatus(Number(input.total_amount), paid),
      })
      .select("*")
      .single<Invoice>();
  }

  if (response.error) throw response.error;
  invalidateAppDataScopes(["dashboard", "payments"]);

  if (paid > 0) {
    let paymentResponse = await supabase
      .from("payments")
      .insert({
        clinic_id: profile.clinic_id,
        invoice_id: response.data.id,
        patient_id: input.patient_id,
        amount: paid,
        payment_method: "Cash",
        notes: input.notes ?? "Invoice paid at creation",
        payment_category: input.payment_category ?? "treatment_fee",
        collected_by: profile.id,
      });

    if (paymentResponse.error && paymentResponse.error.code === "PGRST204") {
      paymentResponse = await supabase
        .from("payments")
        .insert({
          clinic_id: profile.clinic_id,
          invoice_id: response.data.id,
          patient_id: input.patient_id,
          amount: paid,
          payment_method: "Cash",
          notes: input.notes ?? "Invoice paid at creation",
        });
    }

    if (paymentResponse.error) throw paymentResponse.error;
  }

  invalidateAppDataScopes(["dashboard", "payments"]);
  return response.data;
}

export async function addPayment(input: {
  invoice_id: string;
  patient_id: string;
  amount: number;
  payment_method?: string;
  notes?: string;
  payment_category?: PaymentCategory;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", input.invoice_id)
    .single<Invoice>();

  if (invoiceError) throw invoiceError;

  let paymentResponse = await supabase
    .from("payments")
    .insert({
      ...input,
      clinic_id: profile.clinic_id,
      collected_by: profile.id,
      payment_category: input.payment_category ?? "pending_collection",
    });

  if (paymentResponse.error && paymentResponse.error.code === "PGRST204") {
    paymentResponse = await supabase
      .from("payments")
      .insert({
        invoice_id: input.invoice_id,
        patient_id: input.patient_id,
        amount: input.amount,
        payment_method: input.payment_method,
        notes: input.notes,
        clinic_id: profile.clinic_id,
      });
  }

  if (paymentResponse.error) throw paymentResponse.error;
  invalidateAppDataScopes(["dashboard", "payments"]);

  const paid = Number(invoice.paid_amount) + Number(input.amount);
  const due = Math.max(Number(invoice.total_amount) - paid, 0);

  const { data, error: updateError } = await supabase
    .from("invoices")
    .update({
      paid_amount: paid,
      due_amount: due,
      status: invoiceStatus(Number(invoice.total_amount), paid),
    })
    .eq("id", invoice.id)
    .select("*")
    .single<Invoice>();

  if (updateError) throw updateError;
  invalidateAppDataScopes(["dashboard", "payments"]);
  return data;
}

export async function getPatientInvoices(patientId: string) {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Invoice[];
}

export async function getPendingPayments(options?: CacheOptions) {
  return cachedQuery(
    "payments:pending",
    PAYMENT_CACHE_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, patients(id,name,phone)")
        .gt("due_amount", 0)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Invoice[];
    },
    options
  );
}

export async function getStaff(options?: CacheOptions) {
  return cachedQuery(
    "staff:list",
    STAFF_CACHE_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Profile[];
    },
    options
  );
}

export async function getStaffInvites(options?: CacheOptions) {
  return cachedQuery(
    "staff:invites",
    STAFF_CACHE_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("staff_invites")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as StaffInvite[];
    },
    options
  );
}

export async function createStaffInvite(input: {
  name: string;
  email?: string | null;
  role: "working_doctor" | "receptionist" | "doctor";
}) {
  const finalRole = input.role === "doctor" ? "working_doctor" : input.role;

  const { data, error } = await supabase.rpc("create_staff_invite", {
    invitee_name: input.name,
    invitee_email: input.email?.trim().toLowerCase() || null,
    invitee_role: finalRole,
  });

  if (error) throw error;
  invalidateAppDataCache("staff");
  return data as StaffInvite;
}

export async function sendStaffInviteEmail(inviteId: string) {
  const { data, error } = await supabase.functions.invoke("send-staff-invite-email", {
    body: { inviteId },
  });

  if (error) throw error;
  invalidateAppDataCache("staff");
  return data as { ok: boolean };
}
