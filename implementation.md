# Implementation Plan - Optimized POS & Purchases Fast Keyboard Billing Workflow

## 1. Overview & Requirements
- **Problem**:
  1. Pressing Tab in POS rows focused the Batch button, opening the "Switch Batch" modal unexpectedly.
  2. Selecting a medicine always focused Strip Qty, forcing an extra keystroke to reach Loose Tablets for tablet counter sales.
  3. Selecting a liquid medicine (which defaults to Qty 1) stopped at Qty instead of advancing to the next item.
  4. Dropdown search suggestions had minor cleanup lag on blur/Tab, causing dropdowns to flash or reopen.
  5. In Purchases search, pressing Tab when highlight index was `-1` didn't auto-pick the top result.
- **Goals**:
  1. Skip Batch button in Tab order (`tabIndex={-1}`) to eliminate accidental batch popups during keyboard billing.
  2. Auto-select highlighted or first match on both `Enter` and `Tab` in dropdowns.
  3. For solid medicines allowing loose sales: jump focus directly to `Loose Tablets Qty` (`#row-loose-input-${index}`).
  4. For liquid / single-unit medicines: set Qty = 1 and jump focus directly to the Next Medicine row (`focusCartMedicineInput()`).
  5. In `row-loose-input`: pressing `Enter` or `Tab` advances directly to the Next Medicine row.
  6. In Purchases `medicine_name`: pressing `Tab` auto-selects the highlighted or top search result.

---

## 2. Technical Strategy & File Changes

### A. POS Table Row (`frontend/src/pages/POS/index.tsx`)
1. **Batch Button `tabIndex={-1}`**:
   - Add `tabIndex={-1}` to `<button id="row-batch-btn-${cart.indexOf(item)}" ...>`.
   - Result: Keyboard Tab jumps from Medicine Search straight to Qty / Loose without activating the batch selector.
2. **Post-Medicine Selection Routing (`fetchDetailsAndChangeRowMedicine`)**:
   - Check medicine characteristics via `resolveAllowLooseSale` and `isLiquidOrSingleUnitForm`:
     - If liquid/single-unit: focus `focusCartMedicineInput()` directly (skipping Qty/Loose since Qty defaults to 1).
     - If loose sales allowed: focus `#row-loose-input-${index}` with `input.select()`.
     - Otherwise (full-pack only): focus `#row-qty-input-${index}` with `input.select()`.
3. **Synchronous Search Cleanup**:
   - In `row-med-input`: when selecting via `Enter` or `Tab`, synchronously reset `activeRowSearchIndex(null)`, `rowSearchTerm('')`, `rowSearchResults([])`, and `rowSearchHighlightIndex(-1)`.
4. **Loose Qty Enter/Tab Navigation**:
   - In `row-loose-input` `onKeyDown`: `Enter` and `Tab` (without Shift) advance directly to `focusCartMedicineInput()`.

### B. Purchases Search (`frontend/src/pages/Purchases/index.tsx`)
1. In `medicine_name` input `onKeyDown`:
   - On `Tab` (without Shift): if `searchHighlightIndex >= 0 && searchHighlightIndex < searchResults.length`, select that item; else if `searchResults.length > 0`, select `searchResults[0]`.

---

## 3. Verification Plan
1. **TypeScript & Guardrails Check**:
   - Run `npm run guardrails` to ensure clean compilation (`tsc --noEmit`) and 0 speed/lint violations.
2. **Knowledge Graph Update**:
   - Run `node scripts/quick-update.mjs`.
3. **Documentation Update**:
   - Update `frontend/AGENTS.md` to reflect the updated keyboard flow contract.

---

## Completed Tasks Log
- [x] Task 1: Update POS Batch Button, Medicine Selection, and Post-Select Focus Routing
  - Added `tabIndex={-1}` to `<button id="row-batch-input-${cart.indexOf(item)}">` so Tab/Enter skips batch selection and prevents accidental batch modal popups.
  - Implemented smart post-selection focus routing in `addToCart` and `fetchDetailsAndChangeRowMedicine`:
    - Liquids / single-unit forms (`resolveAllowLooseSale === 0` / liquid form): default Qty = 1, jump directly to Next Medicine row.
    - Solid medicines with loose sales allowed (`resolveAllowLooseSale === 1`): jump directly to Loose Tablets input (`#row-loose-input-${index}`).
    - Solid medicines full-pack only: focus Strip Qty (`#row-qty-input-${index}`).
  - Added Tab navigation for non-empty rows without active search to advance directly to Loose/Qty.
- [x] Task 2: Align Purchases Search Dropdown Tab Selection
  - In `frontend/src/pages/Purchases/index.tsx`, updated `Tab` keydown handler to select `searchResults[searchHighlightIndex >= 0 ? searchHighlightIndex : 0]` when search suggestions are visible.
- [x] Task 3: Update AGENTS.md Contracts
  - Updated `frontend/AGENTS.md` under "Sequential Enter-Key Column Hopping Contract (MANDATORY & LOCKED)" to lock the batch tabIndex skip, liquid auto-skip, and loose tablet direct focus routing.
- [x] Task 4: Run Guardrails & Update Knowledge Graph
  - Ran `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) passed with 0 errors, 0 speed violations.
  - Ran `node scripts/quick-update.mjs`: Knowledge graph synchronized (1,269 nodes, 809 edges).
