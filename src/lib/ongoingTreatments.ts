import { getCurrentProfile, supabase } from "@/lib/supabase";
import type { Treatment } from "@/lib/supabase";

export type OngoingTreatmentStatus = Treatment["status"];

export type OngoingTreatmentItem = {
  id: string;
  patientId: string;
  visitId: string | null;
  patientName: string;
  patientPhone: string | null;
  patientCode: string | null;
  treatmentName: string;
  category: string | null;
  cost: number;
  status: OngoingTreatmentStatus;
  createdAt: string;
  visitDate: string | null;
  doctorId: string | null;
  doctorName: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentCleared: boolean;
};

type TreatmentRow = {
  id: string;
  clinic_id: string;
  visit_id: string | null;
  patient_id: string;
  treatment_name: string;
  category?: string | null;
  cost: number | string | null;
  status: OngoingTreatmentStatus;
  created_at: string;
};

type PatientMini = {
  id: string;
  name: string | null;
  phone: string | null;
  patient_code: string | null;
};

type VisitMini = {
  id: string;
  doctor_id: string | null;
  visit_date: string | null;
};

type DoctorMini = {
  id: string;
  name: string | null;
};

type InvoiceMini = {
  patient_id: string;
  visit_id: string | null;
  total_amount: number | string | null;
  paid_amount: number | string | null;
  due_amount: number | string | null;
  status: string | null;
  payment_category: string | null;
};

function toNumber(value?: number | string | null) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function indexById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function getTreatmentInvoices(treatment: TreatmentRow, invoices: InvoiceMini[]) {
  const visitInvoices = invoices.filter((invoice) => invoice.visit_id && invoice.visit_id === treatment.visit_id);

  if (visitInvoices.length > 0) return visitInvoices;

  return invoices.filter((invoice) => invoice.patient_id === treatment.patient_id);
}

function getTreatmentPaymentTotals(treatment: TreatmentRow, invoices: InvoiceMini[]) {
  const relevantInvoices = getTreatmentInvoices(treatment, invoices);
  const invoiceTotal = relevantInvoices.reduce((sum, invoice) => sum + toNumber(invoice.total_amount), 0);
  const paidAmount = relevantInvoices.reduce((sum, invoice) => sum + toNumber(invoice.paid_amount), 0);
  const dueAmount = relevantInvoices.reduce((sum, invoice) => sum + toNumber(invoice.due_amount), 0);

  return {
    totalAmount: invoiceTotal || toNumber(treatment.cost),
    paidAmount,
    dueAmount,
  };
}

export async function getOngoingTreatments(options?: { limit?: number; doctorOnly?: boolean }) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) return [] as OngoingTreatmentItem[];

  const limit = options?.limit ?? 8;

  const { data: treatmentRows, error: treatmentError } = await supabase
    .from("treatments")
    .select("id,clinic_id,visit_id,patient_id,treatment_name,category,cost,status,created_at")
    .eq("clinic_id", profile.clinic_id)
    .in("status", ["planned", "ongoing"])
    .order("created_at", { ascending: false })
    .limit(limit * 3);

  if (treatmentError) throw treatmentError;

  const treatments = ((treatmentRows || []) as TreatmentRow[]).filter(
    (row) => row.clinic_id === profile.clinic_id
  );

  if (!treatments.length) return [] as OngoingTreatmentItem[];

  const patientIds = Array.from(new Set(treatments.map((row) => row.patient_id).filter(Boolean)));
  const visitIds = Array.from(new Set(treatments.map((row) => row.visit_id).filter(Boolean))) as string[];

  const [patientsResult, visitsResult, invoicesResult] = await Promise.all([
    patientIds.length
      ? supabase.from("patients").select("id,name,phone,patient_code").in("id", patientIds)
      : Promise.resolve({ data: [] as PatientMini[], error: null }),
    visitIds.length
      ? supabase.from("patient_visits").select("id,doctor_id,visit_date").in("id", visitIds)
      : Promise.resolve({ data: [] as VisitMini[], error: null }),
    patientIds.length
      ? supabase
          .from("invoices")
          .select("patient_id,visit_id,total_amount,paid_amount,due_amount,status,payment_category")
          .in("patient_id", patientIds)
          .eq("payment_category", "treatment_fee")
      : Promise.resolve({ data: [] as InvoiceMini[], error: null }),
  ]);

  if (patientsResult.error) throw patientsResult.error;
  if (visitsResult.error) throw visitsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;

  const patients = indexById((patientsResult.data || []) as PatientMini[]);
  const visits = indexById((visitsResult.data || []) as VisitMini[]);
  const invoices = (invoicesResult.data || []) as InvoiceMini[];
  const doctorIds = Array.from(
    new Set(((visitsResult.data || []) as VisitMini[]).map((row) => row.doctor_id).filter(Boolean))
  ) as string[];

  const doctorsResult = doctorIds.length
    ? await supabase.from("profiles").select("id,name").in("id", doctorIds)
    : { data: [] as DoctorMini[], error: null };

  if (doctorsResult.error) throw doctorsResult.error;

  const doctors = indexById((doctorsResult.data || []) as DoctorMini[]);

  return treatments
    .map((treatment) => {
      const patient = patients.get(treatment.patient_id);
      const visit = treatment.visit_id ? visits.get(treatment.visit_id) : null;
      const doctor = visit?.doctor_id ? doctors.get(visit.doctor_id) : null;
      const paymentTotals = getTreatmentPaymentTotals(treatment, invoices);

      return {
        id: treatment.id,
        patientId: treatment.patient_id,
        visitId: treatment.visit_id,
        patientName: patient?.name || "Patient",
        patientPhone: patient?.phone || null,
        patientCode: patient?.patient_code || null,
        treatmentName: treatment.treatment_name || "Treatment",
        category: treatment.category || null,
        cost: toNumber(treatment.cost),
        status: treatment.status,
        createdAt: treatment.created_at,
        visitDate: visit?.visit_date || null,
        doctorId: visit?.doctor_id || null,
        doctorName: doctor?.name || null,
        totalAmount: paymentTotals.totalAmount,
        paidAmount: paymentTotals.paidAmount,
        dueAmount: paymentTotals.dueAmount,
        paymentCleared: paymentTotals.dueAmount <= 0,
      } satisfies OngoingTreatmentItem;
    })
    .filter((item) => !options?.doctorOnly || item.doctorId === profile.id)
    .slice(0, limit);
}

export async function updateOngoingTreatmentStatus(treatmentId: string, status: OngoingTreatmentStatus) {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  if (!["planned", "ongoing", "completed", "cancelled"].includes(status)) {
    throw new Error("Invalid treatment status");
  }

  const { data, error } = await supabase
    .from("treatments")
    .update({ status })
    .eq("id", treatmentId)
    .eq("clinic_id", profile.clinic_id)
    .select("*")
    .single<Treatment>();

  if (error) throw error;
  return data;
}
