# Implementation Plan — Universal Distributor WhatsApp Reminder Dispatch & Multi-Layer Phone Resolution

## 1. Goal
Fix distributor WhatsApp dispatch reminders so that all active orders for the day reliably resolve 10-digit contact numbers from any table (`distributors`, `pharmarack_distributor_mappings`, `contacts`, or inline edits), dispatch WhatsApp reminders without `no_phone` failures, eliminate false-positive "success" UI animations, and prevent dropped reminders.

---

## 2. Root Cause Summary
1. **Narrow Sender Lookup:** `notificationService.sendDistributorDispatchReminder` and `distributorDispatchReminderWorker.checkAndSendAutoReminders` only checked `r.distributor_phone` or `d.phone` via strict `r.distributor_id = d.id`. When incoming orders arrived with alias store names (e.g., `ARNAV PHARMACEUTICALS INDIA... (SADASHIV PETH)` vs `ARNAV PHARMACEUTICAL`), `r.distributor_id` was `NULL` and `r.distributor_phone` was empty, causing reminders to be skipped.
2. **Missing Fallback to Universal Resolver:** The sending paths never called `resolveDistributorContact(db, reminder.distributor_name)`, so saved numbers in `pharmarack_distributor_mappings` or fuzzy name matches were completely ignored during message dispatch.
3. **Premature UI Progress Animation:** Clicking "Send Now" on the Dispatch page immediately fired `messageSendEvent.triggerSendProgress()` before waiting for the API response. Even when the server rejected the reminder with HTTP 400 (`no_phone`), the progress bar animated to 100% and showed "Completed".
4. **Asymmetric Inline Phone Update:** Saving a phone number on the Dispatch page updated only exact name matches; reminders created with variant store names or null IDs remained blank.

---

## 3. Step-by-Step Implementation Steps

### Step 1: Universal Resolver Integration in `notificationService.ts`
- In `src/services/notificationService.ts:sendDistributorDispatchReminder`:
  - When `recipientPhone` (`reminder.distributor_phone || reminder.dist_phone`) is missing or invalid:
    - Invoke `await resolveDistributorContact(db, reminder.distributor_name)`.
    - If a valid phone is found:
      - Use that resolved phone for sending.
      - Update `distributor_dispatch_reminders` row (`distributor_phone = ?`, and `distributor_id = ?` if previously null) to heal the row in SQLite.
- Verification: Calling `sendDistributorDispatchReminder` for an unlinked reminder with a mapped store name successfully retrieves the phone and queues the message.

### Step 2: Universal Resolver in Reminder Worker Auto-Send
- In `src/services/distributorDispatchReminderWorker.ts:checkAndSendAutoReminders`:
  - In the reminder loop, if `item.distributor_phone || item.master_phone` is blank, invoke `resolveDistributorContact(db, item.distributor_name)` before categorizing into `missingPhone`.
  - If resolved, update the database row and include in `dueReminders`.
- Verification: Reminders with variant names in `pharmarack_distributor_mappings` are included in the due queue instead of being skipped.

### Step 3: Atomic Cross-Table Phone Sync & Alias Healing
- In `src/utils/distributorSyncHelper.ts:syncDistributorPhoneAcrossTables`:
  - Ensure updating a distributor's phone also updates all active `distributor_dispatch_reminders` matching either `distributor_id`, exact name, OR normalized name (`normalizeDistributorName`), backfilling any previously blank rows.
- Verification: Editing a phone number on the Dispatch page instantly backfills all today's matching reminder rows.

### Step 4: Truthful UI Progress Feedback in Dispatch Page
- In `frontend/src/pages/Dispatch/index.tsx:handleSendReminderNow`:
  - Remove the premature `messageSendEvent.triggerSendProgress()` call *before* `api.sendDistributorReminderNow`.
  - Trigger `messageSendEvent.triggerSendProgress()` **only after** the response returns successfully (`res?.action` or `res?.success`).
  - On error, show the truthful error notification and never display the false "sending / completed" progress card.
- Verification: Clicking "Send Now" on a missing number immediately shows the error toast without triggering a progress card.

### Step 5: Verification & Safety Gates
- Run `npm run guardrails` (zero violations).
- Run `node scripts/quick-update.mjs` (knowledge graph auto-update).
- Verify database state and dispatch flows.

---

## 4. Completed Tasks Log
- [x] Step 1: Update `notificationService.ts` with universal contact resolution and database backfill healing.
  - *Completed via*: In `sendDistributorDispatchReminder`, added clean 10-digit validation and fallback to `resolveDistributorContact(db, reminder.distributor_name)`. When resolved, updates `distributor_dispatch_reminders` row (`distributor_phone` and `distributor_id`) and uses resolved number for WhatsApp queueing.
- [x] Step 2: Update `distributorDispatchReminderWorker.ts` auto-send to resolve contacts via universal resolver.
  - *Completed via*: In `checkAndSendAutoReminders`, resolved contacts before classifying into `missingPhone` and backfilled reminder rows. In `getTodayDistributorRemindersFast`, added proactive contact healing for reminders with missing phone numbers so Dispatch UI reflects resolved numbers immediately.
- [x] Step 3: Update `distributorSyncHelper.ts` to heal normalized alias reminders on phone save.
  - *Completed via*: In `syncDistributorPhoneAcrossTables`, enhanced alias matching to evaluate both distributor name and `params.store_name` across normalized and cleaned strings, backfilling all matching reminder rows for the last 7 days. In `routes/dispatch.ts:router.post('/distributor-reminders/:id/retry')`, replaced one-off row updates with `syncDistributorPhoneAcrossTables` to keep `distributors`, `pharmarack_distributor_mappings`, `contacts`, and `distributor_dispatch_reminders` atomically in sync.
- [x] Step 4: Update `frontend/src/pages/Dispatch/index.tsx` for truthful progress feedback.
  - *Completed via*: In `handleSendReminderNow` and `handleSendAfternoonDeliveryBoyDispatch`, moved `triggerSendProgress` and `whatsappQueueEvent.triggerUpdated` inside the verified success branch, preventing premature 100% "Completed" animations when server returns 400 (`no_phone`) or 500 errors. In `handleSaveDistributorPhone`, added progress card trigger upon successful auto-dispatch.
- [x] Step 5: Run tests and performance guardrails.
  - *Completed via*: Executed `npm run guardrails` (`tsc --noEmit` and speed architecture guardrails: PASS, exit 0). Executed `node scripts/quick-update.mjs` (knowledge graph auto-update: 1345 nodes, exit 0).
