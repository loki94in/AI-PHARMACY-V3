# CONVERT BILL TO CREDIT FROM SELLS & POS HISTORICAL EDIT IMPLEMENTATION PLAN

## Overview
Enable pharmacists to convert ANY bill (old historical bills e.g. `#SL-1243F` from 2023, recent bills, or today's bills) mistakenly saved as CASH/UPI into CREDIT directly from the **Sells page** (`/sells`) edit modal, with automatic WhatsApp capability verification badge on patient phone number, customer credit account auto-provisioning (due date on 7th, credit_enabled = 1, credit balance update), and bypassing POS live expiry block when modifying historical bills.

---

## 1. Backend: Sale Update & Credit Conversion (`src/routes/sales.ts`)
- [x] In `PUT /sales/:id`:
  - Detect `isCredit = (paymentMedium || '').toUpperCase() === 'CREDIT'`
  - Resolve `targetPaymentStatus = paymentStatus || (isCredit ? 'UNPAID' : (paymentMedium ? 'PAID' : null))`
  - Update `sales` table: `payment_medium`, `payment_status`
  - Re-link customer cleanly by phone/name, avoiding duplicate records and saving phone to existing customer if blank
  - If converted to Credit and customer exists:
    - Update customer: set `credit_enabled = 1`
    - Auto-provision `credit_due_date` (default upcoming 7th) if empty/expired
    - Recalculate customer's `credit_balance` from unpaid credit bills (`payment_status != 'PAID'`)
  - Broadcast real-time SSE events: `sales_sync`, `inventory_sync`, `inventory_changed`, `customers_changed`, `customers_updated`, `credit_updated`

## 2. Frontend: Sells Page Edit Modal (`frontend/src/pages/Sells/index.tsx`)
- [x] Integrated `PhoneInputWithBadge` for patient phone number with live WhatsApp check badge
- [x] In `openEditModal(invoice, forceMedium?, allowOldFy?)`:
  - Allow editing historical old FY bills for patient/phone/payment modifications without altering historical medicine lines
  - Provide direct "Convert to Credit" action in invoice preview drawer (`viewInvoice`)
  - Added Option 3 in Old Financial Year modal to allow updating payment mode & customer info without touching stock
- [x] In `handleSaveEdit`:
  - Validates patient name and 10-digit mobile number if converting to Credit
  - Sets `paymentStatus: editPaymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID'`
  - Optimistically updates UI row and invalidates caches

## 3. Frontend: POS Historical Expiry Safety Bypass (`frontend/src/pages/POS/index.tsx`)
- [x] In POS checkout expiry validation (around line 3681):
  - Wrapped expiry check with `if (!editingInvoiceId)`
  - New sales are strictly blocked from dispensing expired medicines
  - Editing existing saved/historical bills (e.g. from 2023 with 2024 expiry dates) bypasses the live expiry block so payment mode/customer can be updated without obstruction

## 4. Live Data Fix: Invoice `#SL-1243F`
- [x] Patched customer Sunita Gunjawate (`phone = '9529518170'`, `credit_enabled = 1`, `credit_due_date = '2026-12-07'`)
- [x] Converted Invoice `#SL-1243F` (`payment_medium = 'CREDIT'`, `payment_status = 'UNPAID'`, `customer_phone_snapshot = '9529518170'`)
- [x] Recalculated customer credit balance (₹923.52) in both `./data/app.db` and `G:/AI Pharmacy OS/data/app.db`

## 5. Verification & Guardrails
- [x] Ran `npm run guardrails` (`tsc --noEmit`) - PASS (0 violations)
- [x] Ran `node scripts/quick-update.mjs` - PASS (0 errors, 1625 nodes)
- [x] Git commit and push to remote
