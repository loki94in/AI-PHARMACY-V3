# Implementation Plan: Credit Due WhatsApp Reminder, Branded QR Card & Statement PDF

## Goal
Upgrade the WhatsApp credit customer reminder system so:
1. The **WhatsApp message** is minimal, clear, and focused on the **final due amount**, with an urgent/respectful reminder and a **direct one-tap UPI payment link** (`upi://pay?...`).
2. A **branded payment QR card** (identical quality to the ₹50 booking advance card) is generated with the exact final due balance badge, store header, and customer name.
3. The **attached PDF statement** contains the complete itemized transaction history — all pending bills, dates, exact medicines & quantities purchased, old pending balance, partial payments made (e.g. if paid half), final net balance due, and pharmacy credentials (Name, Address, Phone, D.L. number, GSTIN).
4. `whatsappClient.ts` cleanly dispatches both the QR Card image and the Statement PDF document without dropping either.

---

## Architecture & Components to Modify

### 1. `src/services/paymentQrService.ts`
- Enhance `PaymentCardOptions` to support custom card titles (e.g., `"Credit Due Settlement"`), customer subtitle, and custom amount badges (e.g., `"TOTAL DUE: ₹570.00"`).

### 2. `src/services/pdfInvoiceService.ts`
- Upgrade `generateCreditStatementPdf`:
  - Fetch `sale_items` with joined `medicines` and `inventory_master` for each pending invoice to list medicine names and quantities.
  - Calculate gross invoices total, partial payments/credits applied, and current net `credit_balance`.
  - Display detailed invoice rows with medicine itemization and dates ("what and when they purchased").
  - Show a clear ledger calculation block:
    - Total Gross Invoices
    - Payments / Credits Received (partial payment)
    - Net Outstanding Due Balance
  - Embed a readable UPI QR code directly on the PDF.

### 3. `src/i18n/messages.json`
- Update `whatsapp.creditReminder` in English (`en`), Hindi (`hi`), and Marathi (`mr`):
  - Focus on final due amount, due date, tap-to-pay UPI link (`{{upiUri}}`), mention of attached PDF statement, urgent payment call-to-action, and pharmacy details.

### 4. `src/services/creditReminderService.ts`
- Update `buildCreditReminderWithQr`:
  - Pass `upiUri`, `finalOutstanding`, customer name, and store info to `paymentQrService.generatePaymentCard` to create the branded card.
  - Generate the comprehensive PDF statement via `pdfInvoiceService.generateCreditStatementPdf`.
  - Format the message using the updated i18n template including `{{upiUri}}`.
  - Pass the QR card image and PDF statement to `whatsappQueueWorker.enqueue`.

### 5. `src/whatsappClient.ts`
- In `sendMessage`, when both `file` (image) and `mediaPath` (PDF document) are provided:
  - Deliver the QR Card image with the text caption.
  - Then deliver the PDF document as a document attachment so neither is dropped.

---

## Verification & Guardrails Plan
1. Run `npx tsc --noEmit` to verify type safety.
2. Run `npm run guardrails` to verify project speed & architecture guardrails.
3. Run `node scripts/quick-update.mjs` to keep the auto-knowledge graph synchronized.
4. Test credit reminder generation and PDF generation with a test script.

---

## Tasks Progress Tracker
- [x] Task 1: Update `src/services/paymentQrService.ts` for flexible credit card generation.
  - *Completed*: Added `cardTitle`, `subtitle`, and `badgeLabel` options to `PaymentCardOptions` in `paymentQrService.ts`. Allows custom styled header badge (`TOTAL DUE: ₹...`) and customer tag for credit card settlement.
- [x] Task 2: Update `src/services/pdfInvoiceService.ts` to include medicine line items, partial payment accounting, and shop credentials.
  - *Completed*: In `generateCreditStatementPdf`, added queries to `sale_items` joined with `medicines`/`inventory_master` to render individual medicine names & quantities per bill. Added partial payment accounting (`Total Invoices`, `Less Partial Payments Received`, `Total Outstanding Payable`). Also embedded a readable UPI payment QR code on the PDF statement.
- [x] Task 3: Update `src/i18n/messages.json` with clean, tap-to-pay message templates for EN, HI, MR.
  - *Completed*: Streamlined `creditReminder` across English, Hindi, and Marathi to display the customer name, total outstanding due, due date, direct `upi://pay...` one-tap payment link (`{{upiUri}}`), mention of attached PDF statement, urgent settlement request, and store info.
- [x] Task 4: Update `src/services/creditReminderService.ts` to coordinate branded card generation, PDF statement, and queue dispatch.
  - *Completed*: Generates the `upiUri` first, generates the branded visual payment card using `paymentQrService.generatePaymentCard`, passes `upiDetails` to `generateCreditStatementPdf`, compiles message with `{{upiUri}}`, and enqueues both attachments.
- [x] Task 5: Update `src/whatsappClient.ts` to deliver both QR image and PDF document sequentially.
  - *Completed*: In `sendMessage`, added secondary attachment dispatch when both `file` (the branded card image) and `mediaPath` (the PDF statement) are passed, ensuring neither is dropped.
- [x] Task 6: Verify TypeScript compilation, test script execution, guardrails, and knowledge graph update.
  - *Completed*: Verified with `tsc --noEmit` (0 errors), executed end-to-end generation in `scratch/test_credit_reminder.ts`, verified `npm run guardrails` (PASS — no violations), and ran `node scripts/quick-update.mjs`.
