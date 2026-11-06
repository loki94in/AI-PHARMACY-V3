# IMPLEMENTATION PLAN: Refill Snooze Date Calculation & Visibility Fix

## Plan Name
`REFILL_SNOOZE_DATE_FIX_IMPLEMENTATION_PLAN`

---

## 1. Problem Formulation & Root Cause Analysis

### Identified Defects
1. **Date Overwrite Bug (Moving Refills Closer Instead of Postponing)**:
   - In `src/routes/automation.ts` (`/notifications/snooze-patient` and `/notifications/group/snooze`), the query executed:
     ```sql
     UPDATE patient_refills 
     SET next_refill_date = DATE('now', 'localtime', ?),
         reminder_status = 'SNOOZED'
     ```
   - Passing `+1 day` forced `next_refill_date` to tomorrow (`now + 1 day`), regardless of whether the original due date was 10 or 20 days in the future.
   - If a patient's refill was due in 15 days, clicking **Snooze +1 Day** brought it forward to tomorrow!
   - For overdue refills, it set the date to tomorrow, but tomorrow is still within the upcoming 7-day action window.

2. **Refill Card Visibility Leak (Instant Reappearance)**:
   - Quick Assist filters for upcoming refills due within 7 days (`diffDays <= 7`).
   - CRM Refills filters for overdue or upcoming within the 6-day lead window (`diffDays <= 6`).
   - Because snoozing set `next_refill_date` to tomorrow (`diffDays = 1`), it immediately qualified for the active lead/upcoming lists.
   - Neither `/refills/panel` nor the frontend lists excluded `reminder_status = 'SNOOZED'`.
   - `QuickAssistSidebar.tsx` collapsed any `reminder_status` that wasn't `SENT`/`QUEUED`/`SENDING`/`FAILED` into `'NOT_SENT'`, obliterating the snoozed state.
   - As a result, when `refetchRefills()` or `load(true)` ran right after snoozing, the patient card reappeared immediately, giving the perception that snooze failed completely.

3. **Stage A Upcoming Refills Have No Row in `automation_notifications`**:
   - `UPDATE automation_notifications ... WHERE status IN ('staged', 'snoozed')` updated 0 rows for upcoming refills because notifications are only generated when staged.
   - The subsequent background sync in `refillService.ts` found no active snoozed row in `automation_notifications`, so it immediately re-staged the reminder.

4. **False Error Toast Trigger in CRM**:
   - In `RefillsSection.tsx`, `await load(true)` was situated inside the `try` block of `handleSnoozePatient`. Any transient refresh latency or network hiccup tripped the catch block, firing `'Failed to snooze reminder'` even if the backend update succeeded.

---

## 2. Technical Architecture & File Ownership

### A. Backend Route & Service Layer
- **`src/routes/automation.ts`**:
  - Update `POST /notifications/snooze-patient`:
    - Shift `next_refill_date` forward from `MAX(COALESCE(next_refill_date, DATE('now', 'localtime')), DATE('now', 'localtime'))`:
      ```sql
      UPDATE patient_refills 
      SET next_refill_date = DATE(MAX(COALESCE(DATE(next_refill_date), DATE('now', 'localtime')), DATE('now', 'localtime')), ?),
          reminder_status = 'SNOOZED'
      ```
    - Check if an `automation_notifications` record exists; if not, create a snoozed entry so that background sync engines (`refillService.ts`) acknowledge the active snooze until `snoozed_until`.
  - Update `POST /notifications/group/snooze`:
    - Apply identical date-advancement logic instead of hard-clobbering `next_refill_date` to `now + days`.

- **`src/services/refillService.ts`**:
  - In `getPendingRefills` and `syncStagedRefillNotificationForPatient`, honor `reminder_status = 'SNOOZED'` and check `automation_notifications.snoozed_until`. Do not re-stage while within the snooze duration.

- **`src/routes/refills.ts`**:
  - In `/refills/panel` and `/refills`, ensure that patients snoozed to a future date are not returned under the urgent active actions window unless explicitly filtering for snoozed.

### B. Frontend Presentation Layer
- **`frontend/src/components/QuickAssistSidebar.tsx`**:
  - Preserve `reminder_status: 'SNOOZED'` in the TypeScript status union.
  - Filter out snoozed refill groups from the active Stage A view during their snooze duration.
- **`frontend/src/pages/CRM/RefillsSection.tsx`**:
  - Separate `load(true)` from the snooze API invocation so refresh errors do not trigger false "Failed to snooze" toasts.
  - Render a clear **"💤 Snoozed (Due in Xd)"** chip when `patient.reminder_status === 'SNOOZED'`.
  - Exclude snoozed refills from the active overdue/lead action counts and action tabs during the snooze period.

---

## 3. Verification Criteria & Test Plan

1. **Date Postponing**:
   - Patient due in 5 days (`2026-11-11`) snoozed for +1 Day -> `next_refill_date` becomes `2026-11-12` (NOT `now + 1 day`).
   - Overdue patient (e.g. due `2026-11-04`) snoozed for +1 Day -> `next_refill_date` becomes `2026-11-07` (tomorrow).
2. **List Disappearance**:
   - Snoozing a patient in CRM or Quick Assist suppresses the card immediately from the active Stage A / Lead window.
3. **No False Errors**:
   - Snoozing executes cleanly without false error toasts.
4. **Guardrail Compliance**:
   - `npm run guardrails` exits 0 with zero rule violations.

---

## 4. Implementation Tasks & Progress Tracker

- [x] **Task 1**: Correct SQLite date calculation in `src/routes/automation.ts` (`snooze-patient`, `group/snooze`, and `/notifications/:id/snooze`). Postpones future dates from `MAX(COALESCE(DATE(next_refill_date), DATE('now', 'localtime')), DATE('now', 'localtime'))`.
- [x] **Task 2**: Ensure Stage A upcoming refills record a `snoozed_until` entry in `automation_notifications` and respect `reminder_status = 'SNOOZED'` so sync workers do not immediately re-stage them.
- [x] **Task 3**: Update `src/services/refillService.ts` and `src/routes/refills.ts` to respect snooze suppression window and preserve group `reminder_status: 'SNOOZED'`.
- [x] **Task 4**: Update `frontend/src/components/QuickAssistSidebar.tsx` and `RefillsSection.tsx` to handle `'SNOOZED'` status, exclude snoozed cards from active lists/counts, and isolate toast triggers.
- [x] **Task 5**: Verify end-to-end via automated integration test `tests/refillSnoozeFix.test.ts` (3/3 passing), run `npm run guardrails` (PASS with 0 violations), and sync knowledge graph (`quick-update.mjs`).

