import { getCurrentProfile, supabase } from "@/lib/supabase";

export type FinalizedInvoiceListItem = {
  id: string;
  patient_id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  currency_code: string;
  finalized_at: string;
  patient_name: string;
  patient_phone?: string | null;
};

export type InvoiceShareTokenResult = {
  token: string;
  expires_at: string;
};

function isMissingConsolidatedBilling(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("consolidated_bills");
}

export async function listRecentFinalizedInvoices(limit = 30): Promise<{
  backendReady: boolean;
  invoices: FinalizedInvoiceListItem[];
  reason?: string;
}> {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const safeLimit = Math.max(1, Math.min(Number(limit || 30), 100));
  const { data: bills, error: billError } = await supabase
    .from("consolidated_bills")
    .select("id,patient_id,invoice_number,total_amount,paid_at_finalization,due_at_finalization,currency_code,finalized_at")
    .eq("clinic_id", profile.clinic_id)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false })
    .limit(safeLimit);

  if (billError) {
    if (isMissingConsolidatedBilling(billError)) {
      return {
        backendReady: false,
        invoices: [],
        reason: "V28 consolidated billing has not been deployed to this environment yet.",
      };
    }
    throw billError;
  }

  const rows = bills || [];
  const patientIds = Array.from(new Set(rows.map((row: any) => row.patient_id).filter(Boolean)));
  let patientMap = new Map<string, { name: string; phone?: string | null }>();

  if (patientIds.length) {
    const { data: patients, error: patientError } = await supabase
      .from("patients")
      .select("id,name,phone")
      .eq("clinic_id", profile.clinic_id)
      .in("id", patientIds);
    if (patientError) throw patientError;
    patientMap = new Map(
      (patients || []).map((patient: any) => [
        String(patient.id),
        { name: String(patient.name || "Patient"), phone: patient.phone || null },
      ])
    );
  }

  return {
    backendReady: true,
    invoices: rows.map((row: any) => {
      const patient = patientMap.get(String(row.patient_id));
      return {
        id: String(row.id),
        patient_id: String(row.patient_id),
        invoice_number: String(row.invoice_number || "Invoice"),
        total_amount: Number(row.total_amount || 0),
        paid_amount: Number(row.paid_at_finalization || 0),
        due_amount: Number(row.due_at_finalization || 0),
        currency_code: String(row.currency_code || "INR"),
        finalized_at: String(row.finalized_at || ""),
        patient_name: patient?.name || "Patient",
        patient_phone: patient?.phone || null,
      };
    }),
  };
}

export async function createInvoiceShareToken(
  billId: string,
  ttlMinutes = 10080
): Promise<InvoiceShareTokenResult> {
  const cleanBillId = billId.trim();
  if (!cleanBillId) throw new Error("Final invoice ID is required");

  const { data, error } = await supabase.rpc("create_v28_invoice_share_token", {
    p_bill_id: cleanBillId,
    p_ttl_minutes: Math.max(15, Math.min(Number(ttlMinutes || 10080), 43200)),
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token || !row?.expires_at) throw new Error("Secure invoice token was not returned");
  return { token: String(row.token), expires_at: String(row.expires_at) };
}

export async function revokeInvoiceShareTokens(billId: string) {
  const cleanBillId = billId.trim();
  if (!cleanBillId) throw new Error("Final invoice ID is required");
  const { error } = await supabase.rpc("revoke_v28_invoice_share_tokens", {
    p_bill_id: cleanBillId,
  });
  if (error) throw error;
}
