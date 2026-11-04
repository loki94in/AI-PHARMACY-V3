# Implementation Plan: Instant Distributor WhatsApp ASAP Release (Eliminate Pending Wait)

**Plan Name:** `instant_distributor_asap_release_fix`  
**Target:**
1. **Zero Waiting in Pending:** Eliminate distributor WhatsApp messages sitting in "Pending" waiting for the 12:30–13:00 lunch window or for the pharmacist to manually click "Send Next Now".
2. **Immediate Auto-Release:** When the app detects a new PO order in history:
   - **Step 1:** Enqueue/Send Delivery Boy pickup WhatsApp message immediately (`scheduled_at = Date.now()`).
   - **Step 2:** Automatically release/enqueue the Distributor confirmation WhatsApp message with `scheduled_at = Date.now() + 15000` (15s safe anti-spam gap) so it fires automatically right after the delivery boy.
3. **Unblock Pre-enqueued Items:** If a distributor reminder was already pre-enqueued into `whatsapp_send_queue` with a future scheduled time, force its `scheduled_at` to `Date.now() + 15000` so it sends immediately following the delivery boy.

---

## Technical Strategy & Changes

1. **Order Sync Service (`src/services/pharmarackOrderSyncService.ts`):**
   - In `runSync()`, lines 401-417: When `waiting` queue item is found for a distributor, merge the order number AND immediately update `scheduled_at = Date.now() + 15000`.
   - Update `pharmarack_synced_orders` (`announced_at = CURRENT_TIMESTAMP`, `announce_result = 'merged_and_released_asap'`).
   - Settle order numbers as `merged_into_waiting_reminder`.
   - Call `whatsappQueueWorker.forceNext()` so the worker executes it without delay.
   - Pass row to `directOrderRemindersToNotifyBoy` so the delivery boy is notified first.

2. **Notification Service (`src/services/notificationService.ts`):**
   - In `sendDistributorDispatchReminder()`: When `(isOrderAnnouncement || followUp)` is passed and an existing queue item is pending with a future `scheduled_at`, immediately auto-release it by updating `scheduled_at = scheduledAt || (Date.now() + 15000)`, merging fresh order numbers, and calling `whatsappQueueWorker.forceNext()`.

3. **Distributor Reminder Worker (`src/services/distributorDispatchReminderWorker.ts`):**
   - In `allocateDynamicReminderTimes`:
     - Filter out distributors who already have orders placed today so they are not assigned lunch window slots (their orders are dispatched ASAP).
     - Removed the premature advance enqueue into `whatsapp_send_queue`. Reminders are dispatched on-the-fly when due by `checkAndSendAutoReminders`, completely eliminating fake pending items sitting in `whatsapp_send_queue` hours in advance.

4. **Database Queue Unblocking (`data/app.db`):**
   - Cleaned up stalled distributor reminders with future timestamps by updating `scheduled_at = Date.now() + 15000` and cancelling duplicate records.

---

## Tasks & Progress Tracking

- [x] Task 1: Update `pharmarackOrderSyncService.ts` to release waiting queue items to `Date.now() + 15000` instead of leaving them in the future.
  - *Completed:* When `waiting` row exists, updated `scheduled_at` to `Date.now() + 15000`, updated `pharmarack_synced_orders.announced_at`, called `whatsappQueueWorker.forceNext()`, and enqueued delivery boy first.
- [x] Task 2: Update `notificationService.ts` so order announcements auto-release existing future-scheduled queue items immediately.
  - *Completed:* Added check in `sendDistributorDispatchReminder` for `(isOrderAnnouncement || followUp)` to update `scheduled_at = Date.now() + 15000`, merge order numbers, and call `forceNext()`.
- [x] Task 3: Adjust `distributorDispatchReminderWorker.ts` to prevent locking today's active orders into future clock slots.
  - *Completed:* Omitted advance pre-enqueue into `whatsapp_send_queue` and filtered out stores with orders today from lunch window allocation.
- [x] Task 4: Verify TypeScript compilation and run performance guardrails (`npm run guardrails`).
  - *Completed:* Verified with `npm run guardrails` (`tsc --noEmit` and speed architecture checks passed 100%).
- [x] Task 5: Update Knowledge Graph (`node scripts/quick-update.mjs`).
  - *Completed:* Quick knowledge graph updated with 1449 nodes and 881 edges.
- [x] Task 6: Database queue cleanup.
  - *Completed:* Stalled pending distributor reminders in `whatsapp_send_queue` reset to immediate safe offset (`Date.now() + 15000`) and duplicates cancelled.
