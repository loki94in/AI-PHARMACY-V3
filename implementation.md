# Implementation Plan: Enforce Strict Selection & Edited Quantity in Refill Live Cart & Guard WhatsApp Messaging

## Problem Statement
When a user opens the Refill Order Modal (`RefillOrderModal`) in CRM or Quick Assist:
1. **Unselected / Filtered-Out Medicines Still Processed**:
   - In `RefillOrderModal.tsx`, `handleRunPostAndComplete` passed `activeMeds.map(m => m.id)` instead of `selectedList.map(m => m.id)`, fulfilling unselected items.
   - In `QuickAssistSidebar.tsx`, `handleConfirmRefillGroup` automatically grabbed all active medicines in the group without respecting individual selections.
   - In `QuickAssistSidebar.tsx`, `onConfirm` still called `startRefillCartJob(patientName, selectedItems)`, launching a second conflicting background runner after `RefillOrderModal` had already processed the items.
2. **False WhatsApp Notification Loop**:
   - In `src/routes/refills.ts` (`POST /patient/:phone/mark-ready`), the endpoint pulled all active refills for the patient's phone number unconditionally:
     `SELECT ... FROM patient_refills WHERE patient_phone = ? AND is_active = 1`
   - It ignored which medicines were actually selected by the user in the modal, and did not accept `refill_ids`.
   - It sent a WhatsApp collection message claiming all medicines (including unselected, out-of-stock, or unadded ones) were packed and waiting for collection.
3. **Quantity Verification**:
   - Needed to verify that user-edited quantities (`orderQty`) are strictly respected during cart addition instead of defaulting to `quantity_needed`, and unselected items are never searched or added.

---

## Changes Implemented

### 1. Frontend: Modal Selection Integrity ([`RefillOrderModal.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/RefillOrderModal.tsx))
- Updated `handleRunMarkReady` to pass `selectedList.map(m => m.id)` to `onMarkReady(selectedIds)` and `/mark-ready` API payload.
- Updated `handleRunPostAndComplete` to pass `selectedList.map(m => m.id)` to `onPostAndComplete(selectedIds)` and `api.fulfillAllRefills` (replacing `activeMeds`).
- Updated `RefillOrderModalProps` to define:
  - `onMarkReady?: (selectedIds?: number[]) => Promise<void> | void;`
  - `onPostAndComplete?: (selectedIds?: number[]) => Promise<void> | void;`

### 2. Frontend: Remove Duplicate Background Cart Trigger ([`QuickAssistSidebar.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickAssistSidebar.tsx))
- In `RefillOrderModal.onConfirm`: Removed `startRefillCartJob` call so it does not trigger duplicate background adds.
- In `handleMarkRefillGroupReady` and `handleCompleteRefillGroup`: Accepted `selectedIds?: number[]` and filtered target medicines to only those selected.

### 3. Frontend: Refills Section Selection Pass-Through ([`RefillsSection.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/RefillsSection.tsx))
- Updated `handleMarkReadyPatient` and `handleFulfillAllForPatient` to accept `selectedIds?: number[]` and pass them to downstream APIs.

### 4. Backend: Scoped `mark-ready` & WhatsApp Notification Gate ([`refills.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/refills.ts))
- In `POST /patient/:phone/mark-ready`:
  - Added support for `req.body.refill_ids` (array of numbers).
  - Restricts the query: `AND pr.id IN (...)` when `refill_ids` are supplied.
  - Only updates `is_ready = 1` and builds collection messages for the targeted/selected medicines.
  - Unselected medicines are completely excluded from the collection WhatsApp message.

---

## Tasks Completed & Status

- [x] **Task 1: Update `RefillOrderModal.tsx` to strictly restrict Mark Ready and Post & Complete to `selectedList`**
  - Updated `handleRunMarkReady` and `handleRunPostAndComplete` to pass only `selectedList.map(m => m.id)`.
- [x] **Task 2: Remove duplicate `startRefillCartJob` in `QuickAssistSidebar.tsx` and pass `selectedIds` in callbacks**
  - Removed duplicate background job invocation and wired `selectedIds` into `handleMarkRefillGroupReady` and `handleCompleteRefillGroup`.
- [x] **Task 3: Update `RefillsSection.tsx` callbacks to support `selectedIds`**
  - Updated `handleMarkReadyPatient` and `handleFulfillAllForPatient` to pass `refill_ids` to backend.
- [x] **Task 4: Update `POST /patient/:phone/mark-ready` in `src/routes/refills.ts` to scope to `refill_ids`**
  - Added `req.body.refill_ids` parameter and SQL filter `AND pr.id IN (...)` so only selected medicines are marked ready and included in the collection reminder.
- [x] **Task 5: Create and execute dry-run test script to verify uncheck behavior, edited quantities, and WhatsApp messaging**
  - Verified with automated test:
    1. Unchecked medicines are NEVER added or searched in cart.
    2. Edited quantities (e.g. qty 5) are preserved and passed to cart addition.
    3. Mark Ready & WhatsApp collection reminder contains ONLY selected medicines and edited quantities (omits unchecked items 100%).
- [x] **Task 6: Run guardrails and update knowledge graph**
  - `npm run guardrails` passed (exit code 0, clean `tsc --noEmit`, 0 violations).
  - `node scripts/quick-update.mjs` synchronized knowledge graph (1340 nodes, 877 edges).
