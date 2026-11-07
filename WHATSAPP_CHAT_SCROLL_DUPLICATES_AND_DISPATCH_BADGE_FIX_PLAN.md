# Implementation Plan: WhatsApp Chat Scroll, Message Deduplication, and Dispatch Sent-Badge Fix

## 1. Problem Overview
1. **Dispatch "Message Sent" Badge Missing for Sent Reminders (e.g. Bajaj Pharma):**
   - When Pharmarack orders are placed directly via `src/routes/pharmarack.ts` Step 4, the reminder is enqueued into `whatsapp_send_queue` but no companion entry is inserted into `automation_notifications`.
   - `distributorDispatchReminderWorker.ts` only resolves `latest_notif_status` from `automation_notifications`, causing `latest_notif_status` to return `null`.
   - Line 196 in `distributorDispatchReminderWorker.ts` contains a regex typo `/\\D/g` which fails to strip non-digits.
   - The UI requires `latest_notif_status === 'sent'` to show the green "Message Sent" badge and calculate the `5/6` counter.
2. **WhatsApp Chat Loads from Top & Smooth-Scrolls to Bottom:**
   - `getChatMessages()` loads 500 messages sorted oldest-first (`ORDER BY timestamp ASC LIMIT 500`).
   - `WhatsAppSection.tsx` mounts at `scrollTop: 0` (top) and triggers `scrollIntoView({ behavior: 'smooth' })`, causing an annoying slow scrolling animation through 500 messages.
   - User only needs to see recent messages immediately without starting from the top.
3. **Duplicate Messages (Provisional App Layer vs Real WhatsApp Layer):**
   - When sending from the app, `whatsappClient.ts` inserts a provisional row with `id LIKE 'msg_out_%'`.
   - WhatsApp Web fires `message_create` upon delivery, which inserts a second row with a real ID (`3EB0...`).
   - Neither row reconciles the other, causing `getChatMessages()` to return both rows and display duplicate messages side-by-side in the chat.

---

## 2. Surgical Changes Required

### Phase 1: Dispatch Reminder Notification Tracking & Resilient Status Resolution
- **File:** `src/routes/pharmarack.ts`
  - In Step 4 (lines ~3642–3651), when enqueuing `distributor_dispatch_reminder`, insert into `automation_notifications` (with `reference_id: queue_${queueId}` and type `distributor_dispatch_reminder`), matching `notificationService.sendDistributorDispatchReminder`.
- **File:** `src/services/distributorDispatchReminderWorker.ts`
  - Fix line 196: replace `/\\D/g` with `/\D/g`.
  - In `getTodayDistributorRemindersFast()` and `syncTodayActiveDistributors()`, add fallback to `whatsapp_send_queue` and `distributor_dispatch_reminders.status === 'Dispatched'` so `latest_notif_status` reliably resolves to `'sent'` even if `automation_notifications` has not yet synced.
- **File:** `frontend/src/pages/Dispatch/index.tsx`
  - In `sentTodayCount` and badge rendering, allow `item.status === 'Dispatched'` as an indicator of successful dispatch.

### Phase 2: WhatsApp Chat Recent Messages & Instant Bottom Scroll
- **File:** `src/whatsappClient.ts`
  - Update `getChatMessages()`:
    - Default `limit` to 50 instead of 500.
    - Query the latest N messages chronologically:
      ```sql
      SELECT * FROM (
        SELECT wm.id, wm.body, wm.from_me as fromMe, wm.timestamp, wm.type, wm.has_media as hasMedia, sm.result_json as scannedResult
        FROM whatsapp_messages wm
        LEFT JOIN scanned_messages sm ON sm.msg_id = wm.id
        WHERE ...
        ORDER BY wm.timestamp DESC
        LIMIT ?
      ) sub ORDER BY sub.timestamp ASC
      ```
- **File:** `src/routes/messaging.ts`
  - Set default `limit` to 50.
- **File:** `frontend/src/pages/CRM/WhatsAppSection.tsx`
  - Change message fetch query limit from 500 to 50.
  - Change initial scroll behavior from `behavior: 'smooth'` to `behavior: 'auto'` (instant bottom placement) so the view opens directly at the last message without scrolling animation.
  - Add "Load older messages" handler for viewing earlier history on demand.

