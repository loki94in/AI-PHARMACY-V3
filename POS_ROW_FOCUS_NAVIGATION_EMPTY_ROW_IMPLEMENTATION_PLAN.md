# POS Row Focus Navigation to Empty Row Implementation Plan

## Overview
When adding a medicine in the POS cart (such as Clavam 625, where loose sale is permitted, or any medicine where the cashier tabs across the row), keyboard navigation through the columns (Strip Qty $\rightarrow$ Loose Qty $\rightarrow$ Discount $\rightarrow$ MRP) previously became stuck on the Discount and MRP fields upon pressing `Enter` or `Tab`, failing to advance focus to the trailing empty row's `Search medicine...` input.

In contrast, non-loose medicines immediately advance to the next empty row upon selection.

This plan restores uninterrupted keyboard navigation across all medicine rows, ensuring that hitting `Enter` or `Tab` at the end of a row smoothly advances focus directly to the next medicine search input without manual clicking.

---

## Root Cause Analysis
1. In `frontend/src/pages/POS/index.tsx`, `focusCartMedicineInput` contains an active guard at line 2276:
   ```ts
   (active.id?.startsWith('row-') && !active.id.startsWith('row-med-input-'))
   ```
   When `force` is `false` (default), this guard treats the cashier's focus inside `row-disc-input` or `row-mrp-input` as "user in another control" and exits early (`return true; // Respect user's active focus`).
2. Lines 6891, 6911, 6943, and 6955 in `index.tsx` invoked `focusCartMedicineInput()` without `force = true`.
3. Consequently, pressing `Enter` on Discount, or `Enter`/`Tab` on MRP, triggered this early-return guard and froze focus in the current input instead of hopping to the next empty row.

---

## Surgical Implementation Steps

### Step 1: Unblock and Connect Discount & MRP Forward Navigation
- Update `row-disc-input` `onKeyDown`:
  - On `Enter`: Directly focus `row-med-input-${curIdx + 1}` or empty row placeholder `input[placeholder="Search medicine..."]` with fallback `focusCartMedicineInput(true)`.
  - On `Tab` (forward): If MRP input is disabled or not found, advance to `row-med-input-${curIdx + 1}` or empty row with `focusCartMedicineInput(true)`.
- Update `row-mrp-input` `onKeyDown`:
  - On `Enter`: Directly focus `row-med-input-${curIdx + 1}` or empty row placeholder `input[placeholder="Search medicine..."]` with fallback `focusCartMedicineInput(true)`.
  - On `Tab` (forward): Directly focus `row-med-input-${curIdx + 1}` or empty row placeholder `input[placeholder="Search medicine..."]` with fallback `focusCartMedicineInput(true)`.

### Step 2: Unblock Quantity and Loose Quantity Fallback Paths
- In `row-qty-input` on `Tab` when loose and discount are disabled: pass `focusCartMedicineInput(true)` or hop to next row.
- In `row-loose-input` on `Tab` when discount and MRP are disabled: pass `focusCartMedicineInput(true)` or hop to next row.
- In `handlePosRowInputKeyDown`: Support `ArrowRight` at end of MRP input to seamlessly advance to the next row's medicine search input.

### Step 3: Verification & Guardrails
- Run `npm run guardrails` to verify no performance or lint regressions.
- Run `node scripts/quick-update.mjs` to update the auto-knowledge graph.
- Test keyboard navigation flow:
  1. Add Clavam 625 $\rightarrow$ focus lands on Loose Qty.
  2. Press `Tab` $\rightarrow$ focus lands on Discount.
  3. Press `Tab` $\rightarrow$ focus lands on MRP.
  4. Press `Enter` or `Tab` $\rightarrow$ focus immediately lands on the next empty row (`Search medicine...`).
  5. Add non-loose medicine $\rightarrow$ verify direct hop to next empty row continues working without regression.

---

## Tasks & Completion Status
- [x] Task 1: Update Discount and MRP `onKeyDown` handlers in `frontend/src/pages/POS/index.tsx`
  - *Completed by*: Updating `row-disc-input` and `row-mrp-input` `onKeyDown` handlers to target `row-med-input-${curIdx + 1}` or empty row placeholder `input[placeholder="Search medicine..."]` and falling back to `focusCartMedicineInput(true)`.
- [x] Task 2: Update ArrowRight and Tab fallbacks in `handlePosRowInputKeyDown` and Qty/Loose handlers
  - *Completed by*: Updating `handlePosRowInputKeyDown` for `mrp` to allow `ArrowRight` to transition to next row, and updating `row-qty-input` and `row-loose-input` Tab handlers to advance with `focusCartMedicineInput(true)` if downstream fields are disabled.
- [x] Task 3: Verify TypeScript compilation and run `npm run guardrails`
  - *Completed by*: `npm run guardrails` passed clean with 0 violations and verified TypeScript compilation (`tsc --noEmit`).
- [x] Task 4: Run `node scripts/quick-update.mjs`
  - *Completed by*: Knowledge graph updated across 1508 nodes and 892 edges without errors.
- [x] Task 5: Final documentation and verification check
  - *Completed by*: Created implementation plan, verified diff, and documented exact focus transitions.

