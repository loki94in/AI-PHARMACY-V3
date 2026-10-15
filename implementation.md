# Implementation Plan: Refill Complete Persistence Fix & Search Truthfulness

## 1. Problem Statement & Root Cause Analysis
- **User Symptom**: After clicking Fulfill Cycle / ✓ Complete / Complete, the app toasts success and the notification/history records the order as marked complete — but after restarting the app, the same completed refills reappear in Quick Assist and CRM overdue/lead lists.
- **Root Cause**:
  1. *Recurring Model*: `patient_refills` rows are persistent recurring schedules (`is_active=1, status='pending'`). Marking complete advances `next_refill_date` and inserts a history audit row into `refill_fulfillments`.
  2. *Transient Hide in Memory*: Quick Assist relied on React `optimisticHiddenRefillKeys` state, which vanishes on app restart.
  3. *Date & Query Skew*: In `src/routes/refills.ts`, `POST /:id/fulfill` was un-transactioned, `PUT /:id` and `handleRefillStatusUpdate` used UTC `toISOString()` causing boundary skews, and GET `/panel` was queried by Layout without `upcoming_days=7`.
  4. *Background Resurrect*: In `src/services/refillService.ts:checkAllRefills`, on startup or trigger, due items (or short interval items) were re-evaluated without checking if the cycle was already fulfilled today, immediately recreating quick bills and special orders.
  5. *Idempotency Absence*: Double-clicking or retrying fulfill could duplicate `refill_fulfillments` records.
  6. *Search Truthfulness*: Searching medicines must never bleed or show another order/cycle's cached facts as current data.

---

## 2. Implementation Checklist & Tasks

### Task 1: Backend Unified Refill Close Helper & Date Normalization (`src/routes/refills.ts`)
- [x] **1.1 Unified `closeRefillCycle` Transaction Helper**: Created an atomic helper `executeCloseRefillCycles` in `src/routes/refills.ts` handling:
  - Pre-insert idempotency check on `refill_fulfillments` by `(refill_id, cycle_due_date)`.
  - Stamping `refill_fulfillments` with exact local SQL date (`toLocalSqlDateTime`), preserving `fulfilled_via`.
  - Updating `patient_refills` in-place (`last_refill_date = localNow`, `next_refill_date = nextDateStr`, reset `cart_*`, `quick_bill_id = NULL`, `status = 'pending'`, `is_ready = 0`, `hold_for_stock = 0`, etc.).
  - Atomically closing companion `special_orders`.
  - Purging pending WhatsApp reminders & updating staged notifications.
- [x] **1.2 Single-Fulfill Route (`POST /:id/fulfill`)**: Refactored to execute within a SQLite transaction (`BEGIN TRANSACTION` ... `COMMIT`), using idempotency and `toLocalSqlDateTime`.
- [x] **1.3 Batch-Fulfill Route (`POST /patient/:phone/fulfill-all`)**: Unified on `executeCloseRefillCycles` with per-cycle idempotency check and date normalization.
- [x] **1.4 Status-Update Route (`handleRefillStatusUpdate`)**: Unified `completed`/`fulfilled` handling to use the same durable close logic and replaced `toISOString()` with `toLocalSqlDateTime()`.
- [x] **1.5 Replace UTC `toISOString()` in Refill Routes**: Cleaned up `PUT /:id` (line 600) and `POST /:id/skip` (line 655) to use `toLocalSqlDateTime()`.

### Task 2: Background Worker Startup Resilience (`src/services/refillService.ts`)
- [x] **2.1 Skip Same-Day Fulfilled Cycles**: In `checkAllRefills()`, skipped any refill whose `last_refill_date` date part is today (`last_refill_date.slice(0, 10) === todayYmd`) to prevent resurrecting quick bills or out-of-stock special orders for a cycle fulfilled today. Also added the same guard to `syncStagedRefillNotificationForPatient`.

### Task 3: Server-side Query Optimization (`frontend/src/services/api.ts` & `frontend/src/components/Layout.tsx`)
- [x] **3.1 Update `api.getRefillsPanel`**: Allowed passing optional query parameters `{ upcoming_days?: number; all_stores?: boolean }`.
- [x] **3.2 Layout Refill Query**: In `frontend/src/components/Layout.tsx`, queried refills using `api.getRefillsPanel({ upcoming_days: 7 })` for the Quick Assist sidebar, keeping the query light and filtering out far-future schedules.

### Task 4: Frontend Durable Hiding & Settlement Guardians (`frontend/src/utils/refillSettled.ts`, `frontend/src/components/QuickAssistSidebar.tsx`, `frontend/src/pages/CRM/RefillsSection.tsx`)
- [x] **4.1 Extend `refillSettled.ts`**: Added `isRefillFulfilledToday` helper checking if `last_refill_date` matches today's local date. Updated `isRefillSettled` and `isPatientRefillsSettled` so fulfilled-today rows are treated as settled for the current actionable window.
- [x] **4.2 Quick Assist Actionable Filter**: In `QuickAssistSidebar.tsx:822-843`, filtered out refills fulfilled today (`isRefillFulfilledToday(r) === true`) from `actionableRefills`, ensuring they do not display as actionable cards across restarts.
- [x] **4.3 CRM Overdue & Lead Filter**: In `RefillsSection.tsx:1161-1200`, guarded Overdue and Lead-window tab counts and list filters with the same `isRefillFulfilledToday` check so a cycle fulfilled today is never shown in Overdue or Lead-window. Added `last_refill_date` to `RefillPatient` in `crmTypes.ts` and exposed it in `/refills/panel`.

