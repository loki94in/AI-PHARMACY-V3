# Implementation Plan: 7-Day Refill Operational Lifecycle & Automation

## 1. Objective & Requirements
Implement and verify the complete operational refill lifecycle in AI Pharmacy v2:
1. **7-Day Auto-Inclusion Window**: All non-completed refills due within 7 days (`<= DATE('now', 'localtime', '+7 days')`) are automatically included across Quick Assist, CRM, and Morning Briefing.
2. **1-Click "Mark Ready" with Auto-Collection Reminder**:
   - In Quick Assist and CRM: Allow 1-click "Mark Ready" directly from stage `upcoming` (when inventory is already in store stock) as well as stage `ordered`.
   - Update `frontend/src/utils/refillSettled.ts` (`getRefillStage`) so that `is_ready === 1` and reminded status take precedence over `orderedCount === 0`. Refills marked ready must immediately display in the Ready stage (`reminded`) with the Ready badge.
   - Calling `POST /api/refills/patient/:phone/mark-ready` updates `is_ready = 1`, sets `reminder_status = 'SENT'`, and automatically queues the WhatsApp pickup collection message (`refill_collection`) to the patient.
3. **Cycle Fulfillment & Auto-Scheduling for Next Month**:
   - Marking completed in CRM (`/fulfill-all` or `executeCloseRefillCycles`) or billing in POS (`POST /api/sales` checkout):
     - Automatically stamps `last_refill_date` and advances `next_refill_date` by `refill_interval_days` (default 30 days) to next month.
     - Automatically cancels pending staged notifications and purges unneeded collection/reminder messages in `whatsapp_send_queue`.
     - Automatically removes the patient from the daily morning briefing.
4. **Call Tasks & Non-WhatsApp Patients**:
   - Completing the refill cycle (via POS sale or CRM fulfill) automatically completes pending call tasks in `patient_call_tasks` for both WhatsApp and non-WhatsApp patients.
   - Broadcasts `call_tasks_updated` via `eventService` to refresh the call board.
   - Prevents duplicate call task alerts to the store owner.
5. **Quality & Safety Assurance**:
   - Pass `npx tsc --noEmit`.
   - Pass `npm test -- tests/dailyBriefingCleanup.test.ts` and `npm test -- tests/refillTodayListTruth.test.ts`.
   - Pass mandatory `npm run guardrails`.
   - Auto-update knowledge graph via `node scripts/quick-update.mjs`.

---

## 2. Architecture & File Plan

| File | Subsystem | Action | Purpose |
|------|-----------|--------|---------|
| `frontend/src/utils/refillSettled.ts` | Frontend Utility | Edit | Fix `getRefillStage` precedence bug: prioritize `is_ready` / reminded before `orderedCount === 0`. |
| `frontend/src/pages/CRM/RefillsSection.tsx` | CRM Refills | Edit | Map `is_ready` into `meds`, add 1-click `[Mark Ready]` button in `upcoming` stage, add `[Complete]` action button in `ordered`/`reminded` stages. |
| `frontend/src/components/QuickAssistSidebar.tsx` | Quick Assist | Edit | Add 1-click `[Mark Ready]` button in `upcoming` stage, render Ready badge in card header. |
| `src/routes/refills.ts` | Backend API | Edit | Enhance `executeCloseRefillCycles`: broad `reference_id` pattern match for call tasks and broadcast `call_tasks_updated`. |
| `src/routes/sales.ts` | Backend API | Edit | Enhance POS checkout: broad `reference_id` pattern match for call tasks and broadcast `call_tasks_updated`. |
| `src/services/refillService.ts` | Backend Service | Edit | Ensure `DATE(pr.last_refill_date) < DATE('now', 'localtime')` strictly excludes today-fulfilled refills from the briefing. |
| `tests/dailyBriefingCleanup.test.ts` | Automated Tests | Verify / Update | Verify briefing excludes today-fulfilled refills. |
| `tests/refillTodayListTruth.test.ts` | Automated Tests | Update | Align test expectations with 7-day operational briefing lookahead. |
| `SMALL_BUG_FIX_PLAN.md` | Tracking | Update | Document bug P2-124 fix. |

