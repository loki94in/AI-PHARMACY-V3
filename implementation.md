# Implementation Plan: Manual Complete Button in Quick Assist for Special Orders

## 1. Overview
When a customer places a special order or medicine request, the pharmacy tracks it in Quick Assist and the CRM. When the medicine arrives and is marked `Ready`, the automated system sends collection reminders via WhatsApp.
However, when the medicine is sold or dispensed:
- If the automated bill detector fails to match the medicine in the bill (due to spelling variations, cash walk-in sale without phone number, or prior offline sale), the special order remains stuck in Quick Assist.
- Currently, the only buttons in Quick Assist are `[Resend]` and `[POS]` (or `[Make Order]`/`[Mark Ready]`).
- Clicking `[POS]` forcibly redirects the user to the POS billing page with prefill, which is unwanted if the medicine is already sold or dispensed.
- The order remains active, causing `collectionReminderWorker` to send repeated reminder messages to the customer (spamming them).

This task adds a manual **"Complete"** button directly in the Quick Assist sidebar for Special Requests (and Online Orders) both at the group level and per-item level, allowing the user to mark tasks as completed permanently with 1 click, instantly disarming all collection reminders and permanently hiding the task.

---

## 2. Proposed Changes

### Backend Hardening: `src/routes/orders.ts`
- In `handleBatchStatusUpdate` (`POST /orders/batch-status`):
  - When `status === 'Fulfilled'`, ensure `auto_remind = 0, last_collection_reminder_at = NULL` in the SQL update.
- In `POST /orders/:id/fulfill`:
  - Ensure `auto_remind = 0, last_collection_reminder_at = NULL` in the SQL update.
- In `POST /orders/:id/status`:
  - When `status === 'Fulfilled'`, set `last_collection_reminder_at = NULL` and `auto_remind = 0`.
- In `PUT /orders/:id`:
  - When `newStatus === 'Fulfilled'`, set `last_collection_reminder_at = NULL` and `auto_remind = 0`.

### Frontend: `frontend/src/components/QuickAssistSidebar.tsx`
- **Helper Function**:
  - Add `handleCompleteOrderItem(item, group)` to support marking an individual medicine completed within a multi-item special order group.
- **Group Action Bar (Tier 1 Buttons)**:
  - Add a dedicated `[Complete]` button with `<CheckCircle2 size={11} />` alongside `[POS]` for all statuses (`Ready`, `Ordered`, `Pending`).
  - Styled with semantic classes `bg-emerald-600/15 hover:bg-emerald-600 hover:text-white text-emerald-400 border border-emerald-500/30`.
  - When clicked: Calls `handleUpdateGroupStatus(group, 'Completed')` without navigating to POS.
  - Optimistically removes the group from Quick Assist instantly with zero delay/flicker.
- **Itemized Medicine List (Unfolded View)**:
  - When the special order card is expanded, provide a compact `[Complete]` button next to each medicine row.
  - Allows completing one medicine while leaving other pending medicines in the group active if they haven't arrived/sold yet.
- **Online / Website Orders**:
  - Mirror the same `[Complete]` action button in `groupedWebsiteOrders` for parity.

---

## 3. Step-by-Step Execution Plan

### Step 1: Backend Hardening in `src/routes/orders.ts`
- Ensure `last_collection_reminder_at = NULL` and `auto_remind = 0` across all fulfillment / completion paths in `src/routes/orders.ts`.

### Step 2: Implement Complete Action & Buttons in `frontend/src/components/QuickAssistSidebar.tsx`
- Add `handleCompleteOrderItem` for item-level completion.
- Add group-level `[Complete]` button to Tier 1 action row for Special Requests (`Ready`, `Ordered`, `Pending`).
- Add item-level `[Complete]` button to unfolded medicine list for Special Requests.
- Add group-level `[Complete]` button to Tier 1 action row for Online Orders.

### Step 3: Verification & Guardrails
- Run `npm run guardrails` (`tsc --noEmit` and speed guardrails).
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Implementation Checklist

