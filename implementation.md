# Implementation Plan — Refill "Today List" Truth, Owner Message Combining & WhatsApp Queue Power-Cut Resilience

> **Status:** COMPLETED — Verified with tests & performance guardrails
> Bugs:
> - **P2-111** — Fix A: Owner "today list" purity (no completed patients in morning briefing, cart runs, or staged counts)
> - **P2-112** — Fix B: Combine the owner's own WhatsApp messages into ONE send (daily briefing stays separate)
> - **P2-113** — Fix C: WhatsApp queue power-cut resilience + truthful retry/attempt report

---

## 1. Problem Statements & Root Cause

1. **Completed patients still appearing in owner lists (P2-111)**:
   - Briefing re-admits completed patients: refill preview was a 7-day forward window (`next_refill_date <= now + 7 days`) AND had an early re-admit clause (`today >= last_refill_date + MAX(7, interval) - 7 days`) which re-added completed patients the moment their next cycle was within 7 days.
   - Staged reminders query in briefing and alert didn't re-check linked `patient_refills` status (completed/canceled).
   - `purgePendingCustomerReminders` didn't clean staged rows when callers passed names/meds without `refillIds`.
   - `processRefillCartItem` and `sendRefillCartSummary` lacked checks for completed status.

2. **Owner receives separate WhatsApp sends (P2-112)**:
   - ~19 internal admin messages (cart summaries, alerts, reports) were each queued as separate messages.
   - Requirement: Combine them into one formatted digest with divider sections under a character/section cap, while keeping the ☀️ Morning Briefing strictly separate/standalone.

3. **PC power cut ruins queue / no retry report (P2-113)**:
   - Boot recovery in `whatsappQueueWorker.ts` converted all pending/failed_offline messages to `review_required` except for distributor reminders and briefing.
   - No timestamps or structured attempts log was kept on items.
   - UI lacked truthful attempt count and last attempt timestamp reporting.

---

## 2. Architecture & Blueprint

| Layer | File | Planned Changes |
|---|---|---|
| `layer:data` | `src/database.ts` | Add `last_attempt_at TEXT` and `attempts_log TEXT` to `whatsapp_send_queue` across all 3 schema tiers (CREATE, fast-boot, and alter-statements). |
| `layer:service` | `src/services/whatsappQueueWorker.ts` | 1. Boot recovery rewrite: restore all same-day items to pending, cross-check with permanent Sent Register.<br>2. Auto-kick worker after recovery.<br>3. Attempt recording: update `last_attempt_at` (local time) and append to `attempts_log` (capped at 10).<br>4. Central owner message merge inside `enqueue()`. |
| `layer:service` | `src/services/refillService.ts` | 1. Narrow morning briefing refills to `next_refill_date <= today` (today/overdue only).<br>2. Remove early re-admit clause.<br>3. Staged query check active non-completed refills.<br>4. Fix purge call sites and staged purge filter. |
| `layer:service` | `src/services/refillCartService.ts` | 1. Cart item guard: reject `completed` refills.<br>2. Summary filter: drop `completed`/`canceled` refills from sent summary. |
| `layer:api` | `src/routes/refills.ts` | Verify status before adding to cart in `/:id/add-to-cart` and `/confirm-patient`. |
| `layer:api` | `src/routes/whatsappQueue.ts` | Expose `last_attempt_at`, `attempts_log`, and today's summary in `GET /status`. |
| `layer:presentation` | `frontend/src/services/api.ts` & `frontend/src/components/WhatsAppQueuePopover.tsx` | Show per-item attempt counts ("Tried N× · last HH:MM · error") and summary status strip. |
| `layer:testing` | `tests/refillTodayListTruth.test.ts` | Automated regression test for A6. |

---

## 3. Checklist & Execution Phases

- [x] **Phase 1 — Schema Upgrades (Fix C1)**
  - [x] Add `last_attempt_at` and `attempts_log` to full DDL block in `src/database.ts`
  - [x] Add `last_attempt_at` and `attempts_log` to fast-boot DDL in `src/database.ts`
  - [x] Add `last_attempt_at` and `attempts_log` to `ensureSchema` alter statements in `src/database.ts`
  - [x] Verify `npx tsc --noEmit`

- [x] **Phase 2 — Core WhatsApp Queue Engine (Fix C2, C3, C4, B1)**
  - [x] Boot recovery rewrite in `whatsappQueueWorker.ts:cleanupOldSentItems`
  - [x] Auto-trigger processing after any items recovered
  - [x] Dispatch attempt tracking: update `last_attempt_at` & `attempts_log` on each attempt/failure
  - [x] Implement central owner message combining in `whatsappQueueWorker.ts:enqueue`
  - [x] Fix `notifyAdminStagedReminders` type from `'admin_morning_briefing'` to `'admin_staged_reminders'`

