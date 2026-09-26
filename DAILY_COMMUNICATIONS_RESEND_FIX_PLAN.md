# Daily Communications & Staged Log Message Send & Re-Send Fix Plan

## Objective
Fix the failure to send and re-send WhatsApp messages from the "Daily Communications & Staged Log" modal and QuickAssist sidebar. Ensure explicit pharmacist-initiated sends and re-sends are dispatched without being silently dropped by the worker's 48-hour Sent Register deduplication check.

---

## Root Causes Identified
1. **Queue Worker Sent Register Suppression**:
   `whatsapp_send_queue` lacked a `skip_dedupe` column. When a message was enqueued with `skipDedupe: true`, `enqueue()` skipped the INSERT dedupe check, but the worker's background loop (`processQueueInternal()`) evaluated `whatsappDeliveryRegister.isAlreadyDelivered()` against the permanent 48-hour delivery register. Because the message was sent earlier today, it was treated as an existing delivery, marked `'sent'` in the database with the old timestamp, and silently aborted without calling `sendMessage()`.
2. **Missing `skipDedupe` in Sidebar Staged Re-Send**:
   In `Layout.tsx`, `handleSendStagedNotificationGroup` called `api.enqueueSingleWhatsApp` without passing `skipDedupe: true` when re-sending already-sent staged notifications.
3. **Modal Auto-Hydration Missing on Open/Mount**:
   `loadDailySummary()` in `Layout.tsx` was never called on initial mount or when opening the modal, and `DailyCommunicationsModal.tsx` did not invoke `onRefresh()` on mount, leaving `todayLog` empty unless manually refreshed.
4. **Missing `resolved_at` and `patient_refills` Sync in `manualNotification`**:
   In `src/routes/automation.ts` (`/notifications/:id/manual`), `resolved_at` was not set, causing messages staged yesterday and sent today to be excluded from `sentTodayCount` and `todayLog`. Also, referenced `patient_refills` rows were not updated to `'notified'`.

---

## Tasks & Execution Checklist

- [x] **Task 1: Database Schema & Migration for `skip_dedupe`**
  - Update `src/database.ts`:
    - Add `skip_dedupe INTEGER DEFAULT 0` to `whatsapp_send_queue` DDL.
    - Add column existence check & migration in `ensureSchema` for `whatsapp_send_queue.skip_dedupe`.
  - Update `src/services/whatsappQueueWorker.ts`:
    - Add `skip_dedupe?: number` to `QueueItem` interface.
    - Check and migrate `skip_dedupe` column in `ensureSchema(db)`.

- [x] **Task 2: Worker Enqueue & Bypass Logic in `whatsappQueueWorker.ts`**
  - In `enqueue(...)`:
    - Persist `skip_dedupe` (1 if `options?.skipDedupe` is truthy, else 0) into `whatsapp_send_queue`.
  - In `processQueueInternal(...)`:
    - Check `Boolean((item as any).skip_dedupe)`.
    - If `skip_dedupe` is 1, bypass `whatsappDeliveryRegister.isAlreadyDelivered()` so the message dispatches to WhatsApp immediately.

- [x] **Task 3: Backend Manual Notification Endpoint Enhancements (`src/routes/automation.ts`)**
  - In `/notifications/:id/manual`:
    - Update `resolved_at = datetime('now', 'localtime')`.
    - Update referenced `patient_refills` records to `status = 'notified'`, `reminder_status = 'SENT'`, `reminder_sent_at = datetime('now')`.

- [x] **Task 4: Daily Communications Modal Auto-Refresh on Open**
  - In `frontend/src/components/DailyCommunicationsModal.tsx`:
    - Add `useEffect` to trigger `onRefresh()` whenever `isOpen` is `true`.

- [x] **Task 5: Layout Sidebar Auto-Hydration & Re-Send Forwarding**
  - In `frontend/src/components/Layout.tsx`:
    - Call `loadDailySummary()` on app initialization (when compact cache loads).
    - Call `loadDailySummary()` when `openDailyModal()` is clicked.
    - Pass `skipDedupe: true` in `handleSendStagedNotificationGroup`.

- [x] **Task 6: Verification & Guardrails**
  - Run `npx tsc --noEmit` across backend and frontend.
  - Run `npm run guardrails` (zero violations).
  - Run `node scripts/quick-update.mjs`.
  - Document fix in `SMALL_BUG_FIX_PLAN.md`.

---

## Verification Criteria
- Pharmacist clicking "Re-Send" on a previously sent message in Daily Communications Modal enqueues with `skip_dedupe: 1`.
- Worker skips 48h Sent Register deduplication when `skip_dedupe === 1` and executes `sendMessage()`.
- Daily Communications Modal auto-hydrates the list and counts immediately when opened.
- `manualNotification` sets `resolved_at` and updates `patient_refills`.
- No TypeScript or performance guardrail regressions.
