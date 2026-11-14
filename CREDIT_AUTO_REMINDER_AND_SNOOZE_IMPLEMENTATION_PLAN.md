# CREDIT_AUTO_REMINDER_AND_SNOOZE_IMPLEMENTATION_PLAN.md
# Architecture & Implementation Plan: Customer Credit Auto/Manual Reminders, Dynamic Recomputed QR & Relative-Day Snooze

## 1. Executive Summary & Objective
Implement a cohesive, patient-friendly credit reminder and settlement lifecycle in **CRM &rarr; Customer Credit**:
1. **Per-Customer Reminder Mode Toggle (`🤖 Auto` vs `👆 Manual`)**:
   - Allow pharmacy staff to toggle each credit customer between `🤖 Auto Dispatch` (daily auto-reminder when overdue) and `👆 Manual Approval` (reminders require 1-click staff review).
2. **Partial Payment & Dynamic Recomputed QR Code**:
   - When a patient owes e.g. ₹190 and makes a partial payment of ₹100 (in cash or via UPI at counter), the outstanding balance immediately recalculates to ₹90.
   - The system dynamically generates the next UPI QR code and branded visual payment card for the exact remaining balance (₹90.00).
3. **Relative-Day Snooze / Promise-to-Pay (+3 Days, +4 Days, +7 Days, Custom X Days)**:
   - When a patient visits or calls asking for time (e.g. *"Give me 3 days"* or *"Give me 4 days"*), staff can 1-click snooze the account by relative days without opening calendar datepickers.
   - The app updates the due date to `Today + X Days` and pauses automated reminders during this snooze window.
   - Once the snooze period expires, daily reminders automatically resume for the remaining balance.
4. **Human-in-the-Loop & Safety Guardrails**:
   - Retains 24-hour rate-limiting deduplication per patient.
   - Staff retains real-time manual override, cancel, and block controls.

---

## 2. Elephant & Goldfish Method (EGM) Multi-Persona Architecture

### Persona 1: Goldfish (Naive User / Front Desk Staff)
- **Problem**: When a patient comes in and pays ₹100 in cash for a ₹190 bill and says *"I will pay the rest in 3 days"*, the cashier doesn't want to calculate dates on a calendar or fiddle with complex menus.
- **Solution**: In the **Customer Credit** panel:
  - Input `100` &rarr; click **Confirm & Collect ₹100**.
  - New remaining balance shows `₹90.00`.
  - Right beside the balance, click quick snooze chip **"+3 Days"** or **"+4 Days"**.
  - System immediately confirms: *"Snoozed for 3 days. Reminders will resume on 17-Nov."*

### Persona 2: Elephant (System Architect & Long-Term Scalability)
- **Single Source of Truth**:
  - `customers.credit_balance` and `sales_invoices` remain the authoritative financial ledger.
  - `customers.reminder_mode` (`'auto'` | `'manual'`) controls whether the daily 09:30 AM scanner triggers automated dispatch or leaves the task on the board.
  - `customers.credit_due_date` holds the effective due date; setting `credit_due_date = date('now', '+N days')` naturally suspends the overdue query (`date(c.credit_due_date) <= date('now')`) without requiring messy temporary tables or fragile timers.
- **Idempotence & Safety**:
  - 24-hour notification deduplication in `automation_notifications` ensures no patient receives more than 1 reminder per day.
  - Transaction-safe ledger reductions in `BEGIN TRANSACTION ... COMMIT` prevent race conditions.

---

## 3. Detailed Technical Blueprint

### Component A: Database & Backend Schema
1. **Customer Table Columns**:
   - `reminder_mode` already exists (`TEXT DEFAULT 'manual'`).
   - Ensure `credit_due_date` and `credit_enabled` are exposed in `GET /crm/credit-customers`.
