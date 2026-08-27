import { getCurrentProfile, supabase } from "@/lib/supabase";

export type PaymentReviewRangeKey = "today" | "week" | "month" | "all";

export type PaymentReviewTotal = {
  label: string;
  amount: number;
  count: number;
};

export type PaymentReviewPayment = {
  patient: string;
  staff: string;
  amount: number;
  method: string;
  category: string;
  notes: string;
  createdAt: string;
};

export type PaymentReviewOnlineAllocation = {
  category: string;
  label: string;
  amount: number;
};

export type PaymentReviewOnlinePayment = {
  patient: string;
  provider: string;
  accountLabel: string;
  merchantIdMasked: string;
  total: number;
  createdAt: string;
  allocations: PaymentReviewOnlineAllocation[];
};

export type PaymentReviewPendingInvoice = {
  patient: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  notes: string;
  createdAt: string;
};

export type PaymentReviewReport = {
  rangeLabel: string;
  generatedAt: string;
  summary: {
    revenue: number;
    collections: number;
    pendingDue: number;
    pendingInvoices: number;
    verifiedOnlineRevenue: number;
    verifiedOnlinePayments: number;
  };
  methodTotals: PaymentReviewTotal[];
  categoryTotals: PaymentReviewTotal[];
  staffTotals: PaymentReviewTotal[];
  recentPayments: PaymentReviewPayment[];
  onlinePayments: PaymentReviewOnlinePayment[];
  pendingInvoices: PaymentReviewPendingInvoice[];
};

type DateRange = {
  start: string | null;
  end: string | null;
  label: string;
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

export function getPaymentReviewDateRange(key: PaymentReviewRangeKey): DateRange {
  if (key === "all") return { start: null, end: null, label: "All collections" };

  const start = startOfToday();
  const end = endOfToday();

  if (key === "week") start.setDate(start.getDate() - 6);
  if (key === "month") start.setDate(1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: key === "today" ? "Today" : key === "week" ? "Last 7 days" : "This month",
  };
}

function moneyNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryLabel(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "op_fee") return "OP / Consultation";
  if (key === "xray_fee") return "X-ray";
  if (key === "medication_fee") return "Medication";
  if (key === "treatment_fee") return "Treatment";
  if (key === "pending_collection") return "Pending Collection";
  if (key === "other") return "Other";
  return key ? key.replaceAll("_", " ") : "Other";
}

function providerLabel(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "phonepe") return "PhonePe";
  if (key === "card") return "Card";
  return key || "Online";
}

