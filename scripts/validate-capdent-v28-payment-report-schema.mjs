import { readFileSync } from "node:fs";

const paymentReview = readFileSync("src/lib/paymentReview.ts", "utf8");
const failures = [];

if (!paymentReview.includes('from("profiles").select("id,name,email")')) {
  failures.push("Payment Review must query the current profiles.name column.");
}

if (paymentReview.includes("full_name")) {
  failures.push("Payment Review must not reference the removed profiles.full_name column.");
}

if (!paymentReview.includes("export const buildPaymentReview = getPaymentReviewReport")) {
  failures.push("The shared Payment Review API used by Online Payments must remain exported.");
}

if (failures.length) {
  console.error(`CapDent V28 payment-report schema validation failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("CapDent V28 payment-report schema validation passed.");
