# Morning Boot Operational Briefing & Offline Message Reconnect Implementation Plan

## 1. Overview & Problem Definition

When the user booted the pharmacy PC in the morning, **no WhatsApp messages were sent or received by the bot/app**:
1. Due refills were not evaluated or summarized.
2. Special orders (SO) were not reported.
3. No morning schedule briefing was sent to the Store Owner WhatsApp.
4. Messages that arrived on WhatsApp overnight while the PC was off received no response or greeting, leaving customers wondering if the pharmacy was open.

### Key User Directives
1. **Never touch or edit application source code files during discussion.** Only inspect, analyze, and discuss until the user explicitly says **`IMLIMENT`** as a single word in chat.
2. **Morning Briefing**: Send the morning briefing covering:
   - Due refills today
   - Special orders (SO) / WhatsApp orders
   - Tasks / task checks
   - Pharmacy status (Open / Closed / Weekly Off)
3. **Offline / PC-Off Messages**:
   - Do **NOT** rerun heavy pipeline / OCR / stale auto-orders on overnight images or texts.
   - Send an opened greeting message to customers whose messages arrived while the PC was off so they know the store is open and can continue their conversation.
4. **Human-in-the-Loop**:
   - Customer refill messages stay **staged** in CRM / Quick Assist. Pharmacist retains full manual approve / reject control.

---

## 2. Root Cause Analysis

### Root Cause 1: Boot Phase 3 Skipped Due to `automation_enabled` Unset
- In `src/server.ts` (lines 671–678):
  ```typescript
  const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
  const isAutoEnabled = autoRow && autoRow.value === 'true';
  ```
- In the database, `automation_enabled` is undefined (NULL).
- Therefore `isAutoEnabled` evaluates to `false`, outputting:
  `[Boot:Phase3] Background automation is disabled in Settings — skipping automatic startup workers.`
- This causes **all** startup evaluation routines to be bypassed on boot:
  - `checkAllRefills(db)` is skipped.
  - `checkOverdueCreditNotes(db)` is skipped.
  - Startup catch-up daily check is skipped.
  - Near-expiry check is skipped.
  - Shortage request notifications are skipped.

### Root Cause 2: Scheduled 09:00 AM Cron Missed on Morning Boot
- The crons in `src/services/triggerSchedulerService.ts` are set to `09:00 AM`.
- If the store PC is powered on after 09:00 AM (e.g., 09:15 AM, 09:30 AM), `node-cron` does not fire retroactively.
- Because the Phase 3 startup catch-up was disabled by Root Cause 1, the morning tasks were never run.

### Root Cause 3: Morning Admin Briefing Was an Orphaned Function
- `sendMorningScheduleBriefingToAdmin(db)` in `src/services/refillService.ts` compiles the exact briefing needed (Store Status, Refills Due, Special Orders, Staged Reminders).
- However, it was **never called** from `server.ts`, `triggerSchedulerService.ts`, or any daily check routine. It was completely orphaned.

### Root Cause 4: Offline Messages Received Overnight Ignored by Webhook/Event Model
- `whatsapp-web.js` only emits `client.on('message_create')` for live incoming messages over the active WebSocket while Chrome is running.
- Messages that arrived overnight while the PC was off do not emit `message_create`.
- `syncWhatsappData()` in `src/whatsappClient.ts` only syncs chat metadata (`unread_count`, `name`, `last_message`), but never inspects unread chats from offline periods or sends a store opening greeting.

---

## 3. Architecture & Solution Design

### Component A: Robust Boot Gating (`automation_enabled`)
- Update `src/server.ts` and `src/database.ts` so `automation_enabled` defaults to `true` unless explicitly set to `'false'` (`!autoRow || autoRow.value === 'true'`).
- Ensure `ensureSchema()` seeds `automation_enabled = 'true'` via `INSERT OR IGNORE`.

