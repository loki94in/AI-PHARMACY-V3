# Implementation Plan: Delivery Staff Missing Badges, No Silent Fallback, and Reactive Dispatch Queue Resync

## 1. Overview & Objective
Store owners require complete transparency and human-in-the-loop control over distributor delivery assignments and WhatsApp dispatch messages:
1. **Live Cart Visibility**: Stop silent auto-selection of arbitrary delivery staff in the Live Cart. Display an explicit, prominent amber badge `[⚠️ Missing Delivery Staff — Click to Assign]` on each distributor cart section whenever no delivery staff has been assigned.
2. **Delivery Staff Assignment**: Allow the store owner to click the badge to assign a registered delivery boy or explicitly pick "Admin / Store Owner".
3. **Reactive Dispatch Queue Synchronization**: When a delivery staff member's phone number or name is edited in the app (in Dispatch, Staff directory, or Settings):
   - Automatically update all **pending/unsent** messages in `whatsapp_send_queue` with the new number and updated text.
   - Update today's `distributor_dispatch_reminders` records.
   - **Skip already sent messages** (`status = 'sent'` or `delivered`) to prevent duplicate transmissions.
   - Broadcast SSE events (`dispatch_updated`, `wa_queue_update`) so all kept-alive pages refresh live in real time.
4. **Same-Day Re-Order Staff Propagation**: Fix the `COALESCE(delivery_boy_id, ?)` locking bug in `distributorDispatchReminderWorker.ts` so later re-orders on the same day adopt the updated delivery staff member instead of getting stuck on morning assignments.

---

## 2. User-Selected Requirements & Design Decisions
- **Option A (Cart Badges)**: Prominent amber badge `[⚠️ Missing Delivery Staff — Click to Assign]` on each distributor card header. No silent auto-pick fallback. The user must explicitly pick a delivery boy or click "Use Admin / Store Owner".
- **Option A (Queue Resync)**: Updating a delivery boy's phone number immediately and atomically updates all pending/unsent messages in `whatsapp_send_queue` and today's `distributor_dispatch_reminders`.
- **Skip Sent Messages**: If a dispatch message was already sent (`status IN ('sent', 'delivered')`), do not resend or alter it. Only upcoming/pending messages (`status IN ('pending', 'scheduled', 'processing')`) receive the updated phone number and text.
- **Live SSE Feedback**: Real-time push notification via `eventService.broadcast` so the dispatch table, queue indicator, and cart reflect the update instantly without page reloads.

---

## 3. Subsystems & Detailed Changes

### A. Frontend: `frontend/src/pages/PharmarackCart/index.tsx`
1. **Remove Silent Auto-Assignment**:
   - In `resolveInitialDeliveryBoyId`, remove the automatic fallback to `activeBoys[0]`. If there is no mapped delivery boy, return `null`.
2. **Distributor Header Delivery Staff Badge**:
   - Alongside the distributor phone badge (`[Phone]`), render a prominent delivery staff badge:
     - If assigned with a valid phone:
       `[🚚 {boyName} (+91 XXXXX XXXXX)]` (styled with `bg-bg2 border-border`, clickable to reassign).
     - If unassigned or phone missing:
       `[⚠️ Missing Delivery Staff — Click to Assign]` (styled with `bg-amber-500/20 text-amber-400 border-amber-500/40 font-bold active:scale-95 cursor-pointer`).
3. **Staff Selection Modal Integration**:
   - Clicking the badge opens the assignment modal (or inline popover) listing all active delivery boys plus an explicit option `[👤 Admin / Store Owner]`.
   - On selection, saves to `pharmarack_distributor_mappings` and updates state immediately.
4. **Send All Guardrail**:
   - When clicking "Send All via WhatsApp", if any distributor has missing delivery staff, prompt the user to resolve them or confirm Admin fallback before proceeding.

### B. Backend: `src/routes/dispatch.ts`
1. **Queue Resync in `PUT /api/dispatch/delivery-boys/:id`**:
   - When a delivery boy's `whatsapp_number` or `name` is updated:
     - Query `whatsapp_send_queue` for all pending messages (`status IN ('pending', 'scheduled')`).
     - For queue items targeting this delivery boy (`type = 'delivery_boy_summary'` or recipient matching old phone):
       - Update `number` to the new clean 10-digit/91-digit phone number.
       - Replace occurrences of the old phone/name in `message`.
     - For queue items sent to distributors (`type = 'distributor_dispatch_reminder'` or `distributor_cart_order`):
       - Update the `{delivery_boy}` name and phone occurrences within `message`.
     - In `distributor_dispatch_reminders`:
       - Update `delivery_boy_id` and cached details for today's reminders.
     - **Skip already sent rows**: Rows where `status IN ('sent', 'delivered')` remain untouched.
