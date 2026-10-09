# Implementation Plan: Overdue Metric Alignment & Per-Medicine Priority Enforcement

## Problem Analysis & Re-Check Summary

### 1. Overdue Count Discrepancy (Top Card vs. Tab List)
* **Root Cause**:
  * In `frontend/src/pages/CRM/RefillsSection.tsx` (line 1104), `overdueCount` is computed by a raw date comparison:
    `data.filter(p => new Date(p.next_refill_date) < new Date()).length`
  * In `RefillsSection.tsx` (lines 1086-1088), the `Overdue` tab filter excludes patients who are already settled:
    `if ((filterTab === 'overdue' || filterTab === 'lead') && isPatientRefillsSettled(...)) return false;`
  * In the active database (`app.dev.db`), `Mr. MOKASHI` has `next_refill_date = '2026-10-06'` (past), but his refill is already ordered in Live Cart (`cart_store_name: NITIN AGENCY / AJAY PHARMA`) and notified (`reminder_status: 'SENT'`).
  * Because he is settled, the tab list hides him (showing `0` / empty), while the top card still counts him as `1 Overdue`.

### 2. Per-Medicine Distributor Priority Overridden by Global Priority
* **Root Cause**:
  * In `MedicineLinkModal.tsx` and `RefillsSection.tsx`, users can arrange distributors for a specific medicine (`#1, #2, #3` via up/down arrows or the `⭐ Priority #1` button). This saves ordered rows into `medicine_distributor_links` with `pick_order = 0, 1, 2...`.
  * However, in `src/services/refillCartService.ts` (lines 262-267), the backend immediately runs `orderByPriority(..., await loadPriorityMap())`.
  * `orderByPriority` prioritizes global rankings from `distributor_priority` over `pick_order`. If two distributors exist in the global list, the global ranking always wins, completely bypassing the user's custom per-medicine choice.
* **Desired Behavior**:
  * For a given medicine, the pharmacist's explicit `pick_order` (`#1, #2, #3`) in `medicine_distributor_links` must be the primary priority at Live Cart add time.
  * If Distributor #1 is out of stock, it automatically rotates to Distributor #2 in that medicine's exact saved order.
  * Global distributor ranking serves as the fallback/default order for unranked distributors.

---

## Proposed Changes

### Component 1: Frontend CRM Refills (`frontend/src/pages/CRM/RefillsSection.tsx`)
1. **Align `overdueCount` metric**:
   * Compute `overdueCount` by checking both `dueDate < new Date()` and `!isPatientRefillsSettled(...)`.
   * Add an optional toggle/chip in the Overdue tab (`Show Settled (N)`) so pharmacists can inspect handled overdue records on demand without cluttering the active queue.

### Component 2: Backend Cart Service (`src/services/refillCartService.ts`)
1. **Enforce Per-Medicine `pick_order` Priority**:
   * When fetching links for a refill medicine:
     `SELECT * FROM medicine_distributor_links WHERE medicine_id = ? ORDER BY pick_order, id`
   * Preserve the explicit `pick_order` saved by the pharmacist as the primary order.
   * If any linked distributor has an unranked/default `pick_order`, sort those remaining using the global priority map as secondary fallback.
   * Ensure out-of-stock rotation strictly tries `#1` -> `#2` -> `#3` in this medicine-specific order.

### Component 3: Verification & Test Suite
1. Run existing test suite `tests/refillCart.test.ts`.
2. Verify that:
   * Setting Distributor B as `#1` for Medicine X orders Distributor B first, even if Distributor A has a higher global priority.
   * Out of stock at Distributor B falls back to Distributor A.
   * Top overdue metric card matches the Overdue tab count (both show `0` when all past refills are settled).
3. Run `npm run guardrails` to guarantee 0 regressions.

---

## Human-in-the-Loop Review Contract (Rule 6)
* Pharmacists maintain full visibility:
  * The Refill modal shows live stock per linked distributor.
  * The medicine card displays the `⭐ #1 Priority` distributor with a quick dropdown to change it.
  * Pharmacists can toggle settled vs. pending overdue items at any time.

---

## Tasks & Execution Log

| Task # | Description | Status | Verification Check |
| :--- | :--- | :--- | :--- |
| **Task 1** | Synchronize `overdueCount` in `RefillsSection.tsx` with `isPatientRefillsSettled` & add handled toggle | **COMPLETED** | Top card and tab list show matching counts; handled patients viewable with toggle |
| **Task 2** | Update `refillCartService.ts` so per-medicine `pick_order` is primary priority | **COMPLETED** | Per-medicine priority (#1, #2, ...) strictly preserved at cart add time with automatic stock rotation fallback |
| **Task 3** | Verify test suite `tests/refillCart.test.ts` & `npm run guardrails` | **COMPLETED** | 25/25 tests passed (including per-medicine priority override unit test); Guardrails exit 0 (clean compilation & integrity) |
| **Task 4** | Update `scripts/quick-update.mjs` knowledge graph | **COMPLETED** | Knowledge graph refreshed (1196 files, 0 errors, 5.2s) |
