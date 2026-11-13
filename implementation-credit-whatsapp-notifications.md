# Implementation Plan: Credit Bill & Cash-to-Credit WhatsApp & Live In-App Notifications

## 1. Problem Overview & Scope
1. **POS Credit Bill Save**:
   - When a bill is saved as `CREDIT` in POS, the customer needs to receive an immediate WhatsApp notification of the credit transaction (with invoice summary, current bill amount, previous recent bills, and updated total outstanding balance).
   - In addition, the app needs a **live in-app notification** (toast & SSE event) so the cashier and other connected counters/screens see the real-time credit transaction alert.
2. **Cash to Credit Conversion**:
   - When a cashier converts an existing Cash/UPI bill to `CREDIT` in the Sells page (Bill History modal), the system currently **omits `sendWhatsApp`** and does not trigger any notification.
   - The user requires that converting cash to credit sends the customer a WhatsApp notification of this credit conversion transaction and displays the live credit transaction notification in the app.
3. **Human-in-the-Loop (Rule 6)**:
   - Cashiers can view and toggle WhatsApp notifications ON/OFF in the Sells "Convert to Credit" modal (consistent with POS).
   - Cashiers can adjust or confirm customer name and 10-digit mobile number before converting.
   - Messages route through the centralized WhatsApp queue where staff can review, cancel, or re-dispatch.

---

## 2. Technical Architecture & Component Changes

### A. Backend (`src/routes/sales.ts` & `src/services/whatsappInvoiceService.ts`)
1. **`PUT /api/sales/:id` (Bill Edit & Conversion)**:
   - Support `sendWhatsApp` in payload (default to `true` when converting from non-credit to `CREDIT` if a valid 10-digit customer phone is present).
   - When converting to `CREDIT` or updating a credit bill with `sendWhatsApp: true`:
     - Calculate the freshly updated `credit_balance` for the customer.
     - Dispatch WhatsApp credit transaction notice (with invoice PDF) via `whatsappInvoiceService.sendInvoiceViaWhatsApp(id, { isConversion: true })` or customized credit notice.
     - Broadcast live SSE notification `credit_transaction_created` / `toast_alert` with details:
       - Customer name
       - Invoice number
       - Transaction type (`new_credit` or `converted_to_credit`)
       - Bill amount
       - New total outstanding credit balance.
2. **`POST /api/sales` (POS Bill Creation)**:
   - When `paymentMedium === 'CREDIT'` and bill is saved:
     - Ensure WhatsApp message queueing triggers reliably (verifying customer phone from linked customer profile if not provided in patient input).
     - Broadcast SSE `credit_transaction_created` / `toast_alert` so all active screens receive immediate live confirmation of the credit transaction and new balance.

### B. Frontend (`frontend/src/pages/Sells/index.tsx`)
1. **Convert to Credit Modal**:
   - Add a clean WhatsApp toggle chip (`WA: ON / OFF`) in the edit modal footer/header (matching POS interface).
   - Auto-enable when a valid 10-digit customer phone exists.
   - Send `sendWhatsApp: true` in `api.updateSale()` when converting to `CREDIT`.
2. **Live In-App Toast & Feedback**:
   - Provide explicit success toast with credit summary:
     `"Invoice #INV-xxx converted to Credit! ₹XXX added to [Customer Name]'s ledger (Total Balance: ₹XXX). WhatsApp notification queued."`

### C. Live Notification Handling (`frontend/src/hooks/useGlobalSseInvalidation.ts`)
1. Map `credit_transaction_created` to refresh credit customers list and trigger a live notification toast in the app.

---

## 3. Step-by-Step Execution Plan

| Step | Component | Action | Verification |
|------|-----------|--------|--------------|
| 1 | `src/services/whatsappInvoiceService.ts` | Enhance message formatting to support credit transaction & conversion captions with outstanding balance | Check generated WhatsApp caption in Marathi, Hindi, and English |
| 2 | `src/routes/sales.ts` | Enable WhatsApp queueing in `PUT /api/sales/:id` when converting to credit, and broadcast live SSE credit notification | Verify queue item in `automation_notifications` and SSE event broadcast |
| 3 | `frontend/src/pages/Sells/index.tsx` | Add WhatsApp toggle chip & pass `sendWhatsApp` payload on save | Test Convert to Credit modal UI and API payload |
| 4 | `frontend/src/hooks/useGlobalSseInvalidation.ts` | Register `credit_transaction_created` SSE event to display live in-app toast | Verify live toast appears when credit sale is created or converted |
| 5 | Performance & Guardrails | Run `npm run guardrails` and TypeScript checks (`tsc --noEmit`) | Ensure 0 errors and zero performance regressions |

---

## 4. Tasks & Progress Tracker

- [x] Task 1: Update `whatsappInvoiceService.ts` to support explicit credit transaction & cash-to-credit conversion message templates, robust 10-digit phone sanitization, and fallback to snapshot names.
  - *Completed*: Added `options?: { isConversion?: boolean }` to `sendInvoiceViaWhatsApp`, updated localized templates (Marathi, Hindi, English) with clear cash-to-credit conversion notice, outstanding balance, and attached PDF invoice.
- [x] Task 2: Update `src/routes/sales.ts` (`PUT /api/sales/:id` and `POST /api/sales`) to trigger credit WhatsApp and broadcast live in-app SSE notification.
  - *Completed*: In `POST /api/sales`, when `isCredit` is true, immediately broadcast in-app live `toast_alert` with bill number, customer name, and total outstanding ledger balance; enqueue WhatsApp credit notification with PDF and broadcast confirmation. In `PUT /api/sales/:id`, detect when `isConvertedToCredit` occurs; broadcast live in-app `toast_alert` of the conversion and new credit balance; auto-dispatch WhatsApp credit conversion notice if customer has phone and user hasn't explicitly disabled it.
- [x] Task 3: Handle conversion and credit notifications cleanly on backend without requiring frontend UI modifications per user request.
  - *Completed*: Backend intercepts `isCredit` and `isConvertedToCredit`, automatically sending the WhatsApp notice and pushing live SSE `toast_alert` across all active UI instances.
- [x] Task 4: Connect live SSE credit alert in `frontend/src/hooks/useGlobalSseInvalidation.ts`.
  - *Completed*: Existing `toast_alert: ['app-show-toast']` and `credit_updated: ['refresh-credit-customers', 'app-customers-updated']` bindings already route the SSE frames to real-time UI toasts and cache refreshes seamlessly.
- [x] Task 5: Run `npm run guardrails` and verify build and functionality.
  - *Completed*: `tsc --noEmit` and `npm run guardrails` passed with 0 errors. Speed architecture fully intact.