### Phase 3: Eliminate Duplicate Outbound Messages
- **File:** `src/whatsappClient.ts`
  - In `client.on('message_create')`: When an outbound message (`fromMe = 1`) arrives, immediately prune/reconcile any provisional `msg_out_%` message with matching `chat_id` and `body` from `whatsapp_messages`.
  - In `getChatMessages()`: Add deduplication / filter out `msg_out_%` rows when a non-`msg_out_` row with identical body and timestamp exists.
- **Database Cleanup:** Run a migration/clean-up query on `whatsapp_messages` to purge historical duplicate `msg_out_%` rows where the corresponding `3EB0...` row exists.

---

## 3. Verification Criteria
1. `npm run guardrails` passes with 0 violations.
2. `tsc --noEmit` compiles cleanly.
3. Query `whatsapp_messages` in database confirms duplicate `msg_out_` rows are removed.
4. Verify `getChatMessages` returns only the latest 50 messages in chronological order.
5. Verify `getTodayDistributorRemindersFast` returns `latest_notif_status = 'sent'` for Bajaj Pharma.

---

## 4. Task Progress
- [x] Task 1: Fix `src/routes/pharmarack.ts` companion insert into `automation_notifications`
- [x] Task 2: Fix `src/services/distributorDispatchReminderWorker.ts` regex typo and resilient queue fallback
- [x] Task 3: Update `frontend/src/pages/Dispatch/index.tsx` for resilient badge display
- [x] Task 4: Update `src/whatsappClient.ts` and `src/routes/messaging.ts` to return latest messages and prune duplicate `msg_out_` rows
- [x] Task 5: Update `frontend/src/pages/CRM/WhatsAppSection.tsx` for instant bottom scroll and 50-message limit
- [x] Task 6: Run guardrails and update knowledge graph

## 5. Completed Work Summary
1. **Distributor Reminder Status & "Message Sent" Badge (`src/routes/pharmarack.ts`, `src/services/distributorDispatchReminderWorker.ts`, `frontend/src/pages/Dispatch/index.tsx`):**
   - Added `automation_notifications` insertion when dispatch reminders are enqueued directly from Pharmarack route Step 4.
   - Fixed regex typo `replace(/\\D/g, '')` -> `replace(/\D/g, '')` in `distributorDispatchReminderWorker.ts`.
   - Added resilient fallback checking `whatsapp_send_queue` and `distributor_dispatch_reminders.status === 'Dispatched'` so sent messages (like Bajaj Pharma) always resolve `latest_notif_status: 'sent'`.
   - Updated frontend badge and `sentTodayCount` calculation to recognize `status === 'Dispatched'`.

2. **Instant WhatsApp Thread Display at Last Message (`src/whatsappClient.ts`, `src/routes/messaging.ts`, `frontend/src/pages/CRM/WhatsAppSection.tsx`):**
   - In `src/whatsappClient.ts`, updated `getChatMessages()` to default to 50 messages, retrieve the latest messages chronologically using subquery `ORDER BY wm.timestamp DESC LIMIT ?` wrapped in `ORDER BY sub.timestamp ASC`, and accept `beforeTimestamp` pagination.
   - In `frontend/src/pages/CRM/WhatsAppSection.tsx`, updated the API request limit from 500 to 50, changed initial scroll from animated `behavior: 'smooth'` to instant `behavior: 'auto'` (scrolls immediately to the bottom at the newest message), and added a "Load older messages" button when earlier history exists.

3. **Elimination of Duplicate Messages (`src/whatsappClient.ts`, `src/database.ts`):**
   - In `client.on('message_create')`, when an outbound message (`fromMe = 1`) is delivered by WhatsApp Web, matching provisional `msg_out_%` messages with the same chat and body are automatically pruned from `whatsapp_messages`.
   - In `getChatMessages()`, added SQL exclusion to suppress provisional `msg_out_%` messages if the authentic WhatsApp message is already present.
   - Added startup cleanup query in `src/database.ts` to purge historical duplicate `msg_out_%` rows.
