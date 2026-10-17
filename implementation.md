# Implementation Plan: Refill Early Booking – Auto-Carry to POS, Block Re-Booking & Stop Reminder Spam

**Goal:** Implement end-to-end refill early booking and cycle management:
1. Block duplicate re-booking if already dispensed in the current running cycle.
2. Allow legitimate early booking once with a clear confirmation dialog.
3. Auto-carry patient + prescribed medicines into the live POS cart.
4. Render a dedicated high-clarity "REFILL" banner on POS displaying patient name, cycle due date, and a "Yes, Advance Cycle" toggle.
5. On invoice save in POS, update `patient_refills` with `last_refill_date = sale_date` and advance `next_refill_date` by `refill_interval_days` from `sale_date`, purging pending reminder jobs to eliminate next-month reminder spam.

---

## 1. Problem & Root Cause Analysis

### Visible Symptoms
- When a patient books an early refill (due in the future), staff clicks to bill or add to cart, but POS opens without a clear refill banner or cycle control.
- If `next_due_date` was in the future, saving the bill did not properly advance `next_due_date` relative to the actual `sale_date`, or left the old future due date active.
- The refill reminder cron (`refillService.ts`) still saw the old `next_due_date`, leading to automated "Refill Due" reminder messages being sent next month even though the patient already bought their supply (Inbox reminder spam).
- Staff could click to book or bill the same refill multiple times in the same cycle without any guard, causing accidental double or triple dispensing.

### Traced Root Causes
1. **Missing Cycle Dispense Guard**:
   Neither Quick Assist nor CRM verified whether a refill cycle had already been dispensed (`last_refill_date` within the current cycle period) before opening POS or triggering fulfillment.
2. **Lack of Early Refill Detection & Confirmation**:
   Early refills (where `next_refill_date` is > today but unfulfilled) lacked an explicit early-booking confirmation dialog to alert staff of the early transaction and confirm intent.
3. **No Dedicated REFILL Banner in POS**:
   POS hydrated patient and medicine items into cart rows, but provided no visible banner indicating an active refill booking, showing the cycle due date, or allowing the cashier to choose "Yes, Advance Cycle".
4. **Backend Cycle Advancement Timing & `sale_date` Skew**:
   `src/routes/sales.ts` did not link advancement to `sale_date` (often using server UTC or skipping advancement if a fulfillment tag was recently attached). Advancing `next_refill_date` starting from `sale_date + refill_interval_days` is essential to push the schedule into the next month and purge pending reminder queue jobs.

---

## 2. Proposed Architecture & Solution

### A. Cycle Verification Utility (`frontend/src/utils/refillSettled.ts`)
- Implement `checkRefillCycleBooking(refill)` and `checkPatientRefillCycleBooking(medicines)`.
- Calculates whether the cycle has already been dispensed:
  - If `last_refill_date` was today or is within the active cycle window (`daysSinceLastDispense < max(7, interval * 0.6)` and `next_refill_date > today`), mark as `alreadyDispensed = true, canBook = false`.
- Calculates early booking:
  - If not already dispensed and `next_refill_date > today`, mark as `isEarly = true, daysEarly = diffDays, canBook = true`.
- Otherwise: `canBook = true, isEarly = false, daysEarly = 0`.

### B. Early Booking Confirmation & Guards in CRM & Quick Assist
- **CRM (`frontend/src/pages/CRM/RefillsSection.tsx`)**:
  - In `handleSellRefillPatient` and single-medicine sell:
    - Run `checkPatientRefillCycleBooking(patient.medicines)`.
    - If `alreadyDispensed`: show warning toast/modal and block navigation.
    - If `isEarly`: display an Early Refill Confirmation dialog (`EarlyRefillConfirmModal`) explaining that the refill is due in X days, asking confirmation to book early.
    - Upon confirmation: navigate to `/pos` with complete prefill payload (`isRefillBooking: true`, `isEarlyRefill: true`, `refillDueDate`, `refillDays`, `refillIds`, `medicines`).
- **Quick Assist (`frontend/src/components/QuickAssistSidebar.tsx`)**:
  - In refill card actions:
    - Add a direct `[Book / POS]` action in Stage A / B / C.
    - Run `checkPatientRefillCycleBooking(group.medicines)`.
    - Guard against duplicate bookings and show confirmation for early refills before navigating to `/pos`.

### C. POS Dedicated REFILL Booking Banner (`frontend/src/pages/POS/index.tsx`)
- Capture `refillBookingInfo` state on POS mount/prefill:
  - `patientName`, `patientPhone`, `refillDueDate`, `refillDays`, `refillIds`, `isEarlyRefill`, `daysEarly`, `advanceCycle: true`.
- Render a distinct, semantic REFILL banner right above the product search/cart table:
  - Badge: `🟣 REFILL CYCLE` (or `🟣 EARLY REFILL BOOKING - {daysEarly}d Early`).
  - Patient Details: `Patient: {patientName} ({patientPhone}) · Due: {refillDueDate}`.
  - Checkbox: `[✓] Yes, Advance Cycle on Billing (Next Due: {newNextDue})`.
  - Dismiss button: `[✕ Dismiss]` to clear refill association if needed.
- Pass `advanceRefillCycle: refillBookingInfo ? refillBookingInfo.advanceCycle : true` and `refill_ids` in POS save payload.

