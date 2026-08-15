# CapDent V25 Invoice, UPI, and WhatsApp Foundation

Branch: `feature/v25-invoice-upi-whatsapp-foundation`
Base: `release/capdent-v25`

## Goal

Build a safe infrastructure layer for clinic-branded invoice documents, manual WhatsApp invoice sending, and UPI business payment requests without disturbing the existing V25 payment ledger.

## Non-negotiable rules

- Default OFF for all clinics.
- Owner/head doctor controls feature enablement.
- Do not auto-send invoices after every payment.
- Do not create one final invoice per payment.
- Do not rename or replace the existing `invoices` and `payments` ledger tables.
- Do not store provider secrets in Android local storage.
- Do not call Razorpay, Cashfree, PhonePe, or Meta WhatsApp APIs directly from Android.
- Use Supabase Edge Functions/backend for all provider calls and webhook verification.
- Test on demo clinic first. Do not test risky changes on BG Reddy Dental Clinic.

## Existing CapDent model to preserve

The existing app already records payment category and payment method separately.

Payment categories:

- `op_fee`
- `xray_fee`
- `medication_fee`
- `treatment_fee`
- `pending_collection`
- `other`

Payment methods:

- `Cash`
- `UPI`
- `Card`

This is correct and should remain the base ledger.

## New feature concept

The current `invoices` table remains a billing/due ledger.

The new invoice feature adds a final document layer:

- `invoice_documents`
- `invoice_document_items`
- `invoice_share_logs`
- `payment_requests`
- `payment_webhook_events`
- `clinic_invoice_settings`
- `clinic_payment_integrations`
- `clinic_whatsapp_integrations`

## Clinic feature toggles

Add clinic-level booleans, default false:

- `invoice_printing_enabled`
- `whatsapp_invoice_enabled`
- `upi_invoice_payments_enabled`

These should appear in:

`More -> Admin -> Clinic Feature Settings`

## Admin screens

Add later:

- `More -> Admin -> Invoice Settings`
- `More -> Admin -> Integrations`

Invoice settings fields:

- Invoice prefix
- Next invoice number
- Billing address
- GSTIN optional
- Footer note
- Terms text
- Show UPI QR / payment link on invoice

Integrations fields:

- Manual UPI ID
- Manual UPI QR image
- Razorpay mode/key id/key secret/webhook secret
- Cashfree mode/client id/client secret/webhook secret
- WhatsApp phone number id / WABA id / token / template names

## Invoice PDF requirements

Every PDF must include a frozen snapshot of:

- Clinic logo
- Clinic name
- Clinic address
- Clinic phone
- Clinic email optional
- GSTIN optional
- Patient name
- Patient phone
- Patient code
- Invoice number
- Invoice date
- OP / X-ray / Medication / Treatment / Other grouped items
- Payment method breakdown: UPI / Cash / Card
- Total paid and due
- Footer note
- UPI QR or payment link when enabled

Reason: old invoices must not change if the clinic later changes logo, address, phone, or patient details.

## UPI integration plan

### V25 safe mode

Start with Manual UPI only:

- Owner enters UPI ID and optional static QR.
- Invoice PDF can show UPI ID/QR.
- Staff can manually record payment as UPI with the correct category.
- No automatic gateway reconciliation yet.

### V26 automation

Add payment gateway automation:

- Razorpay payment link/UPI link
- Cashfree payment link/order
- Webhook signature verification
- Auto-record verified payments
- Auto-update invoice document status

## UPI payment request rules

Every UPI payment request must store:

- Patient
- Amount
- Payment category
- Purpose/notes
- Provider
- Status
- Gateway reference if any
- Linked invoice document if invoice-level payment
- Linked ledger payment after success

Payment category must be one of:

- `op_fee`
- `xray_fee`
- `medication_fee`
- `treatment_fee`
- `other`
- `invoice_due_payment`

Reports must be able to show:

- UPI received today by category
- OP Fee via UPI
- X-ray via UPI
- Medication via UPI
- Treatment via UPI
- Other via UPI

## WhatsApp invoice plan

Manual click only:

- Staff taps `Send Invoice`.
- App confirms recipient phone.
- If WhatsApp Business disabled, use normal WhatsApp share/link.
- If WhatsApp Business enabled and configured, call Supabase Edge Function.
- Save every send attempt in `invoice_share_logs`.

No automatic sending after each payment.

## Build sequence

1. Branch and planning document.
2. Add additive database migration with default OFF columns/tables/RLS.
3. Add TypeScript types and feature settings fields.
4. Add Clinic Feature Settings toggles.
5. Add Invoice Settings screen.
6. Add Patient Invoice Documents section.
7. Add create invoice document flow from existing ledger.
8. Add manual WhatsApp share and share logs.
9. Add Manual UPI QR/ID on invoice.
10. Add provider credential screens, masked display only.
11. Add Razorpay/Cashfree Edge Functions and webhooks later after local demo passes.

## Testing checklist

- Existing payment collection still works.
- Existing due tracking still works.
- Feature toggles default OFF.
- Enabling invoice feature only affects current clinic.
- Invoice document combines OP/X-ray/Medication/Treatment/Other into one document.
- UPI payments remain categorized by payment category.
- WhatsApp send happens only after manual click.
- No secrets are visible after save.
- No BG Reddy clinic testing until demo clinic passes.
