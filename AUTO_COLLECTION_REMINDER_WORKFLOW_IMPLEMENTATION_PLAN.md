# Auto-Collection Reminder Workflow Implementation Plan

## 1. Overview & Architecture
This plan implements the **One-Click Manual ↔ Auto Collection Reminder Workflow** in the Quick Assist panel.
When medicines are packed and ready at the pharmacy (`patient_refills.is_ready = 1` or `special_orders.status = 'Ready'`), the system allows the pharmacist to enable automated recurring daily pickup reminders until the medicine is sold in POS or marked completed.

### Core Principles
1. **Human-in-the-Loop Control (Rule 6)**:
   - Header master toggle in Quick Assist: `⚡ Auto [ON / OFF]`.
   - Per-patient toggle chip on each ready card.
   - Sending a manual reminder automatically activates `Auto-Remind: ON` for that patient.
   - Pharmacist can pause (+1d), toggle back to Manual, or cancel anytime.
2. **Safe Background Delivery (Anti-Ban & Respectful)**:
   - Evaluates while the app is running and WhatsApp client status is `'ready'`.
   - Dispatches only between **10:00 AM and 6:00 PM** (store open hours; suppressed on holidays/Sundays).
   - Once-daily limit with random time jitter to prevent burst spam.
   - Gated worker pattern adhering to rule [B1] (`activityTracker.isIdle()`) and rule [B4] (shop local time).
3. **Automatic Disarm on Sale**:
   - The moment a medicine is checked out via POS (`src/routes/sales.ts`), the refill cycle advances or special order is fulfilled, automatically resetting `auto_remind = 0` and clearing staged notifications.

---

## 2. Implementation Tasks Checklist

- [x] **Task 1: Database Schema & Migration**
  - [x] Add `auto_remind` (INTEGER DEFAULT 0), `last_collection_reminder_at` (TEXT), `collection_reminder_count` (INTEGER DEFAULT 0) to `patient_refills`.
  - [x] Add `auto_remind` (INTEGER DEFAULT 0), `last_collection_reminder_at` (TEXT), `collection_reminder_count` (INTEGER DEFAULT 0) to `special_orders`.
  - [x] Register `quick_assist_auto_remind_master = 'true'` in `app_settings` via `src/database.ts`.
  - [x] Ensure safe boot migration in `ensureSchema` / DDL block.

- [x] **Task 2: Background Auto-Collection Reminder Service**
  - [x] Create `src/services/collectionReminderWorker.ts` with:
    - `runCollectionReminderCycle(force?: boolean)`
    - `startCollectionReminderWorker()` / `stopCollectionReminderWorker()`
    - Store schedule check (10 AM – 6 PM window, not closed day).
    - WhatsApp readiness check.
    - Patient grouping & personalized reminder messaging.
    - Paced enqueue into `whatsappQueueWorker`.
    - P3 idle-gating with `activityTracker.isIdle()`.
  - [x] Integrate worker in `src/server.ts` Phase 3 boot sequence.

- [x] **Task 3: Backend API Endpoints**
  - [x] Add `POST /api/refills/:id/auto-remind` and `POST /api/refills/patient/:phone/auto-remind` to toggle auto-remind in `src/routes/refills.ts`.
  - [x] Update `POST /refills/send-reminder-now` and `POST /refills/send-grouped` to auto-activate `auto_remind = 1` and update timestamp on manual send.
  - [x] Add `POST /api/orders/:id/auto-remind` in `src/routes/orders.ts`.
  - [x] Add `POST /api/refills/auto-remind/master-toggle` and `GET /api/refills/auto-remind/settings`.
  - [x] Add `POST /api/refills/auto-remind/run-now` for immediate testing.

- [x] **Task 4: Automatic Disarm on POS Sale Checkout**
  - [x] In `src/routes/sales.ts`, ensure fulfilling a refill resets `auto_remind = 0, collection_reminder_count = 0, last_collection_reminder_at = NULL`.
  - [x] In `src/routes/sales.ts`, ensure fulfilling a matched special order resets `auto_remind = 0, last_collection_reminder_at = NULL, collection_reminder_count = 0`.

- [x] **Task 5: Frontend API & Types**
  - [x] Add `auto_remind`, `last_collection_reminder_at`, and `collection_reminder_count` to types in `frontend/src/types/api.ts`.
  - [x] Add API helper functions in `frontend/src/services/api.ts`:
    - `toggleRefillAutoRemind(refillId, enabled)`
    - `togglePatientRefillAutoRemind(phone, enabled)`
    - `toggleOrderAutoRemind(orderId, enabled)`
    - `toggleQuickAssistAutoRemindMaster(enabled)`
    - `getQuickAssistAutoRemindSettings()`
    - `triggerCollectionReminderCycleNow()`

- [x] **Task 6: Frontend Quick Assist UI Integration**
  - [x] In `frontend/src/components/Layout.tsx` (`QuickAssistSidebar`):
    - Added Master `⚡ Auto ON / Auto OFF` header button in Quick Assist header.
    - On each Refill card, added interactive `⚡ Auto ON (Nx)` / `⚪ Manual` toggle chip and sent count indicator.
    - On Special Orders Ready card, added interactive `⚡ Auto ON (Nx)` / `⚪ Manual` toggle chip.
    - Manual "Send" / "Resend" flips the card state to `⚡ Auto ON`.
    - Clicking "Bill in POS" loads items into POS and automatically disarms reminders upon checkout.

- [x] **Task 7: Verification, TypeScript Check & Guardrails**
  - [x] Run `npx tsc --noEmit` across backend and frontend to verify zero TypeScript errors.
  - [x] Run `npm run build` on frontend to verify bundle compilation and production asset generation.
  - [x] Run `npm run guardrails` to verify zero violations of speed architecture, idle-gating, and date conventions.
  - [x] Run `node scripts/quick-update.mjs` to synchronize the 3D knowledge graph.

---

## 3. Progress Tracking & Execution Log

| Task | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Task 1 | COMPLETED | 2026-10-02 | Added `auto_remind`, `last_collection_reminder_at`, `collection_reminder_count` to `patient_refills` and `special_orders`; default master setting in `app_settings` |
| Task 2 | COMPLETED | 2026-10-02 | Created `collectionReminderWorker.ts` with WhatsApp readiness check, store hour window (10am-6pm), weekly-off/holiday skipping, idle-gating (B1), and local shop time (B4) |
| Task 3 | COMPLETED | 2026-10-02 | Added master toggle, per-patient, per-refill, per-order endpoints, auto-arm on manual send in `refills.ts` and `orders.ts` |
| Task 4 | COMPLETED | 2026-10-02 | POS checkout disarm implemented in `sales.ts` for matched refills & special orders |
| Task 5 | COMPLETED | 2026-10-02 | Updated `api.ts` types and client methods in `frontend/src/services/api.ts` |
| Task 6 | COMPLETED | 2026-10-02 | Quick Assist header master switch + refill & special order cards interactive chips in `Layout.tsx` |
| Task 7 | COMPLETED | 2026-10-02 | Frontend `npm run build` OK (exit 0), backend `tsc --noEmit` OK (exit 0), `guardrails` OK (exit 0), `quick-update.mjs` OK |