function maskMerchantId(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "Merchant ID unavailable";
  if (text.length <= 8) return `••••${text.slice(-2)}`;
  return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

function patientLabel(patient: any) {
  if (!patient) return "Patient";
  return patient.name || patient.patient_code || "Patient";
}

function staffLabel(staff: any) {
  if (!staff) return "Unknown staff";
  return staff.full_name || staff.name || staff.email || "Staff";
}

function addTotal(map: Map<string, PaymentReviewTotal>, label: string, amount: number) {
  const current = map.get(label) || { label, amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  map.set(label, current);
}

function sortedTotals(map: Map<string, PaymentReviewTotal>) {
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

async function safeRows<T>(label: string, query: PromiseLike<{ data: T[] | null; error: any }>) {
  const { data, error } = await query;
  if (error) {
    console.warn(`${label} failed:`, error.message || error);
    return [] as T[];
  }
  return (data ?? []) as T[];
}

function applyDateRange<T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(
  query: T,
  column: string,
  range: DateRange
) {
  let next = query;
  if (range.start) next = next.gte(column, range.start);
  if (range.end) next = next.lte(column, range.end);
  return next;
}

function belongsToCurrentClinic(patientMap: Map<string, any>, patientId: unknown) {
  return Boolean(patientId && patientMap.has(String(patientId)));
}

export async function getPaymentReviewReport(
  rangeKey: PaymentReviewRangeKey = "today",
  limit = 250
): Promise<PaymentReviewReport> {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  const range = getPaymentReviewDateRange(rangeKey);

  const [{ data: patients, error: patientError }, { data: staff, error: staffError }] = await Promise.all([
    supabase.from("patients").select("id,name,patient_code").eq("clinic_id", profile.clinic_id),
    supabase.from("profiles").select("id,full_name,email").eq("clinic_id", profile.clinic_id),
  ]);
  if (patientError) throw patientError;
  if (staffError) throw staffError;

  const patientMap = new Map((patients ?? []).map((patient: any) => [String(patient.id), patient]));
  const staffMap = new Map((staff ?? []).map((row: any) => [String(row.id), row]));

  const paymentQuery = applyDateRange(
    supabase
      .from("payments")
      .select("patient_id,amount,payment_method,payment_category,collected_by,notes,created_at")
      .eq("clinic_id", profile.clinic_id)
      .order("created_at", { ascending: false })
      .limit(limit),
    "created_at",
    range
  );

  const onlineQuery = applyDateRange(
    supabase
      .from("patient_payment_reconciliation_entries")
      .select("payment_request_id,patient_id,amount,provider,provider_merchant_id_snapshot,account_label_snapshot,payment_category,line_label,created_at")
      .eq("clinic_id", profile.clinic_id)
      .order("created_at", { ascending: false })
      .limit(limit),
    "created_at",
    range
  );

  const pendingInvoiceQuery = supabase
    .from("invoices")
    .select("patient_id,total_amount,paid_amount,due_amount,status,notes,created_at")
    .eq("clinic_id", profile.clinic_id)
    .gt("due_amount", 0)
    .order("due_amount", { ascending: false })
    .limit(500);

  const [paymentsRaw, onlineRowsRaw, pendingInvoicesRaw] = await Promise.all([
    safeRows<any>("Payment review payments", paymentQuery),
    safeRows<any>("Payment review verified online allocations", onlineQuery),
    safeRows<any>("Payment review pending invoices", pendingInvoiceQuery),
  ]);

  const payments = paymentsRaw.filter((row) => belongsToCurrentClinic(patientMap, row.patient_id));
  const onlineRows = onlineRowsRaw.filter((row) => belongsToCurrentClinic(patientMap, row.patient_id));
  const pendingInvoiceRows = pendingInvoicesRaw.filter((row) => belongsToCurrentClinic(patientMap, row.patient_id));

  const methodMap = new Map<string, PaymentReviewTotal>();
  const categoryMap = new Map<string, PaymentReviewTotal>();
  const staffMapTotals = new Map<string, PaymentReviewTotal>();

  payments.forEach((row) => {
    const amount = moneyNumber(row.amount);
    addTotal(methodMap, row.payment_method || "Unknown", amount);
    addTotal(categoryMap, categoryLabel(row.payment_category), amount);
    addTotal(staffMapTotals, staffLabel(staffMap.get(row.collected_by)), amount);
  });

  const groupedOnline = new Map<string, PaymentReviewOnlinePayment>();
  onlineRows.forEach((row) => {
    const key = String(row.payment_request_id || "").trim();
    if (!key) return;
    const amount = moneyNumber(row.amount);
    const existing: PaymentReviewOnlinePayment = groupedOnline.get(key) ?? {
      patient: patientLabel(patientMap.get(row.patient_id)),
      provider: providerLabel(row.provider),
      accountLabel: row.account_label_snapshot || "Clinic receiving account",
      merchantIdMasked: maskMerchantId(row.provider_merchant_id_snapshot),
      total: 0,
      createdAt: dateText(row.created_at),
      allocations: [],
    };
    existing.total += amount;
    existing.allocations.push({
      category: categoryLabel(row.payment_category),
      label: row.line_label || categoryLabel(row.payment_category),
      amount,
    });
    groupedOnline.set(key, existing);
  });

  const onlinePayments = Array.from(groupedOnline.values()).map((payment) => ({
    ...payment,
    allocations: payment.allocations.sort((a, b) => b.amount - a.amount),
  }));
  const verifiedOnlineRevenue = onlinePayments.reduce((sum, payment) => sum + payment.total, 0);
  const revenue = payments.reduce((sum, row) => sum + moneyNumber(row.amount), 0);
  const pendingDue = pendingInvoiceRows.reduce((sum, row) => sum + moneyNumber(row.due_amount), 0);

  return {
    rangeLabel: range.label,
    generatedAt: dateText(new Date().toISOString()),
    summary: {
      revenue,
      collections: payments.length,
      pendingDue,
      pendingInvoices: pendingInvoiceRows.length,
      verifiedOnlineRevenue,
      verifiedOnlinePayments: onlinePayments.length,
    },
    methodTotals: sortedTotals(methodMap),
    categoryTotals: sortedTotals(categoryMap),
    staffTotals: sortedTotals(staffMapTotals),
    recentPayments: payments.slice(0, 80).map((row) => ({
      patient: patientLabel(patientMap.get(row.patient_id)),
      staff: staffLabel(staffMap.get(row.collected_by)),
      amount: moneyNumber(row.amount),
      method: row.payment_method || "Unknown",
      category: categoryLabel(row.payment_category),
      notes: row.notes || "",
      createdAt: dateText(row.created_at),
    })),
    onlinePayments: onlinePayments.slice(0, 80),
    pendingInvoices: pendingInvoiceRows.slice(0, 80).map((row) => ({
      patient: patientLabel(patientMap.get(row.patient_id)),
      total: moneyNumber(row.total_amount),
      paid: moneyNumber(row.paid_amount),
      due: moneyNumber(row.due_amount),
      status: row.status || "pending",
      notes: row.notes || "",
      createdAt: dateText(row.created_at),
    })),
  };
}
