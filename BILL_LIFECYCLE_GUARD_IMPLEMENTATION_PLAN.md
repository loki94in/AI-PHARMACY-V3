# Bill Lifecycle Guard — Implementation Plan

**Feature:** Empty-bill prevention + Old Financial Year bill protection + Stock Restoration paths

---

## Business Rules Being Implemented

1. **Block last item removal** — Cannot remove the last item from a bill in edit mode; user must delete the whole bill
2. **Old FY gate** — Bills dated before April 1 of the current FY are "old FY" and cannot be directly deleted; instead user chooses between Create Return or Stock Adjustment
3. **Two restoration paths for old bills:**
   - **Create Return / Credit Note** — pre-fill Customer Return page with old bill items (stock auto-restores via existing CR flow)
   - **Stock Adjustment** — navigate to Inventory page with old bill reference pre-filled in adjustment

---

## Current FY Boundary Helper

- April 1 of current year, or April 1 of previous year if current month < April.
- Example: today = Sep 2026 -> current FY start = April 1 2026 -> bills before April 1 2026 = old FY.

---

## Files to Modify

### 1. `frontend/src/pages/Sells/index.tsx`
- **Task 1:** Block last-item removal in `removeItem()` — if `editItems.length <= 1`, show toast and abort.
- **Task 2:** Add `isOldFinancialYear()` helper function.
- **Task 3:** Add `oldFyBillConfirm` state and intercept logic in `handleDelete()`.
- **Task 4:** Add `OldFyActionModal` UI inline in JSX.
- **Task 5:** `handleCreateReturn()` — navigate to `/customer-returns` with `state: { prefillInvoiceNo: bill.invoice_no }`.
- **Task 6:** `handleStockAdjustment()` — navigate to `/inventory` with `state: { adjustmentRef, adjustmentNote }`.
- **Task 7:** Wrap delete button in viewInvoice modal with old FY gate.

### 2. `frontend/src/pages/CustomerReturn/index.tsx`
- **Task 8:** On mount, check `location.state?.prefillInvoiceNo` -> auto-fill and trigger invoice search.

### 3. `frontend/src/pages/Inventory/index.tsx`
- **Task 9:** On mount, check `location.state?.adjustmentRef` -> show banner and pre-fill adjustment reason.

---

## Task Progress Tracker

- [x] TASK 1 — Block last-item removal in removeItem()
- [x] TASK 2 — isOldFinancialYear() helper
- [x] TASK 3 — oldFyBillConfirm state + handleDelete intercept
- [x] TASK 4 — OldFyActionModal UI
- [x] TASK 5 — handleCreateReturn()
- [x] TASK 6 — handleStockAdjustment()
- [x] TASK 7 — Wrap viewInvoice delete with old FY gate
- [x] TASK 8 — CustomerReturn prefill from location.state
- [x] TASK 9 — Inventory adjustment ref banner
- [x] TASK 10 — TypeScript compile check (0 errors)
- [x] TASK 11 — Guardrails PASS (0 violations)
- [x] TASK 12 — Knowledge graph update (1163 nodes, 546 edges)

---

## Completed Tasks

**All 12 tasks completed on 2026-09-29.**

| Task | File | How |  
|---|---|---|
| Block last-item removal | `Sells/index.tsx` `removeItem()` | Guard: if `editItems.length <= 1`, show error toast and abort |
| FY helper | `Sells/index.tsx` | `isOldFinancialYear(dateStr)` — compares bill date vs April 1 of current FY |
| Delete intercept | `Sells/index.tsx` `handleDelete()` | If bill is old FY, sets `oldFyBillConfirm` state instead of deleting |
| Old FY Action Modal | `Sells/index.tsx` JSX | Portal modal with amber header, two action buttons (Return / Adjustment) |
| handleCreateReturn | `Sells/index.tsx` | Navigates to `/customer-returns` with `state.prefillInvoiceNo` |
| handleStockAdjustment | `Sells/index.tsx` | Navigates to `/inventory` with `state.adjustmentRef` + `state.adjustmentNote` |
| List-row delete gate | `Sells/index.tsx` | Passes `inv` to `handleDelete(inv.id, inv)` |
| viewInvoice modal gate | `Sells/index.tsx` | Passes `viewInvoice` to `handleDelete(viewInvoice.id, viewInvoice)` |
| CustomerReturn prefill | `CustomerReturn/index.tsx` | `useEffect` on mount: reads `location.state.prefillInvoiceNo`, sets input, triggers search |
| Inventory banner | `Inventory/index.tsx` | Sky-colored info banner shows bill ref and instructions when `location.state.adjustmentRef` is set |
