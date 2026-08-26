import { readFileSync } from "node:fs";

const readText = (path) => readFileSync(path, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const invoiceService = readText("src/lib/invoiceCenter.ts");
const invoiceScreen = readText("src/app/reports/invoices.tsx");
const headMore = readText("src/app/(head)/more.tsx");

expect(
  invoiceService.includes('.from("invoices")') &&
    invoiceService.includes('.from("payments")') &&
    invoiceService.includes("invoice_id") &&
    invoiceService.includes('.from("patients")'),
  "V27 Invoice Center must read the existing invoices/payments relationship instead of creating a parallel ledger."
);
expect(
  !invoiceService.includes(".insert(") &&
    !invoiceService.includes(".update(") &&
    !invoiceService.includes(".delete("),
  "V27 Invoice Center presentation service must remain read-only; electronic settlement belongs only in verified server payment functions."
);
expect(
  invoiceService.includes("buildInvoiceShareText") &&
    invoiceService.includes("Generated from clinic records in CapDent") &&
    invoiceService.includes("Reference: ${invoice.reference}") &&
    !invoiceService.includes("Invoice ID:"),
  "V27 invoice sharing must use a human CapDent reference and must not expose the raw invoice UUID."
);
expect(
  invoiceScreen.includes("Invoice Center") &&
    invoiceScreen.includes("Share.share") &&
    invoiceScreen.includes("Share Invoice") &&
    invoiceScreen.includes("Open Patient"),
  "V27 Invoice Center UI must expose invoice status, sharing, and patient navigation."
);
expect(
  invoiceScreen.includes("Invoice display and sharing are read-only") &&
    invoiceScreen.includes("Sharing an invoice does not collect payment") &&
    invoiceScreen.includes("server independently verifies the PhonePe order status and amount") &&
    invoiceScreen.includes("not presented as a GST tax invoice"),
  "V27 Invoice Center must distinguish read-only invoice sharing from separately verified electronic collection and must not claim GST tax-invoice status."
);
expect(
  headMore.includes("Invoice Center") && headMore.includes('/reports/invoices'),
  "V27 owner tools must provide a visible route to Invoice Center."
);

if (failures.length > 0) {
  console.error(`CapDent V27 invoice validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("CapDent V27 invoice validation passed.");
