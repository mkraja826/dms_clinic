export type CapDentInvoiceLine = {
  label: string;
  quantity?: number | null;
  unitAmount?: number | null;
  amount: number;
};

export type CapDentInvoiceAdjustment = {
  label: string;
  amount: number;
};

export type CapDentInvoiceSnapshot = {
  invoiceId: string;
  invoiceNumber?: string | null;
  versionLabel?: string | null;
  issuedAt: string;
  clinic: {
    name: string;
    phone?: string | null;
    address?: string | null;
    logoUrl?: string | null;
  };
  patient: {
    name: string;
    patientCode?: string | null;
    phone?: string | null;
  };
  lines: CapDentInvoiceLine[];
  adjustments?: CapDentInvoiceAdjustment[];
  subtotal: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod?: string | null;
  notes?: string | null;
  currencyCode?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeMoney(value: number, currencyCode?: string | null) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const currency = String(currencyCode || "INR").toUpperCase();

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

function safeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function invoiceTitle(snapshot: CapDentInvoiceSnapshot) {
  return snapshot.invoiceNumber?.trim() || `Invoice ${snapshot.invoiceId.slice(0, 8).toUpperCase()}`;
}

export function buildCapDentInvoiceHtml(snapshot: CapDentInvoiceSnapshot) {
  const currency = snapshot.currencyCode || "INR";
  const lineRows = snapshot.lines.length
    ? snapshot.lines
        .map((line) => {
          const quantity = line.quantity && line.quantity > 0 ? line.quantity : null;
          const unitAmount = line.unitAmount == null ? null : line.unitAmount;
          return `
            <tr>
              <td>${escapeHtml(line.label)}</td>
              <td class="num">${quantity ?? "—"}</td>
              <td class="num">${unitAmount == null ? "—" : safeMoney(unitAmount, currency)}</td>
              <td class="num">${safeMoney(line.amount, currency)}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="muted">No itemized lines were recorded for this invoice.</td></tr>`;

  const adjustmentRows = (snapshot.adjustments || [])
    .map(
      (adjustment) => `
        <div class="summary-row">
          <span>${escapeHtml(adjustment.label)}</span>
          <strong>${safeMoney(adjustment.amount, currency)}</strong>
        </div>`
    )
    .join("");

  const logo = snapshot.clinic.logoUrl
    ? `<img class="logo" src="${escapeHtml(snapshot.clinic.logoUrl)}" alt="" />`
    : `<div class="logo-fallback">CD</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(invoiceTitle(snapshot))}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #16272b; margin: 0; background: #fff; font-size: 13px; }
  .sheet { max-width: 820px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #dfe9eb; }
  .brand { display: flex; gap: 14px; align-items: flex-start; }
  .logo, .logo-fallback { width: 64px; height: 64px; border-radius: 14px; object-fit: cover; background: #eef7f8; }
  .logo-fallback { display: flex; align-items: center; justify-content: center; font-weight: 800; color: #176c78; font-size: 20px; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 23px; }
  h2 { font-size: 15px; margin-bottom: 5px; }
  .muted { color: #687c81; }
  .invoice-meta { text-align: right; min-width: 220px; }
  .invoice-number { font-size: 19px; font-weight: 800; margin-bottom: 5px; }
  .panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 20px 0; }
  .panel { border: 1px solid #dfe9eb; border-radius: 12px; padding: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; color: #52676c; font-size: 12px; padding: 10px 8px; border-bottom: 1px solid #cadadd; }
  td { padding: 11px 8px; border-bottom: 1px solid #e6eeee; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .summary { width: min(380px, 100%); margin-left: auto; margin-top: 20px; }
  .summary-row { display: flex; justify-content: space-between; gap: 20px; padding: 6px 0; }
  .total { margin-top: 8px; padding-top: 10px; border-top: 2px solid #dfe9eb; font-size: 16px; }
  .due { color: #9d4f00; }
  .paid { color: #176c48; }
  .footer { margin-top: 26px; padding-top: 14px; border-top: 1px solid #dfe9eb; color: #687c81; font-size: 11px; line-height: 1.5; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <main class="sheet">
    <section class="header">
      <div class="brand">
        ${logo}
        <div>
          <h1>${escapeHtml(snapshot.clinic.name)}</h1>
          ${snapshot.clinic.phone ? `<p class="muted">${escapeHtml(snapshot.clinic.phone)}</p>` : ""}
          ${snapshot.clinic.address ? `<p class="muted">${escapeHtml(snapshot.clinic.address)}</p>` : ""}
        </div>
      </div>
      <div class="invoice-meta">
        <div class="invoice-number">${escapeHtml(invoiceTitle(snapshot))}</div>
        <div class="muted">Issued ${escapeHtml(safeDate(snapshot.issuedAt))}</div>
        ${snapshot.versionLabel ? `<div class="muted">${escapeHtml(snapshot.versionLabel)}</div>` : ""}
      </div>
    </section>

    <section class="panel-grid">
      <div class="panel">
        <h2>Patient</h2>
        <p><strong>${escapeHtml(snapshot.patient.name)}</strong></p>
        ${snapshot.patient.patientCode ? `<p class="muted">Patient ID: ${escapeHtml(snapshot.patient.patientCode)}</p>` : ""}
        ${snapshot.patient.phone ? `<p class="muted">${escapeHtml(snapshot.patient.phone)}</p>` : ""}
      </div>
      <div class="panel">
        <h2>Payment</h2>
        <p>Status: <strong>${snapshot.due > 0 ? "Pending" : "Paid"}</strong></p>
        ${snapshot.paymentMethod ? `<p class="muted">Method: ${escapeHtml(snapshot.paymentMethod)}</p>` : ""}
      </div>
    </section>

    <section>
      <h2>Invoice details</h2>
      <table>
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
        <tbody>${lineRows}</tbody>
      </table>
    </section>

    <section class="summary">
      <div class="summary-row"><span>Subtotal</span><strong>${safeMoney(snapshot.subtotal, currency)}</strong></div>
      ${adjustmentRows}
      <div class="summary-row total"><span>Total</span><strong>${safeMoney(snapshot.total, currency)}</strong></div>
      <div class="summary-row paid"><span>Paid</span><strong>${safeMoney(snapshot.paid, currency)}</strong></div>
      <div class="summary-row due"><span>Balance due</span><strong>${safeMoney(snapshot.due, currency)}</strong></div>
    </section>

    ${snapshot.notes ? `<section class="panel" style="margin-top:20px"><h2>Notes</h2><p>${escapeHtml(snapshot.notes)}</p></section>` : ""}

    <footer class="footer">
      Generated by CapDent from the recorded invoice state. Historical invoices should be rendered from their stored/versioned financial state and must not be silently recalculated from current balances.
    </footer>
  </main>
</body>
</html>`;
}