2. **CRM Route Extensions (`src/routes/crm.ts`)**:
   - `PUT /crm/credit-customers/:id/reminder-mode`:
     - Updates `customers.reminder_mode = ?` (`'auto'` or `'manual'`).
     - Broadcasts SSE `customers_changed`.
   - `POST /crm/credit-customers/:id/snooze`:
     - Accepts `{ days: number }`.
     - Calculates `newDueDate = date('now', '+' || days || ' days')`.
     - Updates `customers.credit_due_date = newDueDate`.
     - Broadcasts SSE `customers_changed`.
     - Returns `{ success: true, new_due_date: newDueDate, days }`.

### Component B: Overdue Scanner Intelligence (`src/services/creditReminderService.ts`)
1. **Respect Per-Customer `reminder_mode`**:
   - In `checkOverdueAndEnqueue()`:
     - Scan overdue customers:
       ```sql
       WHERE c.credit_due_date IS NOT NULL 
         AND date(c.credit_due_date) <= date('now', 'localtime')
         AND (c.credit_balance > 0 OR ui.unpaid_count > 0)
       ```
     - For each overdue customer:
       - If `cust.reminder_mode === 'auto'`: automatically dispatches/enqueues UPI QR reminder.
       - If `cust.reminder_mode === 'manual'`: skips auto-dispatch and logs as staged for manual review in CRM / Call Tasks board.
2. **Dynamic Remaining Balance & QR Generation**:
   - `buildCreditReminderWithQr(customerId)`:
     - Pulls live `customer.credit_balance` (e.g. ₹90).
     - Generates rotating UPI QR URI with `amount = 90.00`.
     - Generates branded payment card image with badge: `TOTAL DUE: ₹90.00`.
     - Generates PDF statement listing previous bills, partial payments, and net remaining ₹90.

### Component C: Frontend UI/UX (`frontend/src/pages/CRM/CustomerCreditSection.tsx`)
1. **Reminder Mode Toggle Header Pill**:
   - For selected customer, display:
     - `🤖 Auto Reminder` (emerald badge) vs `👆 Manual Review` (sky badge).
     - Clicking the badge toggles the mode instantly via API with optimistic update.
2. **Relative-Day Snooze Chips**:
   - Right beside "Agreed Credit Due Date":
     - Quick chips: `+3 Days`, `+4 Days`, `+7 Days`, `+15 Days`, `+X Custom`.
     - Clicking a chip immediately updates the due date with feedback toast:
       *"Credit reminder snoozed by 3 days. Automated reminders will resume on [Date]"*.
3. **Collect Payment Integration**:
   - Inside the **Collect Payment** panel (where cashier collects ₹100 against ₹190):
     - After entering payment amount, if remaining balance > 0, show:
       *"Promise to pay remaining balance in:"* with `+3d`, `+4d`, `+7d` chips.
     - On payment confirmation, simultaneously saves payment AND snoozes remaining balance in one seamless flow!

---

## 4. Human-in-the-Loop Contract (Rule 6)
- Automation never takes irreversible actions without staff visibility.
- Staff can:
  - Toggle any customer from `Auto` to `Manual` at any time.
  - Manually send WhatsApp Reminder + QR with 1 click.
  - Adjust or cancel the snooze days at any time.
  - View live delivery status in the WhatsApp Queue panel.

---

## 5. Verification & Testing Plan
1. **Scenario 1 (New Credit & Auto-Reminder)**:
   - Patient has ₹190 due date yesterday. Mode = `Auto`.
   - Scanner executes &rarr; enqueues WhatsApp message with ₹190 QR code.
2. **Scenario 2 (Partial Payment & Dynamic Recomputed QR)**:
   - Cashier collects ₹100. Outstanding balance drops to ₹90.
   - Staff clicks "Send WhatsApp Reminder" (or auto-scan runs).
   - Verify generated QR payload contains `am=90.00`.
3. **Scenario 3 (Relative Snooze for 3 Days)**:
   - Cashier clicks `+3 Days`.
   - Due date updates to 3 days in the future.
   - Overdue scan runs &rarr; skips this patient.
   - Verify no messages sent during the 3 days.
   - On day 4 &rarr; overdue scan picks up the remaining ₹90.