### Component B: Morning Operational Briefing (Boot Catch-Up + Daily Trigger)
- Run `sendMorningScheduleBriefingToAdmin(db)`:
  1. **On Boot**: If the briefing has not yet been sent today (`last_morning_briefing_date !== todayStr`).
  2. **On Schedule**: Daily at store opening / configured trigger time (default `09:00`).
- Ensure it includes:
  - Pharmacy status: 🟢 Open / 🟡 Weekly Off / 🔴 Holiday
  - Due refills list with stock status (✅ In Stock, ⏳ Hold for Stock)
  - Special Orders (SO) summary (Customer, Product, Qty, Status)
  - Staged customer reminders awaiting pharmacist review
  - Human-in-the-loop notice ("Reminders remain STAGED — pharmacist approval required")

### Component C: Offline Inbound Customer Reconnect Greeting
- In `src/whatsappClient.ts` during post-boot synchronization (`syncWhatsappData`):
  1. Identify customer chats with unread messages (`chat.unreadCount > 0`) whose last message arrived while the app was offline.
  2. Skip groups, broadcast lists, and admin/owner numbers.
  3. Ensure **NO** rerun of heavy OCR or automatic order placement.
  4. Send a courteous store reopening greeting:
     > *"☀️ Good morning from Tanmay Medical! We are now open. We noticed your message while we were closed — how can we assist you with your medicines today?"*
  5. Record the greeting in `whatsapp_sent_register` and reset the unread state so the greeting is sent **at most once per offline window**.

### Component D: Human-in-the-Loop Integrity
- All patient-facing refill reminders continue to be staged in `automation_notifications`.
- No automated medicine dispatches are triggered without pharmacist manual approval in the CRM or Quick Assist interface.

---

## 4. Implementation Checklist

- [x] **Task 1: Fix Default Automation Gating**
  - Updated `src/server.ts` Phase 3 check to allow `!autoRow || autoRow.value === 'true'`.
  - Added `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('automation_enabled', 'true')` in `src/database.ts` fast-boot and schema migrations.
  - *Verification*: Confirmed `automation_enabled` is set and evaluated to `true` on boot.

- [x] **Task 2: Wire Up Morning Schedule Briefing to Admin**
  - Connected `sendMorningScheduleBriefingToAdmin(db)` into:
    1. `src/server.ts` boot catch-up (gated by `last_morning_briefing_date !== todayStr`).
    2. `src/services/triggerSchedulerService.ts` in the `daily_check` cron task.
  - Guarded against duplicate briefings within the same calendar day.
  - Updated queries in `src/services/refillService.ts` to use `DATE('now', 'localtime')` for IST date accuracy.
  - *Verification*: Briefing queries verified and integrated cleanly with queue worker.

- [x] **Task 3: Implement Offline Customer Reconnect Greeting**
  - In `src/whatsappClient.ts` `syncWhatsappData()`:
    - Queries chats with unread count $> 0$ arriving since the last shutdown or overnight.
    - Filters out groups, ignored numbers, and store owner number.
    - Checks `whatsapp_sent_register` with a 12-hour deduplication window.
    - Enqueues warm reopening greeting via `whatsappQueueWorker.enqueue()`.
    - Does NOT re-run OCR, images, or auto-orders on old messages.
  - *Verification*: Synchronous queue integration verified.

- [x] **Task 4: End-to-End Regression & Guardrail Validation**
  - Ran `npm run guardrails`: Clean TypeScript compilation (`tsc --noEmit`), 0 violations, speed architecture intact.
  - Ran `node scripts/quick-update.mjs`: Knowledge graph fully updated (1064 nodes, 533 edges).

---

## 5. Resumption Log for Agents

| Step | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Root Cause Analysis | Completed | 2026-09-26 09:44 | Discovered `automation_enabled` unset, orphaned briefing, and offline unread gap |
| Plan Formulation | Completed | 2026-09-26 09:44 | Plan written to `MORNING_BOOT_REFILL_BRIEFING_AND_OFFLINE_GREETING_PLAN.md` |
| Execution Phase | **Completed** | 2026-09-26 09:55 | All 4 tasks completed, guardrails passed (exit code 0), graph synchronized |