2. **Broadcast SSE Events**:
   - Call `eventService.broadcast('dispatch_updated', { boyId: id, updated: true })`.
   - Call `eventService.broadcast('wa_queue_update', { boyId: id, updated: true })`.

### C. Backend: `src/services/distributorDispatchReminderWorker.ts`
1. **Fix `COALESCE` Locking on Same-Day Re-Orders**:
   - In the update query for existing today's reminders (around line 420):
     - Replace `delivery_boy_id = COALESCE(delivery_boy_id, ?)` with direct override if a non-null `boyContact.delivery_boy_id` or explicit mapping exists.
2. **Bridge `pharmarack_distributor_mappings` & `distributors`**:
   - In `resolveDeliveryBoyForDistributor`:
     - Query `pharmarack_distributor_mappings.delivery_boy_id` by `store_name` before falling back to store default, ensuring Live Cart choices carry over into automated dispatch reminders.

### D. Backend Helper: `src/utils/distributorSyncHelper.ts`
1. **Add `delivery_boy_id` to `resolveDistributorContact`**:
   - Include `delivery_boy_id` in the select queries for `pharmarack_distributor_mappings` and `distributors` table.

---

## 4. Verification Plan
1. **Type Safety & Guardrails**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs` verifying clean `tsc --noEmit`, speed architecture, semantic colors, no mock data).
2. **Knowledge Graph Update**:
   - Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
3. **Functional Verification**:
   - Open Live Cart: verify that distributors without assigned staff display the amber `[⚠️ Missing Delivery Staff — Click to Assign]` badge.
   - Click badge: assign a delivery boy or "Admin / Store Owner" and verify persistence.
   - Update a delivery boy's phone number in Dispatch Staff: verify that any pending queued dispatch messages are updated with the new number, already sent messages are skipped, and the UI updates live via SSE.
   - Place a re-order for the same distributor: verify that the updated delivery boy is preserved.

---

## 5. Tasks Checklist & Progress Report
- [x] Task 1: Frontend: Update `PharmarackCart/index.tsx` & `BatchDispatchModal.tsx` to remove silent delivery boy auto-pick and render `[⚠️ Missing Delivery Staff — Click to Assign]` amber badges on distributor card headers with explicit Admin/Owner selection.
  - *Completed*: Removed silent fallback `activeBoys[0]` in `resolveInitialDeliveryBoyId`; rendered prominent amber badge `[⚠️ Missing Delivery Staff — Click to Assign]` alongside Phone badge on distributor card header; updated Edit modal and Batch modal to support explicit Admin / Store Owner (`0`) option alongside registered delivery staff.
- [x] Task 2: Backend: Update `src/routes/dispatch.ts` (`PUT /delivery-boys/:id`) to reactively resync pending/unsent messages in `whatsapp_send_queue`, update today's `distributor_dispatch_reminders`, skip sent messages, and broadcast SSE.
  - *Completed*: Updated `PUT /delivery-boys/:id` to scan pending/scheduled items in `whatsapp_send_queue`, update target numbers and messages with new phone/name, touch today's `distributor_dispatch_reminders`, strictly skip sent/delivered messages, and broadcast `dispatch_updated` and `wa_queue_update` SSE push events.
- [x] Task 3: Backend: Update `src/services/distributorDispatchReminderWorker.ts`, `src/utils/distributorSyncHelper.ts`, and `src/routes/pharmarack.ts` to read `pharmarack_distributor_mappings.delivery_boy_id` and fix the same-day re-order `COALESCE` locking bug.
  - *Completed*: Added `pharmarack_distributor_mappings.delivery_boy_id` check in `resolveDeliveryBoyForDistributor` and `resolveDistributorContact`; fixed `COALESCE(delivery_boy_id, ?)` to `CASE WHEN ? IS NOT NULL THEN ? ELSE delivery_boy_id END` in reminder worker to eliminate same-day re-order assignment lock; added SSE broadcast in `POST /distributor-mappings`.
- [x] Task 4: Verification & Guardrails: Run `npm run guardrails` and `node scripts/quick-update.mjs`.
  - *Completed*: `npm run guardrails` passed with exit code 0 (`tsc --noEmit` clean, zero violations, B4 date safety verified with `localTime.ts`); `node scripts/quick-update.mjs` ran cleanly in 4.9s.