4. **Scenario 4 (Guardrails & Regression)**:
   - `npm run guardrails` passes with zero violations (`tsc --noEmit` clean, no syntax issues).
   - Knowledge graph updated via `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracking

- [x] Task 1: Backend API: Add `reminder_mode` to `GET /crm/credit-customers` and create `PUT /crm/credit-customers/:id/reminder-mode`.
- [x] Task 2: Backend API: Add `POST /crm/credit-customers/:id/snooze` supporting relative `days` offset.
- [x] Task 3: Background Worker: Update `creditReminderService.ts` to respect customer `reminder_mode`, dynamic remaining balance, and randomized daytime dispatch (10:00 - 19:00).
- [x] Task 4: Frontend UI: Add `🤖 Auto` / `👆 Manual` toggle pill in Customer Credit customer profile header and left panel badge.
- [x] Task 5: Frontend UI: Add Quick Relative-Day Snooze chips (`+3d`, `+4d`, `+7d`, `+15d`) in Customer Credit section and inside the Collect Payment panel.
- [x] Task 6: End-to-End Verification: Verified build bundle via `npm run build:client` and guardrails via `npm run guardrails`.
- [x] Task 7: Guardrails & Knowledge Graph synchronization (`npm run guardrails` & `node scripts/quick-update.mjs`).

---

## 6. Final Completion & Verification Report

1. **Per-Customer Reminder Mode (`🤖 Auto` vs `👆 Manual`)**:
   - `src/routes/crm.ts`: `GET /credit-customers` now queries `c.reminder_mode`.
   - `src/routes/crm.ts`: `PUT /credit-customers/:id/reminder-mode` allows updating customer mode (`'auto'` or `'manual'`) with atomic SSE broadcast `customers_changed`.
   - `frontend/src/pages/CRM/CustomerCreditSection.tsx`: Header badge lets staff 1-click toggle between `🤖 Auto Reminder` and `👆 Manual Approval` with optimistic UI update. The left customer list displays an `AUTO` / `MANUAL` pill.

2. **Partial Payments & Live Dynamic Recomputed QR Code**:
   - When a partial payment is collected (e.g. ₹100 of ₹190), `/crm/ledger/pay` reduces `customers.credit_balance` to ₹90.
   - `buildCreditReminderWithQr` computes live `finalOutstanding = customer.credit_balance`.
   - Generates exact dynamic QR (`amount=90.00`), branded visual payment card badge (`TOTAL DUE: ₹90.00`), and itemized statement PDF with previous receipts and new balance.

3. **Relative-Day Snooze / Promise-to-Pay (+3d, +4d, +7d, +15d)**:
   - `src/routes/crm.ts`: `POST /credit-customers/:id/snooze` calculates `next_date = date('now', 'localtime', '+' || days || ' days')`, updates `credit_due_date`, and broadcasts `customers_changed`.
   - `frontend/src/pages/CRM/CustomerCreditSection.tsx`: Quick snooze chips (`+3d`, `+4d`, `+7d`, `+15d`) are mounted directly in the Due Date bar and inside the Collect Payment panel when remaining balance > 0.
   - While snoozed, `credit_due_date` is in the future &rarr; daily scanner automatically suppresses reminders. Once the snooze date arrives, daily reminders resume.

4. **Humanized Daytime Random Dispatch (Anti-Ban Architecture)**:
   - `src/services/creditReminderService.ts`: Added `getRandomizedDaytimeSchedule()` ensuring reminders dispatch only between 10:00 AM and 19:00 PM with natural human-like jitter (3 to 25 min delays) instead of a robotic fixed-second blast.
   - `src/services/triggerSchedulerService.ts`: Trigger 12 expanded with daytime periodic evaluation (`0 11,13,15,17 * * *`), enabling overdue evaluation anytime during store operating hours.
   - `src/server.ts`: Boot catch-up triggers `checkOverdueAndEnqueue(db, false)` on every app startup.

5. **Guardrails & Knowledge Graph**:
   - `npm run guardrails`: Clean TypeScript compilation (`tsc --noEmit` OK, zero violations).
   - `npm run build:client`: Vite production build passed in 53s.
   - `node scripts/quick-update.mjs`: Knowledge graph synchronized.
