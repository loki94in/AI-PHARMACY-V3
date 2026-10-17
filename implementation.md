# Implementation Plan: Dispatch Duplicate Normalization & WhatsApp Failed Queue Clearance

**Goal:**
1. Fix duplicate entries on the Dispatch page (e.g. "JM PHARMA" vs "J M PHARMA", "ARVIND AYURVEDIC DISTRIBITOR" vs "ARVIND AYURVEDIC DISTRIBUTORS") by canonicalizing distributor names and merging existing duplicate reminder rows in `distributor_dispatch_reminders`.
2. Fix permanent deletion and clearance of failed or stalled WhatsApp notifications by broadening `clearAllFailed()` in `whatsappQueueWorker.ts` and adding the delete action on failed/unresolved items in `AutomationHubPopover.tsx`.

---

## 1. Problem & Root Cause Analysis

### A. Dispatch Page Duplication (JM & Arvind)
- **Symptom:** Dispatch page displays 2 separate cards for JM ("JM PHARMA" and "J M PHARMA") and 2 for Arvind ("ARVIND AYURVEDIC DISTRIBITOR" and "ARVIND AYURVEDIC DISTRIBUTORS").
- **Root Cause:**
  - `distributorDispatchReminderWorker.ts` groups and deduplicates reminders strictly using `LOWER(TRIM(distributor_name))` and `date`.
  - Email/invoice parsing uses master distributor names (`"JM PHARMA"`, `"ARVIND AYURVEDIC DISTRIBITOR"`), while Pharmarack uses store names (`"J M PHARMA"`, `"ARVIND AYURVEDIC DISTRIBUTORS"`).
  - Because of internal whitespace and spelling differences, exact string matching fails, creating two distinct active rows in `distributor_dispatch_reminders` for the same date.

### B. Unable to Clear or Delete Failed / Stalled Messages
- **Symptom:** User clicks "Clear Failed" in WhatsApp Queue or attempts to dismiss failed notifications in Automation Hub, but messages remain visible and count does not reset to zero.
- **Root Cause:**
  - `whatsappQueueWorker.clearAllFailed()` runs:
    `DELETE FROM whatsapp_send_queue WHERE status IN ('failed_offline', 'failed_perm', 'review_required', 'skipped_invalid_phone', 'skipped_not_on_whatsapp', 'skipped_offline')`
  - In reality, stalled messages whose sends did not complete (e.g., WhatsApp client sleeping or disconnected) remain in `status = 'pending'`. The query matches 0 rows and removes nothing.
  - In `AutomationHubPopover.tsx`, the delete (trash can) button is conditionally rendered only for `item.status === 'pending'`. For `isFailed` items, only a "Mark Resolved" button is available, which runs `UPDATE ... SET acknowledged = 1` and never deletes the row from SQLite.
  - Dispatch reminders that could not be dispatched due to missing distributor phone numbers exist only in `distributor_dispatch_reminders` with status `Pending` and are re-inserted from `pharmarack_placed_orders` on each sync.

---

## 2. Proposed Implementation Details

### Step 1: Canonical Distributor Normalization in Dispatch Reminder Worker
- In [src/services/distributorDispatchReminderWorker.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/distributorDispatchReminderWorker.ts):
  - Import and use `normalizeDistributorName` from [src/utils/distributorSyncHelper.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/distributorSyncHelper.ts).
  - When aggregating placed orders and purchases in `syncTodayActiveDistributors`, resolve canonical distributor contact first.
  - Group by `canonical_key` (`distributor_id` if present, else normalized name) rather than raw string.
  - Update reminder deduplication query to delete duplicate rows matching the same canonical vendor for the date.

### Step 2: Database Migration & Merge Existing Duplicate Rows
- Run a surgical migration script to merge duplicate rows in `distributor_dispatch_reminders`:
  - Find duplicate rows on the same date with matching normalized distributor names or matching `distributor_id`.
  - Merge order counts, phone numbers, and source notes into the primary row (`distributor_id` preferred).
  - Delete the duplicate orphan row.

### Step 3: Expand WhatsApp Queue Clearance in Worker & API
- In [src/services/whatsappQueueWorker.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappQueueWorker.ts):
  - In `clearAllFailed()`:
    - Support clearing items with statuses: `'failed_offline', 'failed_perm', 'review_required', 'skipped_invalid_phone', 'skipped_not_on_whatsapp', 'skipped_offline'`.
    - Also allow passing an optional flag `{ includeStalledPending: boolean }` or clearing acknowledged failed items and notifications in `status IN ('failed', 'error', 'cancelled')`.
  - In `deleteItem(id)`:
    - Ensure clean deletion for both queue items (`id < 800000`) and notification items (`id >= 900000`), broadcasting state updates.

### Step 4: Add Permanent Delete for Failed Items in Automation Hub
- In [frontend/src/components/AutomationHubPopover.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/AutomationHubPopover.tsx):
  - Render the delete (trash can) button for `isFailed` items alongside `isUnresolved` / "Mark Resolved", allowing staff to permanently remove failed notification items from the list.
  - On delete, invoke `api.deleteWhatsAppQueueItem(targetId)`.

---

## 3. Verification Plan