### Task 5: Search Truthfulness Audit (`src/routes/sales.ts` verify-only & medicine search verification)
- [x] **5.1 Verify Sales 30-min Attach**: Confirmed `src/routes/sales.ts` lines 798-815 properly recognize `quick_assist_complete` and do not double-advance.
- [x] **5.2 Search Integrity Verification**: Verified that searching a medicine in POS, Purchases, and CRM renders only live catalog/batch/link facts, never past orders or old cycle cart data. On cycle fulfill, `cart_*` is set to NULL so search reflects live state only.

### Task 6: Bug Register Update (`SMALL_BUG_FIX_PLAN.md`)
- [x] **6.1 Document P1-88 in `SMALL_BUG_FIX_PLAN.md`**: Added the complete entry detailing symptom, root cause, fix, and verification.

### Task 7: Verification & Guardrails
- [x] **7.1 Type Checking**: Run `npx tsc --noEmit` (exit 0) and frontend `npm --prefix frontend run build` (exit 0 in 40.27s).
- [x] **7.2 Performance Guardrails**: Run `npm run guardrails` (exit 0, PASS).
- [x] **7.3 Knowledge Graph**: Run `node scripts/quick-update.mjs` (exit 0 in 3.5s).

---

## 3. Completed Log (Updated After Each Task)

### Task 1 Completion Details:
- Created `executeCloseRefillCycles(db, refills, fulfilledVia)` in `src/routes/refills.ts`.
- Enforced atomic transaction (`BEGIN TRANSACTION` ... `COMMIT` / `ROLLBACK`).
- Added per-cycle idempotency: queries `refill_fulfillments` with `refill_id` and `cycle_due_date` before insert to prevent duplicate fulfillment rows on retries or double clicks.
- Replaced UTC `toISOString()` with `toLocalSqlDateTime()` across `executeCloseRefillCycles`, `PUT /:id`, and `POST /:id/skip`.
- Wrapped `POST /:id/fulfill`, `POST /fulfill-all`, and `handleRefillStatusUpdate` to call `executeCloseRefillCycles`.
- Atomically closed companion `special_orders` and purged pending reminders.

### Task 2 Completion Details:
- In `src/services/refillService.ts:checkAllRefills`, computed local `todayYmd` and added a durable skip for any refill where `refill.last_refill_date.slice(0, 10) === todayYmd`. This prevents boot scans from creating quick bills, special orders, or ready flags for cycles completed today.
- Added same-day exclusion to `syncStagedRefillNotificationForPatient` query (`AND (pr.last_refill_date IS NULL OR substr(pr.last_refill_date, 1, 10) != date('now', 'localtime'))`).

### Task 3 Completion Details:
- Updated `frontend/src/services/api.ts:getRefillsPanel` to accept `{ upcoming_days?: number; all_stores?: boolean }`.
- In `frontend/src/components/Layout.tsx:3159-3166`, updated the refills query to `api.getRefillsPanel({ upcoming_days: 7 })`.

### Task 4 Completion Details:
- In `frontend/src/utils/refillSettled.ts`, implemented `isRefillFulfilledToday` and integrated it into `isRefillSettled`.
- In `frontend/src/components/QuickAssistSidebar.tsx:822-843`, added `isRefillFulfilledToday(r)` check to `actionableRefills`.
- In `frontend/src/pages/CRM/RefillsSection.tsx`, imported `isRefillFulfilledToday` and guarded Overdue / Lead-window filtering and count metrics.
- In `frontend/src/pages/CRM/crmTypes.ts`, added `last_refill_date` and `next_refill_date` to `RefillPatient`.
- In `src/routes/refills.ts:GET /panel`, mapped `last_refill_date` and `next_refill_date` to patient and medicine responses.

### Task 5 Completion Details:
- Verified `src/routes/sales.ts:798-815`: 30-min window correctly checks `fulfilled_via IN ('pos_opened', 'quick_assist_complete')`, updates invoice details without double-advancing `next_refill_date`.
- Confirmed search truthfulness: `executeCloseRefillCycles` clears `cart_product_code`, `cart_store_name`, `cart_qty`, preventing stale cart facts from leaking into searches.

### Task 6 Completion Details:
- Documented `[Fixed] P1-88 — Refill Complete Persistence across App Restarts & Search Truthfulness` in `SMALL_BUG_FIX_PLAN.md`.

### Task 7 Completion Details:
- `npx tsc --noEmit` passed with 0 errors.
- `npm --prefix frontend run build` built successfully in 40.27s with 0 errors.
- `npm run guardrails` passed with 0 violations.
- `node scripts/quick-update.mjs` synchronized the 3D knowledge graph in 3.5s (1,193 nodes, 798 edges).
