# Implementation Plan: QA Refill WhatsApp Exact Medicine Synchronization

## 1. Goal
Ensure that WhatsApp collection reminders and refill reminders sent from Quick Assist or automated endpoints contain **only** the medicines that are actionable/selected in Quick Assist (e.g. the 3 medicines due/in-cart for Sunita Pawar), and **never** inadvertently bundle or list unneeded, non-selected, or distant-future prescriptions that happen to belong to the same patient.

---

## 2. Root Cause Summary
1. **Frontend Call Missing Medicine IDs:**
   In `frontend/src/components/QuickAssistSidebar.tsx`, the action buttons `Mark Ready` (line 2061) and `Re-Send Reminder` (line 2104) called `handleMarkRefillGroupReady(group)` without passing `selectedIds`.
2. **Backend Query Over-Fetching:**
   In `src/routes/refills.ts` (`POST /refills/patient/:phone/mark-ready`), when `refill_ids` was undefined, the query had no ID filter and fetched ALL active prescriptions across the entire patient history (`WHERE is_active = 1 AND status NOT IN ('completed', 'canceled')`), ignoring next due dates or what was in QA.
3. **Companion Bundling in Reminder Routes:**
   In `POST /refills/:id/send-reminder` and `POST /refills/send-reminder-now`, companion queries pulled in every active prescription regardless of due date.

---

## 3. Surgical Execution Steps

### Step 1: Update Frontend (`QuickAssistSidebar.tsx`)
- Default `targetIds` in `handleMarkRefillGroupReady` to `group.medicines.map(m => m.id)` when `selectedIds` is not provided.
- Explicitly pass `group.medicines.map(m => m.id)` in both line 2061 and line 2104.

### Step 2: Update Backend (`src/routes/refills.ts`)
- In `POST /patient/:phone/mark-ready`:
  - When `targetRefillIds` is passed, strictly filter by `pr.id IN (...)`.
  - When `targetRefillIds` is not passed (defensive fallback), constrain to actionable refills (due within 7 days, currently in cart, or already marked ready).
- In companion refill queries (`/:id/send-reminder` and `/send-reminder-now`):
  - Constrain companion queries to actionable/due within 7 days or in-cart items to prevent future medicines from leaking into messages.

### Step 3: Verification & Guardrails
- Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
- Verify `tsc --noEmit`.
- Run `node scripts/quick-update.mjs` to keep knowledge graph up to date.
- Update `SMALL_BUG_FIX_PLAN.md`.

---

## 4. Completed Tasks Log
- [x] Task 1: Create implementation plan file.
- [x] Task 2: Implement frontend fix in `QuickAssistSidebar.tsx`.
  - Defaulted `targetIds` to `group.medicines.map(m => m.id)` in `handleMarkRefillGroupReady`.
  - Explicitly passed `group.medicines.map(m => m.id)` to `handleMarkRefillGroupReady` in both `Mark Ready` and `Re-Send Reminder` buttons.
- [x] Task 3: Implement backend query constraints in `src/routes/refills.ts`.
  - Enforced that fallback queries in `/mark-ready` and `/notify-booked` only match actionable items (due within 7 days, in cart, or ready).
  - Restricted companion auto-bundling in `/:id/send` and `/send-reminder-now` to current cycle / due within 7 days.
- [x] Task 4: Run guardrails and update knowledge graph.
  - `npm run guardrails` passed (exit 0, `tsc --noEmit` clean, 0 violations).
  - `node scripts/quick-update.mjs` executed successfully.
- [x] Task 5: Document fix in `SMALL_BUG_FIX_PLAN.md`.
  - Added entry `[Fixed] P2-83`.
