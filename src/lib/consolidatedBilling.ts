import type { CapDentInvoiceSnapshot } from "@/lib/invoiceDocument";
import { getClinicBrand } from "@/lib/clinicBranding";
import { getCurrentProfile, supabase } from "@/lib/supabase";

export type ConsolidatedInvoiceCandidate = {
  invoice_id: string;
  invoice_type?: string | null;
  payment_category?: string | null;
  label: string;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  created_at: string;
};

export type ConsolidatedInvoiceCandidateResult = {
  backendReady: boolean;
  candidates: ConsolidatedInvoiceCandidate[];
  reason?: string;
};

export type FinalizedConsolidatedBill = {
  bill_id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  country_code: string;
  currency_code: string;
  finalized_at: string;
};

type ConsolidatedBillRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  invoice_number: string;
  status: string;
  country_code: string;
  currency_code: string;
  subtotal: number;
  total_amount: number;
  paid_at_finalization: number;
  due_at_finalization: number;
  notes?: string | null;
  finalized_at: string;
};

type ConsolidatedBillItemRow = {
  source_invoice_id: string;
  label: string;
  amount: number;
  paid_amount: number;
  due_amount: number;
  sort_order: number;
};

function isMissingBackend(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42883" ||
    code === "42P01" ||
    code === "PGRST202" ||
    code === "PGRST205" ||
    message.includes("get_v28_invoice_candidates") ||
    message.includes("finalize_v28_consolidated_bill") ||
    message.includes("consolidated_bills")
  );
}

export async function getConsolidatedInvoiceCandidates(
  patientId: string,
  options?: { since?: string | null }
): Promise<ConsolidatedInvoiceCandidateResult> {
  const cleanPatientId = patientId.trim();
  if (!cleanPatientId) {
    return { backendReady: true, candidates: [] };
  }

  const { data, error } = await supabase.rpc("get_v28_invoice_candidates", {
    p_patient_id: cleanPatientId,
    p_since: options?.since ?? null,
  });

  if (error) {
    if (isMissingBackend(error)) {
      return {
        backendReady: false,
        candidates: [],
        reason:
          "The V28 consolidated billing migration has not been deployed to this environment yet. Existing billing is unchanged.",
      };
    }
    throw error;
  }

  return {
    backendReady: true,
    candidates: ((data || []) as any[]).map((row) => ({
      ...row,
      total_amount: Number(row.total_amount || 0),
      paid_amount: Number(row.paid_amount || 0),
      due_amount: Number(row.due_amount || 0),
    })),
  };
}

export async function finalizeConsolidatedInvoice(input: {
  patientId: string;
  sourceInvoiceIds: string[];
  notes?: string | null;
}): Promise<FinalizedConsolidatedBill> {
  const patientId = input.patientId.trim();
  const sourceInvoiceIds = Array.from(
    new Set(input.sourceInvoiceIds.map((value) => value.trim()).filter(Boolean))
  );

  if (!patientId) throw new Error("Patient is required");
  if (!sourceInvoiceIds.length) throw new Error("Select at least one charge to finalize");

  const { data, error } = await supabase.rpc("finalize_v28_consolidated_bill", {
    p_patient_id: patientId,
    p_source_invoice_ids: sourceInvoiceIds,
    p_notes: input.notes?.trim() || null,
  });

  if (error) {
    if (isMissingBackend(error)) {
      throw new Error(
        "V28 consolidated billing is not deployed to this environment yet. Existing invoices and payments were not changed."
      );
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.bill_id) throw new Error("Final invoice was not returned by the server");

  return {
    bill_id: row.bill_id,
    invoice_number: row.invoice_number,
    total_amount: Number(row.total_amount || 0),
    paid_amount: Number(row.paid_amount || 0),
    due_amount: Number(row.due_amount || 0),
    country_code: String(row.country_code || ""),
    currency_code: String(row.currency_code || ""),
    finalized_at: String(row.finalized_at || new Date().toISOString()),
  };
}

export async function loadConsolidatedInvoiceSnapshot(
  billId: string
): Promise<CapDentInvoiceSnapshot> {
  const cleanBillId = billId.trim();
  if (!cleanBillId) throw new Error("Final invoice ID is required");

  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const [{ data: billData, error: billError }, clinic] = await Promise.all([
    supabase
      .from("consolidated_bills")
      .select(
        "id,clinic_id,patient_id,invoice_number,status,country_code,currency_code,subtotal,total_amount,paid_at_finalization,due_at_finalization,notes,finalized_at"
      )
      .eq("id", cleanBillId)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle<ConsolidatedBillRow>(),
    getClinicBrand(),
  ]);

  if (billError) throw billError;
  if (!billData) throw new Error("Final invoice was not found in this clinic");
  if (!clinic) throw new Error("Clinic branding could not be loaded");

  const [{ data: patientData, error: patientError }, { data: itemData, error: itemError }] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id,name,phone,patient_code")
        .eq("id", billData.patient_id)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle(),
      supabase
        .from("consolidated_bill_items")
        .select("source_invoice_id,label,amount,paid_amount,due_amount,sort_order")
        .eq("bill_id", billData.id)
        .eq("clinic_id", profile.clinic_id)
        .order("sort_order", { ascending: true }),
    ]);

  if (patientError) throw patientError;
  if (!patientData) throw new Error("Final invoice patient could not be loaded");
  if (itemError) throw itemError;

  const items = (itemData || []) as ConsolidatedBillItemRow[];

  return {
    invoiceId: billData.id,
    invoiceNumber: billData.invoice_number,
    versionLabel: "Finalized patient invoice",
    issuedAt: billData.finalized_at,
    clinic: {
      name: clinic.name,
      phone: clinic.phone,
      address: clinic.address,
      logoUrl: clinic.logo_url,
    },
    patient: {
      name: patientData.name,
      patientCode: patientData.patient_code,
      phone: patientData.phone,
    },
    lines: items.map((item) => ({
      label: item.label,
      quantity: 1,
      unitAmount: Number(item.amount || 0),
      amount: Number(item.amount || 0),
    })),
    subtotal: Number(billData.subtotal || 0),
    total: Number(billData.total_amount || 0),
    paid: Number(billData.paid_at_finalization || 0),
    due: Number(billData.due_at_finalization || 0),
    notes: billData.notes || null,
    currencyCode: billData.currency_code,
  };
}