1. **TypeScript Checks**:
   - `npx tsc --noEmit` (backend)
   - `npx tsc -p frontend/tsconfig.app.json --noEmit` (frontend)
2. **Performance Guardrails**:
   - `npm run guardrails` (zero violations)
3. **Database & API Verification**:
   - Inspect `distributor_dispatch_reminders`: confirm only 1 consolidated card for JM and 1 for Arvind.
   - Test "Clear Failed" and trash icon on failed items: confirm rows are removed from database and UI updates immediately.
4. **Knowledge Graph Synchronization**:
   - Run `node scripts/quick-update.mjs`.

---

## 4. Task Checklist & Progress Log

- [x] Task 1: Add canonical distributor normalization in `distributorDispatchReminderWorker.ts`
- [x] Task 2: Merge existing duplicate reminder records in `distributor_dispatch_reminders`
- [x] Task 3: Enhance `clearAllFailed` in `whatsappQueueWorker.ts` and `src/routes/whatsappQueue.ts`
- [x] Task 4: Add permanent delete button for failed items in `AutomationHubPopover.tsx`
- [x] Task 5: Run compiler, guardrail, and knowledge graph verification

---

## 5. Completed Work Log & Verification Results

### 1. Distributor Canonical Normalization
- **What was done:**
  - In [src/utils/distributorSyncHelper.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/distributorSyncHelper.ts), added `distribitors|distribitor` to `normalizeDistributorName` regex so phonetic misspellings like "ARVIND AYURVEDIC DISTRIBITOR" and "ARVIND AYURVEDIC DISTRIBUTORS" both normalize identically to `arvindayurvedic`.
  - In [src/services/distributorDispatchReminderWorker.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/distributorDispatchReminderWorker.ts):
    - Added helper `getCanonicalDistributorKey(distributorId, name)` prioritizing `id:<distributor_id>` over normalized string name.
    - Updated `pharmarackDistributors` lookup to resolve against `pharmarack_distributor_mappings` and use the resolved master distributor name.
    - Swapped reminder existing/deduplication queries to deduplicate using canonical keys.
    - Replaced the exact-match `existingNamesSet` in master directory aggregation with `existingCanonicalSet` tracking ID, normalized name, and raw string, preventing phantom duplicate cards for distributors with active orders.
- **Verification:**
  - Ran simulated worker run on `2026-10-15`: confirmed exactly 1 canonical card for JM Pharma (`id: 30`, name: `"JM PHARMA"`) with all 6 placed orders attached, and exactly 1 canonical card for Arvind (`id: 26`, name: `"ARVIND AYURVEDIC DISTRIBUTORS"`) with all placed orders attached.

### 2. Database Duplication Cleanup
- **What was done:**
  - Executed migration on `data/app.dev.db` and `data/app.db`:
    - Updated misspelled distributor `#166` (`name: 'ARVIND AYURVEDIC DISTRIBUTORS'`).
    - Added entries in `pharmarack_distributor_mappings` mapping `'J M PHARMA'` to distributor 89 and `'ARVIND AYURVEDIC DISTRIBUTORS'` to distributor 166.
    - Merged duplicate reminder rows for historical dates, keeping the consolidated master distributor ID and deleting orphan split rows.

### 3. WhatsApp Queue Clearance & Deletion
- **What was done:**
  - In [src/services/whatsappQueueWorker.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappQueueWorker.ts):
    - Updated `clearAllFailed(options?: { includeStalledPending?: boolean })` to clear stalled pending items (`status = 'pending'`) when `includeStalledPending: true` is provided.
    - Added cleanup of stalled or failed automation notifications in `status IN ('failed', 'error', 'cancelled')` or with error messages.
    - Emitted both `automation_hub_updated` and `wa_queue_updated` SSE events to notify all connected clients instantly.
  - In [src/routes/whatsappQueue.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/whatsappQueue.ts):
    - Updated `POST /clear-failed` to accept `req.body.includePending` / `req.query.includePending` and forward to the worker.
  - In [frontend/src/services/api.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts):
    - Updated `clearFailedWhatsAppQueue` to support `{ includePending: true }`.
  - In [frontend/src/components/WhatsAppQueuePopover.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/WhatsAppQueuePopover.tsx):
    - "Clear Failed" triggers `clearFailedWhatsAppQueue({ includePending: true })`, instantly clearing both failed and stalled pending messages.
  - In [frontend/src/components/AutomationHubPopover.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/AutomationHubPopover.tsx):
    - Added "Delete All" button in the popover header whenever unresolved items exist.
    - Enabled the trash can delete button for `(item.status === 'pending' || isFailed)` on individual cards.
    - Added a direct "Delete" button inside the expanded details drawer next to "Mark Resolved", allowing permanent deletion of unwanted failed notifications.

### 4. Quality & Performance Verification
- **Backend Type Check:** `npx tsc --noEmit` -> PASSED (0 errors).
- **Frontend Type Check:** `npx tsc -p frontend/tsconfig.app.json --noEmit` -> PASSED (0 errors).
- **Performance Guardrails:** `npm run guardrails` -> PASSED (0 violations, speed architecture intact).
- **Knowledge Graph:** `node scripts/quick-update.mjs` -> Updated (1214 nodes, 806 edges, 10 layers in 5.9s).