- [x] **Phase 3 — Owner-Surface Purity (Fix A)**
  - [x] Fix A1: Narrow briefing refill query to `next_refill_date <= today`, drop early re-admit clause in `src/services/refillService.ts`
  - [x] Fix A2: Guard `/refills/:id/add-to-cart` and `processRefillCartItem` against `completed`/`canceled` refills
  - [x] Fix A3: Filter completed/canceled items in `sendRefillCartSummary`
  - [x] Fix A4: Exclude completed/canceled/inactive refills from staged counts and alerts
  - [x] Fix A5: Audit and enhance purge call sites so staged notifications are cancelled reliably
  - [x] Fix A6: Add regression test `tests/refillTodayListTruth.test.ts`

- [x] **Phase 4 — Frontend Truth Report (Fix C5)**
  - [x] Expose `last_attempt_at`, `attempts_log`, and `todaySummary` in `src/services/whatsappQueueWorker.ts:getWorkerState`
  - [x] Update frontend types in `frontend/src/services/api.ts`
  - [x] Update `frontend/src/components/WhatsAppQueuePopover.tsx` with attempt badges and today's summary strip

- [x] **Phase 5 — Verification & Register**
  - [x] Run regression tests (`PASS tests/refillTodayListTruth.test.ts` — 9/9 pass)
  - [x] Run `npm run guardrails` (TypeScript compile + rule engine exit 0)
  - [x] Run `node scripts/quick-update.mjs`
  - [x] Register P2-111, P2-112, P2-113 in `SMALL_BUG_FIX_PLAN.md`

---

## 4. Execution Tasks & Completed Work Log

1. **Schema Upgrades (`src/database.ts`, `src/services/whatsappQueueWorker.ts`)**:
   - Added `last_attempt_at TEXT DEFAULT NULL` and `attempts_log TEXT DEFAULT NULL` across full DDL, fast-boot duplicate, alter checks, and worker ensureSchema.
   - Extended TypeScript interfaces `QueueItem` and `QueueWorkerState`.

2. **Core WhatsApp Queue Engine (`src/services/whatsappQueueWorker.ts`)**:
   - Implemented `OWNER_DIGEST_TYPES` set and message combining logic in `enqueue()`: merges multiple owner messages into a single pending row separated by `\n\n──────────────\n` and `🔹 *Section N*` (cap: ≤ 8 sections, ≤ 5,000 characters).
   - Strictly excluded `admin_morning_briefing` (☀️ Morning Briefing always sent standalone).
   - Rewrote `cleanupOldSentItems()` for power-cut resilience: restores all unconfirmed same-day items to `pending`, cross-checks permanent Sent Register (`whatsappDeliveryRegister`) to prevent duplicate sends, and triggers processing immediately.
   - Instrumented dispatch loop status updates to write `last_attempt_at` (local time) and `attempts_log` (JSON history) on all dispatch outcomes.
   - Added `todaySummary` calculation (`sent`, `failed`, `pending`, `review_required`, `skipped`, `total`) to `getWorkerState()`.

3. **Owner Surface Purity (`src/services/refillService.ts`, `src/services/refillCartService.ts`, `src/routes/refills.ts`)**:
   - In `buildDailyOperationalBriefing`: Narrowed queries to `DATE(pr.next_refill_date) <= DATE('now', 'localtime')`, dropped early re-admit clause, updated headings to "Today & Overdue" (was "Next 7 Days"), and empty state to "No refills due today".
   - In `refillCartService.ts`: Added guard in `processRefillCartItem` to reject completed/inactive refills, and filtered out completed refills in `sendRefillCartSummary`.
   - In `refills.ts`: Added status check in `POST /confirm-patient` and `POST /send-staged-briefing` to filter out completed refills, and updated queue type to `admin_staged_reminders`.
   - In `refillService.ts:purgePendingCustomerReminders`: Corrected query to check `message` in `automation_notifications` and cancel matching staged reminders.

4. **Frontend Truth Reporting (`frontend/src/services/api.ts`, `frontend/src/components/WhatsAppQueuePopover.tsx`)**:
   - Added `last_attempt_at`, `attempts_log` to `WhatsAppQueueItem` and `todaySummary` to `WhatsAppQueueStatus`.
   - In `WhatsAppQueuePopover.tsx`: Added attempt badge ("Tried N× · last HH:MM"), attempt history log drawer in expanded view, and truthful today summary metric strip using semantic Tailwind tokens.

5. **Testing & Performance Guardrails**:
   - Created `tests/refillTodayListTruth.test.ts` covering P2-111, P2-112, and P2-113 (all 9 tests passing).
   - Passed `npx tsc --noEmit` and `npx tsc -p frontend/tsconfig.app.json --noEmit` with 0 errors.
   - Passed `npm run guardrails` with 0 violations (speed architecture intact).
   - Registered P2-111, P2-112, P2-113 in `SMALL_BUG_FIX_PLAN.md`.
