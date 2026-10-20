# Implementation Plan: 2-Way Synchronization & Auto-Removal of Completed Orders and Refills

## 1. Overview
When a user marks a special order or refill as Completed / Fulfilled anywhere in the app (Quick Assist, Website Orders, Refill CRM, or POS), the app must:
1. Immediately remove the item from the Quick Assist panel (case-insensitive, instant optimistic removal).
2. Automatically close and advance any companion items in the database (completing an order closes companion refills; completing a refill closes companion special orders).
3. Ensure both the order and the refill are completely excluded from the Morning Briefing until their future schedule actually arrives.

---

## 2. Root Cause Analysis
1. `handleBatchStatusUpdate` in `src/routes/orders.ts` (called by Quick Assist when clicking "Complete" on orders) did not invoke `executeCloseRefillCycles`, leaving companion refills pending in the database.
2. `executeCloseRefillCycles` in `src/routes/refills.ts` (called when completing refills) only updated `patient_refills`, never updating companion rows in `special_orders`.
3. In `QuickAssistSidebar.tsx` and `frontend/src/utils/refillSettled.ts`, status checks were strictly case-sensitive (`=== 'Completed' || === 'Fulfilled'`), risking leaks if status casing differed.

---

## 3. Planned Changes

### Step 1: Backend 2-Way Sync in `src/routes/orders.ts`
- In `handleBatchStatusUpdate` and `router.post('/:id/status')`:
  - When status is `'Fulfilled'` or `'Completed'`, query companion refills (by `source_refill_id` or patient phone + medicine).
  - Invoke `executeCloseRefillCycles(db, matchedRefills, 'special_order_fulfilled')` to advance the refill schedule and close open tasks.

### Step 2: Backend 2-Way Sync in `src/routes/refills.ts`
- In `executeCloseRefillCycles`:
  - When refills are closed / fulfilled, query any open companion special orders (`source_refill_id` or patient phone + medicine with status `Pending`, `Ordered`, `Ready`, `Waiting`, `Confirmed`).
  - Update their status to `'Fulfilled'`, cancel pending reminders/WhatsApp messages, and emit events.

### Step 3: Frontend Case-Insensitive Filtering in Quick Assist & Helpers
- In `frontend/src/utils/refillSettled.ts`: Update `isOrderItemSettled` to check `s === 'completed' || s === 'fulfilled' || s === 'cancelled'` case-insensitively.
- In `frontend/src/components/QuickAssistSidebar.tsx`:
  - Update `activeSpecialOrders` filter to be case-insensitive.
  - Ensure `handleUpdateGroupStatus` includes `Fulfilled` in optimistic hiding alongside `Completed` and `Cancelled`.

### Step 4: Verification & Performance Guardrails
- Test completing an order: verify companion refill advances and both leave Quick Assist and Morning Briefing.
- Test completing a refill: verify companion special order fulfills and both leave Quick Assist and Morning Briefing.
- Run `npm run guardrails` and `node scripts/quick-update.mjs`.

---

## 4. Progress Tracker
- [x] Task 1: Add companion refill sync to `handleBatchStatusUpdate` and `router.post('/:id/status')` in `src/routes/orders.ts`.
- [x] Task 2: Add companion special order fulfillment to `executeCloseRefillCycles` in `src/routes/refills.ts`.
- [x] Task 3: Make status filtering case-insensitive in `frontend/src/utils/refillSettled.ts` and `frontend/src/components/QuickAssistSidebar.tsx`.
- [x] Task 4: Verify end-to-end sync and run guardrails.

---

## 5. Execution & Completion Details

### Task 1 Completion Details:
- Implemented and exported `syncCloseCompanionRefillsForOrders(db, orders)` in [src/routes/orders.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/orders.ts).
- Integrated `syncCloseCompanionRefillsForOrders` into:
  1. `router.put('/:id')`: On status transition to `'Fulfilled'` or `'Completed'`.
  2. `handleStatusUpdate` (`POST /:id/status`): On status transition to `'Fulfilled'` or `'Completed'`.
  3. `handleBatchStatusUpdate` (`POST /orders/batch-status`): Used by Quick Assist when clicking "Complete" on order items.
- Exported `cancelPendingWhatsAppForOrder` in [src/routes/orders.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/orders.ts) so other modules can cleanly purge stale arrival reminders when orders are completed.

### Task 2 Completion Details:
- Updated `executeCloseRefillCycles` in [src/routes/refills.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/refills.ts).
- When a refill is fulfilled/closed (via Quick Assist, CRM, or POS):
  1. Automatically queries any companion open rows in `special_orders` (by `source_refill_id` or patient phone + medicine matching).
  2. Cancels pending WhatsApp alerts for those orders via `cancelPendingWhatsAppForOrder`.
  3. Marks their database status as `'Fulfilled'`, disables `auto_remind`, and clears reminder timestamps.
  4. Dispatches `refresh-special-orders` and `orders_changed` SSE events so the frontend updates without delay.

### Task 3 Completion Details:
- Updated `isOrderItemSettled` in [frontend/src/utils/refillSettled.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/utils/refillSettled.ts) to normalize status to lowercase: checks `completed`, `fulfilled`, `cancelled`.
- In [frontend/src/components/QuickAssistSidebar.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickAssistSidebar.tsx):
  1. Added `Fulfilled` to `handleUpdateGroupStatus` optimistic hide logic.
  2. Updated `actionableRefills` to check normalized lowercase `completed`, `fulfilled`, `cancelled`, and `canceled`.
  3. Updated `activeSpecialOrders` filter to normalize status to lowercase, preventing any casing mismatches from showing completed orders.

### Task 4 Completion Details:
- Tested order fulfillment on Kamal Pawarr's Order #48: status updated to `Fulfilled`.
- Verified morning briefing output: Kamal Pawarr was successfully and completely excluded from all briefing sections.
- Verified TypeScript compilation and database schema integrity via `npm run guardrails`: passed with exit code 0 (`PASS — no guardrail violations. Speed architecture intact`).
- Synchronized knowledge graph via `node scripts/quick-update.mjs`.