---

## 3. Step-by-Step Execution Plan

1. **Step 1: Fix `getRefillStage` in `frontend/src/utils/refillSettled.ts`**
   - Check `isRefillReady(m)` before checking `orderedCount === 0`.
   - Verify: Stage evaluates to `'reminded'` whenever any item is ready.
2. **Step 2: Update `frontend/src/pages/CRM/RefillsSection.tsx`**
   - Include `is_ready: (m as any).is_ready ?? 0` in `meds` array.
   - Add `[Mark Ready]` button to `stage === 'upcoming'`.
   - Add `[Complete]` button to `stage === 'ordered'` and `stage === 'reminded'`.
   - Verify: Clicking Mark Ready or Complete functions in 1 click.
3. **Step 3: Update `frontend/src/components/QuickAssistSidebar.tsx`**
   - In `stage === 'upcoming'`, add `[Mark Ready]` button calling `handleMarkRefillGroupReady(group)`.
   - Add Ready badge in the header when `stage === 'reminded'`.
   - Verify: 1-click ready marks ready and queues WhatsApp pickup reminder.
4. **Step 4: Harden Backend Call Task & Briefing Exclusions**
   - In `src/routes/refills.ts` & `src/routes/sales.ts`: broadcast `call_tasks_updated` and enhance `reference_id` matching.
   - In `src/services/refillService.ts`: strictly exclude today-fulfilled refills from `buildDailyOperationalBriefing`.
5. **Step 5: Run Tests & Quality Gates**
   - Run `npm test -- tests/dailyBriefingCleanup.test.ts` & `npm test -- tests/refillTodayListTruth.test.ts`.
   - Run `npx tsc --noEmit`.
   - Run `npm run guardrails`.
   - Run `node scripts/quick-update.mjs`.

---

## 4. Completed Tasks Log
- **Task 1: Precedence & Ready Fix in `frontend/src/utils/refillSettled.ts`** [Completed]
  - Fixed `getRefillStage` precedence by checking `meds.some(isRefillReady)` first so that refills marked ready directly from existing stock immediately transition to `'reminded'` stage.
- **Task 2: Direct 1-Click Mark Ready & Complete in `frontend/src/pages/CRM/RefillsSection.tsx`** [Completed]
  - Mapped `is_ready` into `meds` on line 1805.
  - Added direct `[Mark Ready]` button to `stage === 'upcoming'` alongside `[POS]`, `[Add to Cart]`, and `[Already Added]`.
  - Added direct `[Complete]` button to `stage === 'ordered'` and `stage === 'reminded'`.
- **Task 3: 1-Click Mark Ready & Header Badge in `frontend/src/components/QuickAssistSidebar.tsx`** [Completed]
  - Added direct `[Mark Ready]` button to `stage === 'upcoming'` calling `handleMarkRefillGroupReady(group)`.
  - Rendered `Ready` and `Ordered` badges in patient card headers when `stage === 'reminded'` or `'ordered'`.
- **Task 4: Call Tasks & Briefing Ledger Synchronization** [Completed]
  - In `src/routes/refills.ts` and `src/routes/sales.ts`, enhanced call task completion query to match single and comma-separated reference IDs and broadcast `call_tasks_updated` via `eventService`.
  - In `src/services/refillService.ts`, unified briefing exclusions on the `refill_fulfillments` ledger so fulfilled cycles are immediately removed from the daily briefing.
- **Task 5: Quality Gates & Verification** [Completed]
  - `tests/dailyBriefingCleanup.test.ts` passed (4/4 tests pass).
  - `tests/refillTodayListTruth.test.ts` passed (9/9 tests pass).
  - `npx tsc --noEmit` exit 0 on root backend.
  - `npx tsc --noEmit` exit 0 on frontend.
  - `npm run guardrails` exit 0 (0 violations).
  - Recorded in `SMALL_BUG_FIX_PLAN.md` under `[Fixed] P2-124`.