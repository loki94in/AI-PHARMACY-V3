# QA Direct 1-Step Add to Cart & Hide Refill ID Plan

## Goal
1. Eliminate the redundant second `Add to Cart` click in Quick Assist (QA) after the user already selected medicines and quantities in `RefillOrderModal` (`Option A`).
2. Rename Quick Assist's `Select in CRM` button to `Add to Cart`.
3. Remove/hide the internal `#<refill_id>` (`Refill ID #120`) label next to medicine names in Quick Assist so users see only the medicine name.

## Planned Edits
1. **`frontend/src/components/RefillOrderModal.tsx`**:
   - Default to direct Live Cart addition (`workflowMode = 'qa_approve'`) and remove the two-step `Continue to QA` staging branch so confirming in the modal immediately starts `startRefillCartJob(patientName, payload, { openModal: false, patientKey })` and calls `onClose()`.
   - Keep `isCycleDuplicateLocked(m)` active on already-processed items (`in_live_cart` / `ordered` / `fulfilled`) unless explicitly targeted via `initialSelectedIds`, and pre-select eligible pending items (or `initialSelectedIds` / `qaQueued`) cleanly so opening from CRM or QA never starts with 0 items selected.
   - Update header/subtitle copy (`Add to Live Cart — ${patientName}`).
2. **`frontend/src/components/QuickAssistSidebar.tsx`**:
   - Remove the `#{med.id}` and `#{m.id}` refill ID badges next to medicine names.
   - Rename `Select in CRM` → `Add to Cart` with updated tooltip, and switch `<RefillOrderModal>` to direct mode.
3. **`frontend/src/pages/CRM/RefillsSection.tsx`**:
   - Switch `<RefillOrderModal>` to direct mode and update `Confirm & Cart` (`handleConfirmRefillPatient`) to start `startRefillCartJob` directly for pending medicines instead of staging to QA.
4. **`src/services/refillCartService.ts` & `frontend/src/utils/refillSettled.ts`**:
   - Clear `qa_staged_at = NULL` alongside `qa_cart_qty = NULL` on `added` and in `recordNonAddedStatus`; tighten `isRefillQaStaged` to `m.cart_status === 'qa_queued'` so failed direct adds never remain trapped in a QA-only box.
5. **DOX & Verification**:
   - Update `src/AGENTS.md`, `frontend/AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`.
   - Run `npm test`, `npm run build`, `npm run build:client`, `npm run guardrails`, and `node scripts/quick-update.mjs`.

## Tasks & Completion Log
- [x] Task 1: Update `frontend/src/utils/refillSettled.ts` and `src/services/refillCartService.ts` (`qa_cart_qty` cleanup on `added` and non-added statuses while preserving `qa_staged_at` + `isRefillQaStaged` precision)
- [x] Task 2: Update `frontend/src/components/RefillOrderModal.tsx` (direct 1-step `Add to Cart` + duplicate lock + initial selection + auto-close)
- [x] Task 3: Update `frontend/src/components/QuickAssistSidebar.tsx` (hide `#id` badges, rename `Select in CRM` → `Add to Cart`, direct modal mode)
- [x] Task 4: Update `frontend/src/pages/CRM/RefillsSection.tsx` (direct modal mode + `Confirm & Cart` direct cart job)
- [x] Task 5: Update DOX (`src/AGENTS.md`, `frontend/AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`) and run verification gates (`tsc`, `vite build`, Jest, `npm run guardrails`, `node scripts/quick-update.mjs`)
