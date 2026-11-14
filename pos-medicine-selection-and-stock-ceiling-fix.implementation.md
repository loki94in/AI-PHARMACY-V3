# POS Medicine Selection & Physical Stock Ceiling Fix — Implementation Plan

> **File**: `pos-medicine-selection-and-stock-ceiling-fix.implementation.md`  
> **Created**: 2026-11-14  
> **Target Subsystem**: `frontend/src/pages/POS/index.tsx`, `frontend/src/utils/posBatchAllocator.ts`, `POS.md`, `SMALL_BUG_FIX_PLAN.md`  
> **Governing Standards**: Root `AGENTS.md`, `POS.md`, `APP_PAGES_FLOW_CONTRACT.md`, `AGENT_BUG_FIX_RULEBOOK.md`

---

## 1. Problem Statement & Root Cause

1. **Selection Lock / Inability to Click Added Medicine**:
   When a medicine in the cart has reached its available physical stock ceiling, selecting it or clicking it in the row search dropdown (`rowSearchResults`) or top search results triggered an error toast and exited (`return;`), completely blocking the click. The user could neither select the item nor see which row it was in.

2. **Accidental Duplicate Rows & Exceeding Physical Stock**:
   - `changeRowMedicine` (used when typing into inline table rows like the trailing empty row) lacked `existingIndex` deduplication. If a medicine already existed in Row 0, typing it into Row 1 created a duplicate row with `qty = 1` even when total store inventory was only 1 unit.
   - `addToCart` (top search bar) unconditionally applied `newQty = (existingItem.qty || 0) + incQty` (where `incQty = 1` for non-loose items), incrementing the quantity by +1 pack upon selection even when no additional physical stock existed.
   - Loose-sale initialization defaulted `qty = 0, looseQty = 0`, causing `getRemainingSellableUnits` to calculate `0` committed units, which made the system believe 100% of physical stock was still uncommitted.

---

## 2. Proposed Architecture & Surgical Changes

1. **Top Search (`addToCart`) Deduplication & Focus Routing**:
   - When an item already exists in the cart (`existingIndex !== -1`):
     - Calculate remaining uncommitted units for that medicine.
     - If remaining units <= 0: Do NOT increment quantity! Instead, smoothly shift focus to the existing row (`routePosMedicineFocus(existingIndex, isLoose)`), scroll to it, and display an informative toast: `"${medName} is already in cart (Row ${existingIndex + 1}) — all available stock is allocated"`.
     - If remaining units > 0: Check whether `incQty` fits within remaining units before incrementing. If adding 1 full pack exceeds remaining units, do not force `+1`; instead focus the existing row so the cashier can adjust loose/pack quantity manually.

2. **In-Row Search (`changeRowMedicine`) Deduplication**:
   - In `changeRowMedicine` and `fetchDetailsAndChangeRowMedicine`:
     - Check if `med` (matching `medicine_id` or normalized name) is already present in another cart row (`otherIndex !== -1 && otherIndex !== targetIndex`).
     - If already present in another row:
       - Prevent creating a duplicate row!
       - If `targetIndex` was an empty row, preserve it as an empty row.
       - Smoothly route focus to `otherIndex` (`routePosMedicineFocus(otherIndex, isLoose)`).
       - Notify the cashier: `"${medName} is already in cart (Row ${otherIndex + 1})"`.

3. **Dropdown Click/Keyboard Selection Flow (`renderMedicineItem` & `onMouseDown`/`onKeyDown`)**:
   - If `remainingUnits <= 0`:
     - Check if the item already exists in the cart (`existingIndex !== -1`).
     - If it exists in the cart, **do not block the click**!
     - Instead, navigate/focus the existing row, dismiss the dropdown, and notify that all stock is allocated to that row.
     - If the item is not in the cart at all (truly 0 physical stock in store), keep the warning `"${item.medicine_name} is currently out of stock!"`.

4. **Human-in-the-Loop Safeguard (Rule 6)**:
   - Provide clear, non-blocking feedback with row indices so the cashier has full manual control to approve, modify, delete, or switch batches on the existing row without accidental over-billing.

---

## 3. Implementation Tasks

- [x] **Task 1**: Update `frontend/src/pages/POS/index.tsx` to add deduplication to `changeRowMedicine` and `fetchDetailsAndChangeRowMedicine`.
  - Completed: Verified medicine identity against all existing cart rows; if already present in another row, prevents duplicate creation, dismisses dropdown, alerts cashier with row index, and dispatches focus to the existing row.
- [x] **Task 2**: Update `addToCart` in `frontend/src/pages/POS/index.tsx` to stop blind `+1` auto-incrementing when existing item has no remaining stock, routing focus to the existing row instead.
  - Completed: Evaluated `remainingUnits` before incrementing `qty`. If remaining units <= 0 or requested full pack exceeds remaining units, shifts focus to the existing row without incrementing or violating physical stock.
- [x] **Task 3**: Update the dropdown click and Enter key handlers in both top search and row search to navigate to the existing cart row when remaining units are exhausted instead of aborting the action.
  - Completed: Replaced hard-exit `return;` blocks with smooth existing-row navigation (`routePosMedicineFocus(existingIdx, isLoose)`), retained in-stock items in row search annotated with `Stock: 0 (In Cart)`.
- [x] **Task 4**: Verify unit tests (`tests/posBatchAllocator.test.ts`, `tests/posSearchFilter.test.ts`), run `npm run guardrails`, run frontend build, and verify zero regression.
  - Completed: All 8 unit tests passed cleanly in Jest; `npm run guardrails` passed (exit 0); frontend built production bundle in 46.90s with zero errors.
- [x] **Task 5**: Update `POS.md`, `SMALL_BUG_FIX_PLAN.md`, and run `node scripts/quick-update.mjs`.
  - Completed: Added Section 2.D to `POS.md`, added `[Fixed] P1-154` to `SMALL_BUG_FIX_PLAN.md`, and executed knowledge graph quick-update script.

---

## 4. Execution Log & Verification

1. `npm test -- tests/posBatchAllocator.test.ts tests/posSearchFilter.test.ts`: Passed (8/8 tests).
2. `npm run guardrails`: Passed (tsc --noEmit clean, exit 0).
3. `npm run build --prefix frontend`: Passed (`tsc -b && vite build` completed in 46.90s).
4. `node scripts/quick-update.mjs`: Synchronized knowledge graph, `PROJECT_AUDIT.md`, and metadata.
