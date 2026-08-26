import { Alert, Linking } from "react-native";
import type { CapDentInvoiceSnapshot } from "@/lib/invoiceDocument";

function normalizePhone(phone?: string | null) {
  if (!phone) return "";
  return phone.replace(/[^\d]/g, "");
}

function invoiceMoney(value: number, currencyCode?: string | null) {
  const currency = String(currencyCode || "INR").toUpperCase();
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export async function openWhatsApp(phone: string | null | undefined, message: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    Alert.alert("Phone missing", "Add a valid phone number before sending WhatsApp.");
    return;
  }

  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    Alert.alert("WhatsApp unavailable", "WhatsApp could not be opened on this device.");
    return;
  }
  await Linking.openURL(url);
}

export function appointmentReminderMessage(input: { patientName: string; clinicName?: string; appointmentTime: string }) {
  return `Hello ${input.patientName}, this is a reminder for your dental appointment at ${input.clinicName ?? "our clinic"} on ${new Date(input.appointmentTime).toLocaleString()}. Please reply to confirm or call us to reschedule.`;
}

export function paymentReminderMessage(input: { patientName: string; clinicName?: string; dueAmount: number }) {
  return `Hello ${input.patientName}, this is a gentle reminder that ₹${input.dueAmount} is pending at ${input.clinicName ?? "our clinic"}. Please contact reception if you have already paid.`;
}

export function visitFollowUpMessage(input: { patientName: string; clinicName?: string }) {
  return `Hello ${input.patientName}, thank you for visiting ${input.clinicName ?? "our clinic"}. Please follow the doctor's advice and contact us if you have pain, swelling, or questions.`;
}

export function finalizedInvoiceMessage(
  snapshot: CapDentInvoiceSnapshot,
  options?: { paymentUrl?: string | null }
) {
  const currency = snapshot.currencyCode || "INR";
  const invoiceNumber = snapshot.invoiceNumber || snapshot.invoiceId.slice(0, 8).toUpperCase();
  const lines = snapshot.lines
    .map((line) => `${line.label}: ${invoiceMoney(line.amount, currency)}`)
    .join("\n");
  const paymentUrl = options?.paymentUrl?.trim() || "";
  const statusLine = snapshot.due > 0
    ? `Balance due: ${invoiceMoney(snapshot.due, currency)}`
    : "Status: PAID";

  return [
    `Hello ${snapshot.patient.name},`,
    "",
    `Final invoice from ${snapshot.clinic.name}`,
    `Invoice: ${invoiceNumber}`,
    "",
    lines,
    "",
    `Total: ${invoiceMoney(snapshot.total, currency)}`,
    `Paid: ${invoiceMoney(snapshot.paid, currency)}`,
    statusLine,
    paymentUrl && snapshot.due > 0 ? `Pay remaining balance securely: ${paymentUrl}` : "",
    "",
    "Please contact reception if you have any questions about this invoice.",
  ]
    .filter(Boolean)
    .join("\n");
}
