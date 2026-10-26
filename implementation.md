# Implementation Plan — Morning Briefing & Refill WhatsApp Notifications Integration

## Objective
Ensure that every morning:
1. The **Store Owner Daily Briefing WhatsApp message** reliably triggers (including Today & Overdue refill prescriptions with full medicine names and stock statuses).
2. **Patient WhatsApp Refill Reminder Notifications** are automatically synced and staged in `automation_notifications` (for 1-click review/dispatch in CRM/Quick Assist or auto-dispatch if enabled).

---

## User-Confirmed Requirements
1. **Refill Scope in Owner Briefing**: Strictly **Today & Overdue** refills only (`DATE(pr.next_refill_date) <= DATE('now', 'localtime')`).
2. **Dual Morning Execution**:
   - Generate and enqueue the Store Owner Morning Briefing message (`admin_morning_briefing`).
   - Automatically stage customer refill reminder notifications (`refill_collection` / `refill_reminder`) for all active due patients during the morning check.

---

## Root Causes
1. **Scheduler Gate Suppressing Daily Check**:
   In `src/services/triggerSchedulerService.ts:170`, `const mode = await getBackendFetchMode('bg.dailyScans', 'off')` defaulted to `'off'` because `bg.dailyScans` was missing from `app_settings`. This caused the scheduled 09:00 AM cron to return immediately without running `checkAllRefills` or `sendMorningScheduleBriefingToAdmin`.
2. **Missing Notification Staging Loop in `checkAllRefills`**:
   `syncStagedRefillNotificationForPatient` was only invoked if `!refill.quick_bill_id` (on initial bill creation). Once a bill was held or if stock was missing, `syncStagedRefillNotificationForPatient` was never called, leaving `automation_notifications` completely empty for active due refills.
3. **Inner Join Fragility in Refill Details Query**:
   `buildDailyOperationalBriefing` used `JOIN medicines m ON pr.medicine_id = m.id` (INNER JOIN). If any refill had an unlinked or null `medicine_id`, it was completely omitted from the detailed morning briefing.
4. **Status Coverage**:
   Refills with status `'ordered'` were excluded from the briefing query (`status IN ('pending', 'notified', 'staged')`).

---

## Proposed Changes

### 1. `src/services/triggerSchedulerService.ts`
- Change default mode of `bg.dailyScans` from `'off'` to `'auto'` (or remove the artificial `'off'` default so daily checks always run unless explicitly configured to off).
- Ensure scheduled daily checks at 09:00 AM execute `checkAllRefills`, stage customer notifications, and send the morning operational briefing to the store owner.

### 2. `src/services/refillService.ts`
- In `checkAllRefills`:
  - Collect all distinct patients with active refills due today or within the notice window (`<= date('now', '+' || noticeDays || ' days')`).
  - Proactively call `syncStagedRefillNotificationForPatient(db, p.patient_name, p.patient_phone)` so customer notifications (`refill_collection` if ready, `refill_reminder` if waiting) are staged in `automation_notifications`.
- In `buildDailyOperationalBriefing`:
  - Change `JOIN medicines m ON pr.medicine_id = m.id` to `LEFT JOIN medicines m ON pr.medicine_id = m.id`.
  - Use `COALESCE(m.name, pr.medicine_name, pr.cart_product_name, 'Unknown Medicine') as medicine_name`.
  - Include status `'ordered'` alongside `pending`, `notified`, and `staged`.
  - Maintain the user-selected date filter: `DATE(pr.next_refill_date) <= DATE('now', 'localtime')` (Today & Overdue).

### 3. Verification & Performance Guardrails
- Run `PASS tests/` (verify refill truth tests).
- Run `npm run guardrails` (TypeScript `tsc --noEmit`, clean code standards).
- Run `node scripts/quick-update.mjs` (keep auto-knowledge graph synchronized).

---

## Detailed Tasks

### Task 1: Fix Daily Check Scheduler Gate in `triggerSchedulerService.ts`
- **File**: `src/services/triggerSchedulerService.ts`
- **Action**: Ensure `bg.dailyScans` defaults to `'auto'` instead of `'off'`, allowing the daily check cron to run automatically at 09:00 AM.

### Task 2: Proactively Stage Customer Refill Notifications in `checkAllRefills`
- **File**: `src/services/refillService.ts`
- **Action**: Add a patient staging pass at the conclusion of `checkAllRefills` that invokes `syncStagedRefillNotificationForPatient` for all due patients with active refills.

### Task 3: Robust Refill Query in `buildDailyOperationalBriefing`
- **File**: `src/services/refillService.ts`
- **Action**: Use `LEFT JOIN` on `medicines` with fallback to `pr.medicine_name`, expand status filter to include `'ordered'`, keeping strictly Today & Overdue refills.

### Task 4: Verification & Automated Guardrails
- Verify using diagnostic script that `checkAllRefills` stages customer reminders and `sendMorningScheduleBriefingToAdmin` enqueues the owner briefing.
- Run `npm run guardrails` and `node scripts/quick-update.mjs`.

---

## Task Completion Log
- [x] **Task 1: Fix Daily Check Scheduler Gate in `triggerSchedulerService.ts`**
  - Updated `getBackendFetchMode('bg.dailyScans', 'auto')` fallback from `'off'` to `'auto'`, unblocking the 09:00 AM daily check and morning briefing cron.
  - Added `sendMorningScheduleBriefingToAdmin` into `runTriggerNow('daily_check')` so manual execution also dispatches the briefing to the store owner.

- [x] **Task 2: Proactively Stage Customer Refill Notifications in `checkAllRefills`**
  - Added proactive patient staging loop at the end of `checkAllRefills` across all distinct patients with active refills due within the notice window.
  - Updated `syncStagedRefillNotificationForPatient` with `LEFT JOIN medicines m` and supported both `refill_collection` (in-stock) and `refill_reminder` (hold/ordered) types.
  - Verified that 15 customer reminder notifications were staged in `automation_notifications`.

- [x] **Task 3: Robust Refill Query in `buildDailyOperationalBriefing`**
  - Switched `refillDetailRows` query to `LEFT JOIN medicines m` with `COALESCE(m.name, pr.medicine_name, pr.cart_product_name, 'Unknown Medicine')` so unlinked items are never dropped.
  - Added `'ordered'` status to both `refillRows` and `refillDetailRows` alongside `pending`, `notified`, and `staged`.
  - Retained strict **Today & Overdue** filtering (`DATE(pr.next_refill_date) <= DATE('now', 'localtime')`).

- [x] **Task 4: Verification & Automated Guardrails**
  - Verified end-to-end execution: 15 customer reminder notifications staged, and store owner daily briefing renders Today & Overdue items with task count.
  - Passed `npm run guardrails` with 0 violations (`tsc --noEmit` clean).
  - Synchronizing auto-knowledge graph via `node scripts/quick-update.mjs`.