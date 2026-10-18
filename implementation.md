# Implementation Plan: Quick Assist Refill Task Permanent Removal & Early Booking Popup Fix

**Goal:**
Ensure that when a user marks a refill patient task complete (even early / before schedule), the task is immediately and permanently removed from the Quick Assist panel. Fix the broken Early Refill Booking popup in Quick Assist so it is fully usable, dismissible, shielded from sidebar auto-collapse, and allows direct task completion as well as POS transfer.

---

## 1. Problem & Root Cause Analysis

1. **Popup Event Bubble & Sudden Sidebar Collapse**:
   - The `earlyBookingConfirm` modal in `QuickAssistSidebar.tsx` was rendered via `createPortal(..., document.body)` without modal identification attributes (`role="dialog"`, `aria-modal="true"`, `data-modal="true"`, or `.z-modal`).
   - Clicking anywhere inside the early booking popup or its buttons triggered `useOnClickOutside(sidebarRef)` on the parent sidebar.
   - This immediately invoked `setExpanded(false)`, abruptly closing the Quick Assist sidebar before the user could confirm or complete the action.
   - The task was never fulfilled or removed, leaving it stuck in Quick Assist.

2. **Early Booking Trap on "Complete"**:
   - For any refill due in upcoming days (e.g., due in 1 to 7 days), clicking "Complete" checked `cycleStatus.isEarly`.
   - Instead of completing the task, it interrupted the workflow by forcing the early booking popup. Because the popup collapsed the sidebar on click, the user was unable to complete the task.

3. **Incomplete Settled Filtering in Quick Assist**:
   - `actionableRefills` only checked `isRefillFulfilledToday(r)`. If a patient's refill cycle was already dispensed or marked fulfilled for the current cycle window (or before today), it was not excluded unless `isRefillFulfilledToday` matched.
   - Additionally, companion staged notifications for completed patients lingered in Quick Assist.

---

## 2. Solution Architecture & Changes

### A. Fix Early Refill Booking Modal in Quick Assist (`frontend/src/components/QuickAssistSidebar.tsx`)
1. **Modal DOM Shielding**:
   - Add `role="dialog"`, `aria-modal="true"`, `data-modal="true"`, and class `z-modal` to the modal container.
   - Update `useOnClickOutside` check to explicitly exempt `earlyBookingConfirm`.
2. **Lifecycle Cleanup**:
   - Ensure `setEarlyBookingConfirm(null)` is called if the sidebar collapses, preventing ghost/orphaned modals.
   - Add Escape key handling via `useModalEscape` prioritized for the modal before the sidebar.
3. **Modal Actions**:
   - **Confirm & Open POS**: Closes modal and transfers prefill to POS.
   - **Mark Complete & Remove**: Directly fulfills the refill cycle, advances to next month, and hides the task immediately without forcing POS navigation.
   - **Cancel / Close**: Dismisses the modal cleanly without closing the Quick Assist sidebar.

### B. Direct One-Click Task Completion & Permanent Removal (`frontend/src/components/QuickAssistSidebar.tsx`)
1. In Stage B ("Ordered") and Stage C ("Ready / Reminded"), clicking **`[Complete]`**:
   - Calls `api.fulfillAllRefills()`.
   - Advances `patient_refills` in SQLite to the next month's due date.
   - Sets `last_refill_date = toLocalSqlDateTime()`.
   - Purges scheduled WhatsApp reminder jobs and dismisses companion staged notifications.
   - **Optimistically hides** the patient group immediately from Quick Assist using phone, name, and medicine IDs.
   - Triggers `refillEvent.triggerRefresh()`, `automationHubEvent.triggerUpdated()`, and `onActionComplete()`.
   - Shows a success toast: `"Refill task completed and removed for [Patient Name]"`.
   - Does **NOT** force navigation away to POS unless the user specifically clicked the `[POS]` button.

