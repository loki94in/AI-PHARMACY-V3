# Implementation Plan: Compact Staged Messaging & Daily Communications Manager

## 1. Overview & Business Requirements
1. **Never Auto-Send Guard**: Under no circumstances should patient payment due, refill reminders, or general customer messages be autonomously sent in the background. All customer notifications must enter `automation_notifications` as `staged` (or `needs_confirmation = 1`), requiring explicit pharmacist action.
2. **Compact Staged Cards in Quick Assist**:
   - Staged message cards must be compact, matching the UI density and layout of Special Orders and Refill cards.
   - Replace bulky multi-line message boxes with a 1-line collapsible preview.
   - Display action buttons: `[Send]`, `[Pause / Snooze +1d]`, `[Cancel / Dismiss]`.
3. **Daily Sent Count & Same-Day Re-send Protection**:
   - Track and display how many messages were sent today (`Sent Today: N`).
   - Detect if a patient/phone was already sent a message today to prevent accidental duplicate messaging.
   - If already sent today, display a clear warning/chip and require explicit confirmation to re-send.
4. **Daily Sent & Staged Communications Popup**:
   - A dedicated modal/popup in the app showing today's communication activity:
     - Sent messages log with timestamp.
     - Staged messages queue.
     - Allows pharmacist to inspect and re-send to any patient if required.

---

## 2. Technical Architecture & Database

### Backend Changes (`src/routes/automation.ts`)
- `GET /api/automation/notifications/daily-summary`:
  - Query total sent today (`DATE(created_at) = DATE('now')` or `DATE(resolved_at) = DATE('now')`).
  - Return map of phone numbers sent today with last sent time.
  - Return list of today's sent & staged notifications.
- `POST /api/automation/notifications/:id/snooze`:
  - Snooze notification by N days (default 1).
  - Shifts associated `patient_refills.next_refill_date` by +1 day so it doesn't immediately re-stage.
- `POST /api/automation/notifications/group/snooze`:
  - Batch snooze multiple notification IDs for a patient.

### Frontend API Client (`frontend/src/services/api.ts`)
- Add `getDailyNotificationSummary()`.
- Add `snoozeNotification(id: number, days?: number)`.
- Add `snoozeNotificationGroup(ids: number[], days?: number)`.

### Frontend Quick Assist & Layout (`frontend/src/components/Layout.tsx`)
- Refactor `QuickAssistSidebar`:
  - Query `daily-summary` alongside notifications.
  - Render compact Staged Message cards matching SO/Refill cards.
  - Add collapsible message text accordion.
  - Add `Pause / Snooze (+1d)` button.
  - Add duplicate send warning chip (`⚠️ Sent Today at HH:MM`).
  - Add `Daily Log 📋` button in header opening `DailyCommunicationsModal`.
- Create `DailyCommunicationsModal`:
  - Clean modal listing all communications from today with status, timestamps, and Re-send action.

---

## 3. Tasks & Verification Checklist

- [x] Task 1: Backend `automation.ts` endpoints (`daily-summary`, `snooze`, `group/snooze`)
- [x] Task 2: Frontend API layer in `frontend/src/services/api.ts`
- [x] Task 3: Create `DailyCommunicationsModal` component for viewing today's sent/staged log
- [x] Task 4: Refactor Staged Messages in `QuickAssistSidebar` (`Layout.tsx`) into compact cards with Send, Pause (+1d), Cancel, duplicate guard, and header daily count
- [x] Task 5: Run `npm run guardrails` and `node scripts/quick-update.mjs`

---

## 4. Verification Results
- **Guardrails**: `npm run guardrails` passed with code 0 (`tsc --noEmit` verified clean, no rule violations).
- **Knowledge Graph**: `node scripts/quick-update.mjs` updated (1062 nodes, 533 edges).
- **Zero Autonomous Sending**: Customer notifications remain strictly staged.
- **Compact UI**: Replaced multi-line message box with compact headers, 1-line folded preview, and identical 3-button footer layout (`Pause (+1d)`, `Cancel`, `Send / Re-Send`).
- **Duplicate Protection**: Badges patients already messaged today with warning chip and time of previous send.
- **Daily Communications Modal**: Accessible via `Daily Log` header button in Quick Assist, allowing pharmacists to view all messages sent today, filter by status, and intentionally re-send if desired.