- [x] Task 1: Backend: Guarantee `auto_remind = 0` and `last_collection_reminder_at = NULL` on all special order fulfill/complete routes in `src/routes/orders.ts`.
- [x] Task 2: Frontend: Add `handleCompleteOrderItem` and group-level `[Complete]` button in Special Requests section in `QuickAssistSidebar.tsx`.
- [x] Task 3: Frontend: Add item-level `[Complete]` button in unfolded medicine rows in `QuickAssistSidebar.tsx`.
- [x] Task 4: Frontend: Add group-level `[Complete]` button in Online Orders section in `QuickAssistSidebar.tsx`.
- [x] Task 5: Frontend: Add manual `[Complete]` button, metrics calculation, and filter handling to the dedicated Online Orders page in `WebsiteOrders/index.tsx`.
- [x] Task 6: Verification: Run `npm run guardrails` and `node scripts/quick-update.mjs`.

---

## 5. Completed Tasks & Progress Report
- **Task 1 Completed**: Hardened backend routes in [`src/routes/orders.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/orders.ts):
  - In `handleBatchStatusUpdate`: `UPDATE special_orders SET status = ?, notified = 1, auto_remind = 0, last_collection_reminder_at = NULL WHERE id IN (...)` when `status === 'Fulfilled'`.
  - In `POST /:id/fulfill`: Guaranteed `auto_remind = 0` and `last_collection_reminder_at = NULL`.
  - In `POST /:id/status` and `PUT /:id`: When `newStatus === 'Fulfilled'`, guaranteed `last_collection_reminder_at = NULL` and `auto_remind = 0`.
  - This ensures neither `collectionReminderWorker` nor any cron jobs can ever pick up a completed order for customer reminder messages.
- **Task 2 Completed**: In [`frontend/src/components/QuickAssistSidebar.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickAssistSidebar.tsx):
  - Added `handleCompleteOrderItem` to support completing specific individual items within a special order group.
  - Added a dedicated `[Complete]` button (styled with emerald accents: `bg-emerald-600/15 hover:bg-emerald-600 hover:text-white text-emerald-400 border border-emerald-500/30` and `<CheckCircle2 size={11} />`) to the Tier 1 action row for Special Requests across `Ready`, `Ordered`, and `Pending` states.
  - Clicking `[Complete]` immediately and optimistically hides the item/group from Quick Assist, marks the status as `Completed` via `api.updateOrdersBatchStatus`, cancels any pending WhatsApp reminders, stops future follow-ups, and does not navigate away to POS.
- **Task 3 Completed**: In the unfolded/expanded medicine list for Special Requests in [`QuickAssistSidebar.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickAssistSidebar.tsx):
  - Added an item-level `[Complete]` button next to each medicine row (`💊 Medicine Name xQty [Complete]`), allowing the user to mark individual medicines completed independently if only part of a multi-medicine order was dispensed.
- **Task 4 Completed**: Mirrored both the group-level `[Complete]` button and item-level `[Complete]` button in the Online Orders section of [`QuickAssistSidebar.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickAssistSidebar.tsx) for full feature parity.
- **Task 5 Completed**: In the dedicated Online Orders page ([`WebsiteOrders/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/WebsiteOrders/index.tsx)):
  - Added `handleMarkComplete(orderId)` which optimistically updates state, sets `status = 'Fulfilled', delivery_status = 'delivered'`, and triggers batch completion.
  - Added the `[Complete]` button with `<CheckCircle2 size={12} />` to each online order card's action row alongside `Modify Items` and `Fulfill in POS`.
  - Updated KPI metrics and status filter tabs so completed online orders cleanly reflect under the `Delivered` tab and are excluded from `Pending`/`Ready` counts.
- **Task 6 Completed**: Ran `npm run guardrails` (`tsc --noEmit` and speed guardrails passed with 0 errors). Ran `node scripts/quick-update.mjs` to synchronize the knowledge graph (1179 nodes, 798 edges).
