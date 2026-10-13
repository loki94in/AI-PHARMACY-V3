# Implementation Plan: Announce Placed Order Immediately Upon Order ID Receipt

Created At: 2026-10-13T16:36:00+05:30
Status: COMPLETED

## 1. Problem & Root Cause Analysis
- **Problem**: When the app syncs and receives a new Pharmarack Order ID, the system currently formats the distributor message using the status reminder question:
  `📦 Pharmarack order #{Order ID} — has it been dispatched or collected by {Delivery Boy} ({Phone})? - {Pharmacy Name}`
  This confuses distributors because the order was just created and sent; asking if it is "already dispatched or collected" is premature.
- **Root Cause**:
  In [pharmarackOrderSyncService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/pharmarackOrderSyncService.ts#L382), when a new order is first detected for today (`!alreadyReminded`), it calls:
  `notificationService.sendDistributorDispatchReminder(row.id, undefined, gracePeriodMs, { orderNos: freshOnlyOrderNos });`
  In [notificationService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/notificationService.ts#L1000-L1006), because `followUp` is false, it falls into:
  `else if (orderNoText) { message = '📦 Pharmarack order ' + orderNoText + ' — has it been dispatched or collected by...'; }`
  Only late follow-ups used the `🆕 New Pharmarack order ... placed. Please dispatch ASAP...` wording.

## 2. Proposed Architectural Solution
1. **Differentiate Order ID Announcement vs. Scheduled Status Reminder**:
   - **Order ID Receipt (Immediate / Sync Trigger)**:
     When an Order ID is first detected or synced (via `pharmarackOrderSyncService`), the notification will explicitly use the placement announcement:
     `🆕 New Pharmarack order #{Order ID} placed. Please dispatch ASAP — to be collected by {Delivery Boy} ({Phone}) - {Pharmacy Name}`
   - **Daily Reminder (12:30 PM Window / Status Check)**:
     The status check template (`📦 Has today's order been dispatched or collected by {Delivery Boy} ({Phone})? - {Pharmacy Name}`) remains strictly reserved for the mid-day follow-up reminder routine when checking if the morning's order is ready for collection.
2. **Human-in-the-Loop Preservation**:
   - Preserves the 5-minute review grace period (`gracePeriodMs = Date.now() + 5 * 60 * 1000`) on the [Dispatch](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Dispatch/index.tsx) dashboard, allowing pharmacists to review, edit custom text, or cancel before automatic release.

## 3. Surgical Code Upgrades

### Backend
1. **`src/services/notificationService.ts`**:
   - Update `sendDistributorDispatchReminder` parameters options to support `isOrderAnnouncement?: boolean`.
   - When `opts?.isOrderAnnouncement || opts?.followUp` is true, format the default message as:
     `🆕 New Pharmarack order ${orderNoText} placed. Please dispatch ASAP — to be collected by ${boyName} (${boyPhone}) - ${storeName}`
   - When it is a scheduled status check (`!isOrderAnnouncement && !followUp`):
     Keep the status check inquiry:
     `📦 Pharmarack order ${orderNoText} — has it been dispatched or collected by ${boyName} (${boyPhone})? - ${storeName}` (or generic `📦 Has today's order been dispatched...` if no ID).
2. **`src/services/pharmarackOrderSyncService.ts`**:
   - At line 382, update the initial announcement call to:
     `sendDistributorDispatchReminder(row.id, undefined, gracePeriodMs, { isOrderAnnouncement: true, orderNos: freshOnlyOrderNos });`

## 4. Verification & Testing Plan
1. **TypeScript & Guardrails Check**:
   - Run `npm run guardrails` to guarantee 0 compiler errors and verify performance rules pass.
2. **Knowledge Graph Sync**:
   - Run `node scripts/quick-update.mjs` to keep architectural references aligned.
3. **Logic Verification**:
   - Verify that when `freshOnlyOrderNos` are synced in `pharmarackOrderSyncService`, the message enqueued into `whatsapp_send_queue` starts with `🆕 New Pharmarack order` and asks the distributor to dispatch ASAP.
   - Verify that the 12:30 PM automated job in `distributorDispatchReminderWorker.ts` continues to send the `📦 Has today's order been dispatched or collected...` status check.

---

## 5. Execution Tasks & Status
- [x] Task 1: Update `src/services/notificationService.ts` to support `isOrderAnnouncement` and route newly received Order IDs to the "🆕 New Pharmarack order... placed. Please dispatch ASAP..." message template.
  - *Completed*: Added `isOrderAnnouncement?: boolean` in `opts` of `sendDistributorDispatchReminder()`. Formats messages with `🆕 New Pharmarack order ${orderNoText} placed. Please dispatch ASAP — to be collected by ${boyName} (${boyPhone}) - ${storeName}` whenever orders are announced, leaving the question template strictly for status checks.
- [x] Task 2: Update `src/services/pharmarackOrderSyncService.ts` (line 382) to pass `isOrderAnnouncement: true`.
  - *Completed*: Updated `sendDistributorDispatchReminder()` call on line 382 to pass `{ isOrderAnnouncement: true, orderNos: freshOnlyOrderNos }`.
- [x] Task 3: Run `npm run guardrails` and `node scripts/quick-update.mjs` to verify zero regressions.
  - *Completed*: `npm run guardrails` passed with code 0 (`tsc --noEmit` clean, zero violations). `node scripts/quick-update.mjs` updated the knowledge graph cleanly.
