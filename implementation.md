# Implementation Plan - Permanent Sequential Enter-Key Column Hopping in POS and Purchases

## 1. Overview & Problem Statement
- **Issue:** Operators require high-speed keyboard-only data entry without touching the mouse. Previously, selecting a medicine in Purchases or POS caused focus drops, conditional skipping (e.g. freezing when batch/qty were pre-filled), or inconsistent Enter-key behaviors across columns.
- **Goal:**
  1. Enforce permanent, unbreakable **Sequential Enter-Key Column Hopping** in Purchases and POS.
  2. Document the strict contract in `frontend/AGENTS.md` so future AI agents are explicitly forbidden from breaking or modifying this workflow without prior user confirmation.
  3. Ensure all fields auto-select their text upon focus (`input.select()`) for instant overwrite.

## 2. Hopping Sequences

### A. Purchases Bill Entry & Edit (`frontend/src/pages/Purchases/index.tsx`)
- `Medicine Search` ──(Enter on Dropdown Item)──> `Batch No`
- `Batch No` ──(Enter)──> `Expiry Date (MM/YY)`
- `Expiry Date` ──(Enter)──> `Rate`
- `Rate` ──(Enter)──> `MRP`
- `MRP` ──(Enter)──> `Qty`
- `Qty` ──(Enter)──> `Free Qty`
- `Free Qty` ──(Enter)──> `Next Row Medicine Search` (appends empty line if on the last row)
- Backward traversal: `Shift + Tab` smoothly steps backward in the exact reverse sequence.

### B. POS Fast Sales Billing (`frontend/src/pages/POS/index.tsx`)
- `Medicine Search` (`#medicine-search-input`) ──(Enter on Item)──> Adds to cart & jumps to Cart Row `Strip Qty`
- `Strip Qty` (`#row-qty-input-${index}`) ──(Enter)──>:
  - If loose tablet sales allowed & enabled: jumps to `Loose Qty` (`#row-loose-input-${index}`)
  - If liquid/syrup or loose disabled: jumps directly back to `#medicine-search-input` for the next medicine
- `Loose Qty` (`#row-loose-input-${index}`) ──(Enter)──> Jumps directly back to `#medicine-search-input`
- In-cart Direct Row Edit: `Row Medicine` ──(Enter)──> `Batch` ──(Enter)──> `Qty` ──(Enter)──> `Loose` ──(Enter)──> Next Search / Row.

### C. Contract Protection
- Add "Sequential Enter-Key Column Hopping Contract (MANDATORY & LOCKED)" to `frontend/AGENTS.md`. Future agents MUST NOT alter this without asking the user.

---

## 3. Implementation Steps

1. **Purchases Page (`frontend/src/pages/Purchases/index.tsx`)**:
   - Update `handleSelectMedicine` to always advance focus to `batch_no` with `el.select()`.
   - Update `handleFieldKeyDown` for each field (`medicine_name`, `batch_no`, `expiry_date`, `rate`, `mrp`, `qty`, `free_qty`) to strictly hop on `Enter`.
   - Ensure backward navigation (`Shift + Tab`) maps accurately.

2. **POS Page (`frontend/src/pages/POS/index.tsx`)**:
   - In `addToCart` / `fetchDetailsAndAddToCart`, reliably jump focus to `#row-qty-input-${targetIndex}` with `el.select()`.
   - In `#row-qty-input-${idx}` `onKeyDown`, on `Enter`: if loose enabled, go to `#row-loose-input-${idx}`, else go to `#medicine-search-input`.
   - In `#row-loose-input-${idx}` `onKeyDown`, on `Enter`: go to `#medicine-search-input`.
   - In `#row-med-input-${idx}` `onKeyDown`, on `Enter`: advance to `#row-qty-input-${idx}`.

3. **Documentation & Protection Contract**:
   - Update `frontend/AGENTS.md` and root `AGENTS.md` with the locked contract.

4. **Verification**:
   - Run `npm run guardrails` (`tsc --noEmit` and speed guardrails).
   - Run `node scripts/quick-update.mjs`.

---

## Completed Tasks Log
- [x] Task 1: Permanent Sequential Enter-Key Hopping in Purchases
  - Added resilient multi-attempt `focusRowMedicineName` and `focusRowField` with `el.select()`.
  - Updated `selectMedicine` so selecting any medicine immediately and unconditionally hops to `batch_no`.
  - Updated `medicine_name` input so pressing `Enter` on an already-linked medicine advances to `batch_no` without opening the modal.
  - Verified full sequential flow: `Medicine` -> `Batch` -> `Expiry` -> `Rate` -> `MRP` -> `Qty` -> `Free Qty` -> `Next Row Medicine Name`.
- [x] Task 2: Permanent Sequential Enter-Key Hopping in POS
  - Updated `addToCart` and `fetchDetailsAndChangeRowMedicine` to unconditionally focus `row-qty-input` with auto-select upon medicine selection.
  - Set default `incQty = 1` for newly added items so operators can instantly tap `Enter` or overwrite without backspace.
  - Updated `row-qty-input` on `Enter`: advances to `row-loose-input` (if loose sales allowed) or hops directly to `#medicine-search-input`.
  - Updated `row-loose-input` on `Enter`: hops directly back to `#medicine-search-input` for the next medicine.
  - Made `focusCartMedicineInput` resilient with fallback to `#medicine-search-input`.
- [x] Task 3: Contract Documentation in AGENTS.md
  - Added "Sequential Enter-Key Column Hopping Contract (MANDATORY & LOCKED)" to `frontend/AGENTS.md`.
  - Added reference pointer in root `AGENTS.md`.
  - Mandated that future AI agents must never modify or break this sequential hopping flow without explicit user confirmation.
- [x] Task 4: Automated Verification & Guardrails
  - Ran `npm run build:client` -> Vite and TypeScript client build passed 100%.
  - Ran `npm run guardrails` -> TypeScript compilation (`tsc --noEmit`) OK, 0 violations, speed architecture intact.
  - Ran `node scripts/quick-update.mjs` -> Updated 1,269 nodes and 809 edges in knowledge graph.