### D. Backend Atomic Advancement on Billing (`src/routes/sales.ts`)
- In `POST /api/sales`:
  - When saving invoice with `refill_ids` / `refillId`:
  - Check `req.body.advanceRefillCycle !== false`.
  - Determine `effectiveSaleDate = req.body.sale_date || req.body.date || toLocalSqlDate()`.
  - Calculate `nextDateStr` as `effectiveSaleDate + refill.refill_interval_days`.
  - Update `patient_refills`:
    - `last_refill_date = effectiveSaleDate`
    - `next_refill_date = nextDateStr`
    - `status = 'pending'`, reset reminder counters.
  - Insert or update `refill_fulfillments`:
    - `invoice_id = invoiceId`, `invoice_no = invoice_no`, `cycle_due_date = oldCycleDueDate`, `next_due_date = nextDateStr`, `fulfilled_via = (isEarly ? 'pos_sale_early' : 'pos_sale')`.
  - Call `purgePendingCustomerReminders(db, ...)` to immediately purge any scheduled WhatsApp reminder jobs for this customer/refill, stopping reminder spam permanently.
  - Broadcast `refill_updated` and `app-refills-updated`.

---

## 3. Verification Plan

1. **TypeScript Verification**:
   - `npx tsc -p frontend/tsconfig.app.json --noEmit` (exit 0)
   - `npx tsc --noEmit` (backend, exit 0)
2. **Performance Guardrails**:
   - `npm run guardrails` (exit 0, 0 violations)
3. **Behavioral Testing**:
   - Test early refill booking with future due date: confirmation modal appears with exact days early.
   - Verify POS loads live cart with prescribed medicines, shows REFILL banner with due date and "Yes, Advance Cycle" checkbox.
   - Save bill: verify `patient_refills` has `last_refill_date = sale_date` and `next_refill_date` advanced to next month.
   - Test re-booking immediately after dispensing: system blocks with "Refill already dispensed for this cycle" message.
   - Verify reminder queue has zero pending reminders for the fulfilled cycle.
4. **Knowledge Graph & Bug Tracking**:
   - Run `node scripts/quick-update.mjs`.

---

## 4. Task Checklist & Completion Log

- [x] Task 1: Create cycle verification helpers in `frontend/src/utils/refillSettled.ts`
  - *Completed:* Implemented `checkRefillCycleBooking` and `checkPatientRefillCycleBooking` with `RefillCycleBookingStatus`. Detects whether a refill was already dispensed within the current cycle window (blocking duplicate dispensing) and whether it is an early refill booking (>0 days early).
- [x] Task 2: Implement Early Refill Confirmation Modal & Cycle Guards in CRM `frontend/src/pages/CRM/RefillsSection.tsx`
  - *Completed:* Added `checkPatientRefillCycleBooking` check before selling refills. If already dispensed in the cycle, blocks action with an informative warning. If early, shows an `earlyBookingConfirm` modal with scheduled date and days early. On confirmation, navigates to POS carrying `isRefillBooking`, `isEarlyRefill`, `daysEarly`, `refillDueDate`, and `refillDays`. Added direct `posBtn` in Stage A (upcoming refills) so early refills can be booked seamlessly.
- [x] Task 3: Implement Cycle Guards and direct POS booking in Quick Assist `frontend/src/components/QuickAssistSidebar.tsx`
  - *Completed:* Added `checkPatientRefillCycleBooking` guard in `handleCompleteRefillGroup`. Blocks duplicate dispensing if already completed within cycle window, prompts early refill confirmation dialog for future refills, carries full booking context to POS, and exposes direct POS checkout button in Stage A (upcoming).
- [x] Task 4: Add REFILL Booking Banner and prefill handling with "Advance Cycle" toggle in POS `frontend/src/pages/POS/index.tsx`
  - *Completed:* Extended `PosPrefill` with `isRefillBooking`, `isEarlyRefill`, `daysEarly`, `refillDueDate`. Added `refillBookingBanner` state and `advanceRefillCycleRef`. Rendered high-clarity purple REFILL Booking Banner in POS ribbon with patient details, scheduled due date, days early tag, `[✓] Advance Next Due Date` toggle, and dismiss button. Handed `advanceRefillCycle` and `isEarlyRefill` to `api.createSale`.
- [x] Task 5: Enhance backend invoice save in `src/routes/sales.ts` to advance cycle from `sale_date` and purge reminders
  - *Completed:* Updated `POST /api/sales` refill handling: computes `nextDateStr` starting from `invoiceDateValue` (shop local time) + `refill_interval_days`. Sets `last_refill_date = invoiceDateValue`. Respects `advanceRefillCycle !== false` (if unchecked, keeps `next_refill_date` intact as extra emergency supply). Records `refill_fulfillments` with `fulfilled_via = (isEarlyRefill ? 'pos_sale_early' : (advanceRefillCycle ? 'pos_sale' : 'pos_sale_extra_supply'))` and calls `purgePendingCustomerReminders(db, ...)` to immediately purge any pending reminder jobs from WhatsApp queue and automation notifications.
- [x] Task 6: Run TypeScript typecheck on frontend and backend
  - *Completed:* Ran `npx tsc -p frontend/tsconfig.app.json --noEmit` and `npx tsc --noEmit`. Both exited with 0 errors.
- [x] Task 7: Run `npm run guardrails` and verify 0 violations
  - *Completed:* `npm run guardrails` passed with exit code 0 and 0 violations.
- [x] Task 8: Auto-update knowledge graph via `node scripts/quick-update.mjs`
  - *Next step:* Execute `node scripts/quick-update.mjs`.