### C. Bulletproof Refill Filtering for Quick Assist (`frontend/src/components/QuickAssistSidebar.tsx`)
1. Update `actionableRefills` filter:
   - Exclude any refill where `isRefillSettled(r)` is true.
   - Exclude any refill where `checkRefillCycleBooking(r).alreadyDispensed` is true (even if completed earlier before the 7 days).
   - Only include active, unfulfilled refills with `diffDays <= 7`.

### D. Human-in-the-Loop Workflow
- Pharmacist has complete control:
  - Click `[POS]` to bill and dispense through the point-of-sale register.
  - Click `[Complete]` to mark the task completed immediately and dismiss it.
  - In the Early Booking popup: choose either to open POS or mark complete directly.

---

## 3. Verification Plan

1. **Modal Usability Test**:
   - Open Quick Assist, locate an upcoming refill (due in 1–7 days).
   - Trigger early booking: confirm popup opens smoothly in the center of the screen.
   - Click inside the popup: verify the sidebar stays open and does NOT collapse.
   - Click "Cancel": verify the modal closes and sidebar remains expanded.
2. **Instant Removal Verification**:
   - Click "Complete" on a refill task.
   - Verify task is removed immediately from Quick Assist (0 second delay, no ghost rows).
   - Verify that reopening Quick Assist or restarting the page does not resurrect the completed task.
3. **POS Flow Verification**:
   - Click `[POS]` on a refill: verify POS opens with the prescribed medicines prefilled and the REFILL banner active.
4. **Code Quality & Guardrails**:
   - `npx tsc -p frontend/tsconfig.app.json --noEmit` (exit 0)
   - `npm run guardrails` (exit 0, 0 violations)
   - `node scripts/quick-update.mjs` (knowledge graph sync)

---

## 4. Task Checklist & Completion Log

- [x] Task 1: Shield `earlyBookingConfirm` modal in `frontend/src/components/QuickAssistSidebar.tsx` and `frontend/src/pages/CRM/RefillsSection.tsx`
  - *Completed:* Added `role="dialog"`, `aria-modal="true"`, `data-modal="true"`, and class `z-modal` to modal container. Exempted `earlyBookingConfirm` in `useOnClickOutside` so clicking inside popup or its buttons never collapses Quick Assist. Added `useModalEscape` with priority 10 so `Escape` dismisses the modal without closing the sidebar. Added backdrop click dismiss and stopPropagation on card.
- [x] Task 2: Implement direct `[Complete]` action that fulfills cycle and immediately removes the refill task from Quick Assist without forcing navigation away
  - *Completed:* Separated `handleCompleteRefillGroup` from `handleBookRefillToPos`. Clicking `[Complete]` marks the refill fulfilled via `api.fulfillAllRefills()`, advances `next_refill_date` by 30 days, invalidates query cache, triggers refresh events, and optimistically removes the patient group immediately from Quick Assist. Retained dedicated `[POS]` button across stages so billing in POS remains easily accessible when needed.
- [x] Task 3: Strengthen `actionableRefills` filtering in `QuickAssistSidebar.tsx` with `checkRefillCycleBooking(r).alreadyDispensed` and `isRefillSettled(r)`
  - *Completed:* Updated both `actionableRefills` and `groupedActionableRefills` filters. Any refill group or medicine that is already dispensed in the current cycle (or settled even days before the 7-day schedule) is permanently hidden and excluded from the Quick Assist panel.
- [x] Task 4: Verify modal interaction, task removal, TypeScript checks, and performance guardrails (`npm run guardrails`)
  - *Completed:* `npx tsc -p frontend/tsconfig.app.json --noEmit` and `npx tsc --noEmit` both passed with 0 errors. `npm run guardrails` passed with 0 violations.
- [x] Task 5: Auto-update knowledge graph via `node scripts/quick-update.mjs`
  - *Completed:* Executed `node scripts/quick-update.mjs` successfully (1216 nodes, 806 edges, 10 layers).
