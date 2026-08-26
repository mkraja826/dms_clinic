import { getClinicPreferences } from "@/lib/clinicPreferences";
import { formatClinicMoney } from "@/lib/clinicLocale";
import { getCurrentProfile, supabase, type InvoiceStatus, type PaymentCategory } from "@/lib/supabase";

export type InvoiceCenterPayment = {
  amount: number;
  paymentMethod: string;
  createdAt: string;
};

export type InvoiceCenterRow = {
  id: string;
  reference: string;
  patientId: string;
  patientName: string;
  patientCode: string | null;
  patientPhone: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: InvoiceStatus;
  category: string;
  notes: string;
  createdAt: string;
  payments: InvoiceCenterPayment[];
};

export type InvoiceCenterReport = {
  clinic: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  currencyCode: string;
  invoices: InvoiceCenterRow[];
  summary: {
    totalBilled: number;
    totalPaid: number;
    totalDue: number;
    count: number;
    openCount: number;
  };
};

type PatientRow = {
  id: string;
  patient_code?: string | null;
  name?: string | null;
  phone?: string | null;
};

type InvoiceRow = {
  id: string;
  patient_id: string;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  due_amount?: number | string | null;
  status?: string | null;
  payment_category?: PaymentCategory | null;
  notes?: string | null;
  created_at: string;
};

type PaymentRow = {
  invoice_id?: string | null;
  amount?: number | string | null;
  payment_method?: string | null;
  created_at: string;
};

function amount(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function safeStatus(value: unknown): InvoiceStatus {
  if (value === "paid" || value === "partial") return value;
  return "unpaid";
}

export function invoiceCategoryLabel(value?: PaymentCategory | null) {
  if (value === "op_fee") return "OP Fee";
  if (value === "xray_fee") return "X-ray";
  if (value === "medication_fee") return "Medication Fee";
  if (value === "treatment_fee") return "Treatment Fee";
  if (value === "pending_collection") return "Pending Collection";
  if (value === "other") return "Other";
  return "Clinic Charge";
}

function compactDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "00000000";
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("");
}

export function invoiceReference(invoice: Pick<InvoiceRow, "id" | "created_at">) {
  const suffix = String(invoice.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase()
    .padEnd(6, "0");
  return `CD-${compactDate(invoice.created_at)}-${suffix}`;
}

function displayDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function requireRows<T>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
  return data || [];
}

export async function loadInvoiceCenter(): Promise<InvoiceCenterReport> {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");

  const clinicId = profile.clinic_id;
  const [preferences, clinicResponse, patientRows, invoiceRows, paymentRows] = await Promise.all([
    getClinicPreferences(),
    supabase
      .from("clinics")
      .select("name,phone,email,address")
      .eq("id", clinicId)
      .maybeSingle(),
    requireRows<PatientRow>(
      "Invoice patients",
      supabase
        .from("patients")
        .select("id,patient_code,name,phone")
        .eq("clinic_id", clinicId)
        .limit(5000)
    ),
    requireRows<InvoiceRow>(
      "Invoices",
      supabase
        .from("invoices")
        .select("id,patient_id,total_amount,paid_amount,due_amount,status,payment_category,notes,created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(1500)
    ),
    requireRows<PaymentRow>(
      "Invoice payments",
      supabase
        .from("payments")
        .select("invoice_id,amount,payment_method,created_at")
        .eq("clinic_id", clinicId)
        .not("invoice_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(4000)
    ),
  ]);

  if (clinicResponse.error) throw clinicResponse.error;

  const patientMap = new Map(patientRows.map((row) => [row.id, row]));
  const paymentMap = new Map<string, InvoiceCenterPayment[]>();

  for (const payment of paymentRows) {
    if (!payment.invoice_id) continue;
    const current = paymentMap.get(payment.invoice_id) || [];
    current.push({
      amount: amount(payment.amount),
      paymentMethod: String(payment.payment_method || "Recorded payment"),
      createdAt: payment.created_at,
    });
    paymentMap.set(payment.invoice_id, current);
  }

  const invoices = invoiceRows
    .filter((invoice) => patientMap.has(invoice.patient_id))
    .map<InvoiceCenterRow>((invoice) => {
      const patient = patientMap.get(invoice.patient_id)!;
      return {
        id: invoice.id,
        reference: invoiceReference(invoice),
        patientId: invoice.patient_id,
        patientName: String(patient.name || "Patient"),
        patientCode: patient.patient_code || null,
        patientPhone: patient.phone || null,
        totalAmount: amount(invoice.total_amount),
        paidAmount: amount(invoice.paid_amount),
        dueAmount: amount(invoice.due_amount),
        status: safeStatus(invoice.status),
        category: invoiceCategoryLabel(invoice.payment_category),
        notes: String(invoice.notes || ""),
        createdAt: invoice.created_at,
        payments: paymentMap.get(invoice.id) || [],
      };
    });

  return {
    clinic: {
      name: String(clinicResponse.data?.name || "Dental Clinic"),
      phone: clinicResponse.data?.phone || null,
      email: clinicResponse.data?.email || null,
      address: clinicResponse.data?.address || null,
    },
    currencyCode: preferences.currencyCode,
    invoices,
    summary: {
      totalBilled: invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      totalPaid: invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0),
      totalDue: invoices.reduce((sum, invoice) => sum + invoice.dueAmount, 0),
      count: invoices.length,
      openCount: invoices.filter((invoice) => invoice.dueAmount > 0).length,
    },
  };
}

export function buildInvoiceShareText(report: InvoiceCenterReport, invoice: InvoiceCenterRow) {
  const money = (value: number) => formatClinicMoney(value, report.currencyCode);
  const patientIdentity = [invoice.patientCode, invoice.patientName].filter(Boolean).join(" - ");
  const clinicContact = [report.clinic.phone, report.clinic.email].filter(Boolean).join(" • ");
  const payments = invoice.payments.length
    ? invoice.payments
        .map(
          (payment) =>
            `• ${money(payment.amount)} • ${payment.paymentMethod} • ${displayDate(payment.createdAt)}`
        )
        .join("\n")
    : "No linked collection recorded.";

  return [
    report.clinic.name,
    report.clinic.address || "",
    clinicContact,
    "",
    "PAYMENT INVOICE / STATEMENT",
    `Reference: ${invoice.reference}`,
    `Date: ${displayDate(invoice.createdAt)}`,
    `Patient: ${patientIdentity}`,
    invoice.patientPhone ? `Phone: ${invoice.patientPhone}` : "",
    `Category: ${invoice.category}`,
    "",
    `Total: ${money(invoice.totalAmount)}`,
    `Paid: ${money(invoice.paidAmount)}`,
    `Due: ${money(invoice.dueAmount)}`,
    `Status: ${invoice.status.toUpperCase()}`,
    invoice.notes ? `Notes: ${invoice.notes}` : "",
    "",
    "Payment history",
    payments,
    "",
    "Generated from clinic records in CapDent.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
