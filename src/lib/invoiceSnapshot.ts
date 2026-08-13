import { getClinicBrand } from "@/lib/clinicBranding";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import type { CapDentInvoiceAdjustment, CapDentInvoiceSnapshot } from "@/lib/invoiceDocument";
import { getCurrentProfile, supabase } from "@/lib/supabase";

type CurrentInvoiceRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  invoice_type?: string | null;
  payment_category?: string | null;
  original_total_amount?: number | null;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  discount_amount?: number | null;
  waived_amount?: number | null;
  refunded_amount?: number | null;
  version_number?: number | null;
  status?: string | null;
  notes?: string | null;
  created_at: string;
};

type InvoicePatientRow = {
  id: string;
  name: string;
  phone?: string | null;
  patient_code?: string | null;
};

type InvoicePaymentRow = {
  payment_method?: string | null;
  created_at: string;
};

function invoiceTypeLabel(invoice: CurrentInvoiceRow) {
  const value = String(invoice.invoice_type || invoice.payment_category || "").toLowerCase();

  if (value === "op_fee" || value === "consultation_fee") return "Consultation / OP Fee";
  if (value === "xray_fee") return "X-ray Fee";
  if (value === "medication_fee") return "Medication Fee";
  if (value === "treatment" || value === "treatment_fee") return "Treatment Fee";
  if (value === "pending_collection") return "Pending Collection";
  if (value === "other") return "Other Clinic Fee";
  return "Dental Services";
}

function positiveAdjustment(label: string, value?: number | null): CapDentInvoiceAdjustment | null {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { label, amount: -Math.abs(amount) };
}

export async function loadCurrentInvoiceSnapshot(invoiceId: string): Promise<CapDentInvoiceSnapshot> {
  const cleanInvoiceId = invoiceId.trim();
  if (!cleanInvoiceId) throw new Error("Invoice ID is required");

  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const [{ data: invoiceData, error: invoiceError }, clinic, preferences] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id,clinic_id,patient_id,invoice_type,payment_category,original_total_amount,total_amount,paid_amount,due_amount,discount_amount,waived_amount,refunded_amount,version_number,status,notes,created_at"
      )
      .eq("id", cleanInvoiceId)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle<CurrentInvoiceRow>(),
    getClinicBrand(),
    getClinicPreferences(),
  ]);

  if (invoiceError) throw invoiceError;
  if (!invoiceData) throw new Error("Invoice was not found in this clinic");
  if (!clinic) throw new Error("Clinic branding could not be loaded");

  const [{ data: patientData, error: patientError }, { data: paymentData, error: paymentError }] =
    await Promise.all([
      supabase
        .from("patients")
        .select("id,name,phone,patient_code")
        .eq("id", invoiceData.patient_id)
        .eq("clinic_id", profile.clinic_id)
        .maybeSingle<InvoicePatientRow>(),
      supabase
        .from("payments")
        .select("payment_method,created_at")
        .eq("invoice_id", invoiceData.id)
        .eq("clinic_id", profile.clinic_id)
        .in("status", ["active", "corrected"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<InvoicePaymentRow>(),
    ]);

  if (patientError) throw patientError;
  if (!patientData) throw new Error("Invoice patient could not be loaded");
  if (paymentError) throw paymentError;

  const originalTotal = Number(invoiceData.original_total_amount ?? invoiceData.total_amount ?? 0);
  const total = Number(invoiceData.total_amount || 0);
  const paid = Number(invoiceData.paid_amount || 0);
  const due = Number(invoiceData.due_amount || 0);

  const adjustments = [
    positiveAdjustment("Discount", invoiceData.discount_amount),
    positiveAdjustment("Waived", invoiceData.waived_amount),
    positiveAdjustment("Refunded", invoiceData.refunded_amount),
  ].filter((item): item is CapDentInvoiceAdjustment => Boolean(item));

  return {
    invoiceId: invoiceData.id,
    invoiceNumber: `INV-${invoiceData.id.slice(0, 8).toUpperCase()}`,
    versionLabel: invoiceData.version_number ? `Current invoice version ${invoiceData.version_number}` : null,
    issuedAt: invoiceData.created_at,
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
    lines: [
      {
        label: invoiceTypeLabel(invoiceData),
        quantity: 1,
        unitAmount: originalTotal,
        amount: originalTotal,
      },
    ],
    adjustments,
    subtotal: originalTotal,
    total,
    paid,
    due,
    paymentMethod: paymentData?.payment_method || null,
    notes: invoiceData.notes || null,
    currencyCode: preferences.currencyCode,
  };
}
