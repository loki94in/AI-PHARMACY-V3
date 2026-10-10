# POS Fast-Billing Keyboard Flow — Implementation Plan

## Goal
Optimize the POS keyboard-first checkout workflow for high-speed counter billing:
1. **Default Focus on Mount/Reset**: Direct the initial cursor to the first medicine search row (`row-med-input-0` via `focusCartMedicineInput()`) instead of `patient-name-input`.
2. **Liquid / Suspension Fast-Advance**: For Liquid, Syrup, Suspension, Drops, Injections, and Single-unit products (`isLiquidOrSingleUnitForm`), automatically default Qty to 1, Loose to 0, and immediately jump to Next Medicine without stopping on Qty or Loose.
3. **Tab / Cap Direct to Loose**: For Solid Oral products (Tablets, Capsules, Strips, or loose-enabled medicines), default Qty to 0 and focus directly on the **LOOSE** input (`row-loose-input-X`).
4. **Fluid Bidirectional Navigation**:
   - From **LOOSE**: `ArrowLeft` or `Shift+Tab` moves back to **Strip QTY**. `Enter` or `Tab` moves forward to **Next Medicine**.
   - From **QTY**: `ArrowRight`, `Enter`, or `Tab` moves forward to **LOOSE**.

---

## Architectural & Data Flow

```text
[POS Page Mount / New Bill]
         │
         ▼
[focusCartMedicineInput()] ──► Cursor is immediately in row-med-input-0
         │
         ▼
[Cashier selects Medicine]
         │
         ├───► Is Liquid / Suspension / Single Unit?
         │         ├─► Set Qty = 1, Loose = 0
         │         └─► Jump directly to Next Medicine (row-med-input-X+1)
         │
         └───► Is Tablet / Capsule / Loose-Enabled?
                   ├─► Set Qty = 0, Loose = 0
                   ├─► Jump directly to LOOSE input (row-loose-input-X)
                   │
                   ├───► Cashier enters Loose Count (e.g. 4)
                   │         └─► Hit [Enter] or [Tab] ──► Jump to Next Medicine
                   │
                   └───► Cashier wants Full Strip / Pack
                             └─► Hit [ArrowLeft] or [Shift+Tab] ──► Move to Strip QTY
                                       └─► Enter Qty (e.g. 1)
                                       └─► Hit [Enter] or [Tab] ──► Move to Loose
```

---

## Detailed Step-by-Step Plan

### Step 1: Default Mount & Reset Focus
- Modify `frontend/src/pages/POS/index.tsx`:
  - In the mount `useEffect` (lines 1163–1173), replace the `patient-name-input` focus with `focusCartMedicineInput()`.
  - Retain `Ctrl+1` and `Shift+Tab` shortcuts to jump back to Patient Name / Phone anytime needed.

### Step 2: Medicine Selection & Routing in `fetchDetailsAndChangeRowMedicine` & `addToCart`
- In `fetchDetailsAndChangeRowMedicine`:
  - Detect liquid form using `isLiquidOrSingleUnitForm(med.medicine_name || med.name, med.packaging)` or `resolveAllowLooseSale(med) === 0`.
  - If Liquid/Suspension: set default Qty = 1, default Loose = 0, and call `focusCartMedicineInput()`.
  - If Tab/Cap/Loose-enabled: set default Qty = 0, default Loose = 0, and focus `row-loose-input-${index}` with `.select()`.
- In `addToCart`:
  - Apply the matching logic so both top search bar add and row dropdown select follow the identical speed rules.

### Step 3: Keydown Handling in `row-qty-input`
- In `row-qty-input` `onKeyDown`:
  - When `e.key === 'Enter'` or (`e.key === 'Tab'` && `!e.shiftKey`):
    - If `!looseInput.disabled && resolveAllowLooseSale(item)`: focus `row-loose-input-${index}` and select.
    - Else: focus `focusCartMedicineInput()`.
  - When `e.key === 'ArrowRight'`:
    - If loose input is available: move focus into `row-loose-input-${index}` and select.

### Step 4: Keydown Handling in `row-loose-input`
- In `row-loose-input` `onKeyDown`:
  - When `e.key === 'ArrowLeft'` or (`e.key === 'Tab'` && `e.shiftKey`):
    - Prevent default and focus `row-qty-input-${index}` with select.
  - When `e.key === 'Enter'` or (`e.key === 'Tab'` && `!e.shiftKey`):
    - Prevent default and focus `focusCartMedicineInput()` (jump to next medicine).

### Step 5: Verification & Safety Guardrails
- Run `npm run guardrails` (which executes `tsc --noEmit` and performance checks).
- Run `node scripts/quick-update.mjs` to keep the Auto-Knowledge Graph synchronized.

---

## Tasks & Progress Tracking

- [x] Task 1: Update Default POS Mount Focus to Cart Medicine Input
- [x] Task 2: Implement Liquid Auto-Advance & Tab/Cap Loose-First in Selection Handlers
- [x] Task 3: Implement Bidirectional Keyboard Navigation in QTY and LOOSE Fields
- [x] Task 4: Run Guardrails & Update Knowledge Graph

---

## Completed Tasks Summary

- **Task 1: Default POS Mount Focus Updated**:
  - In `frontend/src/pages/POS/index.tsx`, the mount `useEffect` was updated to call `focusCartMedicineInput()` instead of focusing `patient-name-input`.
  - On page load or new sale reset, the cursor lands directly inside `row-med-input-0` (the first cart row's medicine search box), allowing cashiers to begin typing medicine names immediately.
  - Retained `Ctrl+1` and `Shift+Tab` backward navigation to jump to Patient Name/Phone anytime needed.

- **Task 2: Liquid Auto-Advance & Tab/Cap Loose-First Handlers**:
  - In `changeRowMedicine`, `fetchDetailsAndChangeRowMedicine`, and `addToCart`:
    - Evaluated `isLiquidOrSingleUnitForm(name, packaging)` and `resolveAllowLooseSale(item) === 0`.
    - **Liquids / Suspensions / Single-Unit Bottles**: Automatically sets `qty = 1, loose = 0` and immediately calls `focusCartMedicineInput()` (jumps to next medicine row with 0-second delay).
    - **Solid Oral (Tablets / Capsules / Loose-Enabled)**: Sets initial `qty = 0, loose = 0` and sets focus directly into `row-loose-input-${index}` with `.select()`.

- **Task 3: Bidirectional Keyboard Navigation Between QTY and LOOSE**:
  - In `row-loose-input`:
    - Added `ArrowLeft` and `Shift+Tab` handling to move cursor backward into `row-qty-input-${index}` with `.select()`.
    - Pressing `Enter` or `Tab` (without Shift) cleanly calls `focusCartMedicineInput()`, advancing the cashier to the next medicine row.
  - In `row-qty-input`:
    - Added `ArrowRight`, `Enter`, and `Tab` handling to advance into `row-loose-input-${index}` when loose is enabled.
    - If loose is not enabled or for single-unit items, `Enter` and `Tab` advance to `focusCartMedicineInput()`.
    - Fixed `Shift+Tab` to correctly target `row-med-input-${curIdx}`.

- **Task 4: Guardrails & Knowledge Graph Verification**:
  - Ran `npm run guardrails` (`tsc --noEmit` and performance guardrails scanner) with exit code `0` (clean compilation, zero violations, speed architecture intact).
  - Executed `node scripts/quick-update.mjs` to synchronize the Auto-Knowledge Graph (1173 nodes, 782 edges, 10 layers).
