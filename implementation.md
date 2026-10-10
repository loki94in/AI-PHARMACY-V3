# Clean Purchases Table Header & Remove Low-Stock / History Ordering Popups — Implementation Plan

## Goal
Remove the cluttering "Order low-stock" and "Order from distributor history" buttons and modals from the Purchases page (`frontend/src/pages/Purchases/index.tsx`), ensuring:
1. The table header row contains ONLY the green `+` (Add Row) button.
2. The extra amber `<Package />` ("Order low-stock medicines") and sky blue `<BookOpen />` ("Order from this distributor's history") icon buttons in the table header `<th>` are completely removed.
3. The `LowStockPickerModal` and `DistributorHistoryPickerModal` overlays and unused state/handlers are cleanly removed from Purchases.
4. The footer minimum order warning is kept as a non-clickable status badge rather than opening the history picker modal.
5. In `OldMedicineQuickAddBox`, remove the `Order from History` button and `Fulfill →` shortcut button so it focuses solely on quick medicine search.

---

## Proposed Changes

### File: `frontend/src/pages/Purchases/index.tsx`
1. **Table Header Clean-up (lines 3814–3844)**:
   - Remove the amber `<button onClick={() => setShowLowStockPicker(true)} ...><Package size={14} /></button>`.
   - Remove the sky blue `<button onClick={() => setShowHistoryPicker(true)} ...><BookOpen size={14} /></button>`.
   - Keep strictly the single green `<button onClick={addNewItem} ...><Plus size={14} /></button>`.
2. **Remove Unused Modal Renderings & State**:
   - Remove lines 4745–4760: `<LowStockPickerModal ... />`.
   - Remove lines 4762–4839: `<DistributorHistoryPickerModal ... />`.
   - Remove state declarations `showLowStockPicker` and `showHistoryPicker`.
   - Remove unused imports: `LowStockPickerModal`, `DistributorHistoryPickerModal`, `Package`, `BookOpen` (from lucide-react if unreferenced elsewhere).
3. **Footer Minimum Order Badge (lines 4695–4706)**:
   - Convert `minOrderWarning` button into a passive informational status badge `<span>⚠️ Min order: {minOrderWarning}</span>` without opening the history modal.
4. **OldMedicineQuickAddBox Hookup (lines 3786–3805)**:
   - Remove `onOpenHistoryPicker` prop passed to `<OldMedicineQuickAddBox />`.

### File: `frontend/src/components/Purchases/OldMedicineQuickAddBox.tsx`
1. Remove `onOpenHistoryPicker` from `OldMedicineQuickAddBoxProps`.
2. Remove the right-side "Order from History" button and "Fulfill →" button from the component header.
3. Retain the fast autocomplete medicine search functionality without the history modal trigger.

---

## Verification & Guardrails
1. Run `npm run guardrails` (`tsc --noEmit` and performance scanner) to ensure 0 errors.
2. Run `npm run build:client` to confirm the frontend Vite bundle builds cleanly.
3. Run `node scripts/quick-update.mjs` to keep the Auto-Knowledge Graph synchronized.

---

## Tasks & Progress Tracking

- [x] Task 1: Clean table header in `Purchases/index.tsx` (keep only green `+` button) and remove `LowStockPickerModal` & `DistributorHistoryPickerModal`
- [x] Task 2: Simplify `OldMedicineQuickAddBox.tsx` by removing "Order from History" and "Fulfill →" buttons
- [x] Task 3: Run `npm run guardrails`, `npm run build:client`, and update knowledge graph

---

## Completed Tasks Summary

### Task 1: Table Header & Modal Cleanup in `Purchases/index.tsx`
- **Clean Table Header**: Removed the extra amber `<Package />` button ("Order low-stock medicines") and sky blue `<BookOpen />` button ("Order from this distributor's history"). The table header now contains strictly the single green `+` (Add Row) button.
- **Removed Modals & State**:
  - Removed `LowStockPickerModal` and `DistributorHistoryPickerModal` overlays and unused imports.
  - Removed `showLowStockPicker` and `showHistoryPicker` states.
  - Removed auto-prompt `useEffect` that triggered `setShowHistoryPicker(true)` when minimum order shortfalls appeared.
- **Simplified Minimum Order Footer**: Converted the clickable footer warning into a static advisory status badge (`⚠️ Min order: ...`) with no modal popups.

### Task 2: Simplified `OldMedicineQuickAddBox.tsx`
- Removed `onOpenHistoryPicker` prop from interface and component props.
- Removed the right-side "Order from History" button and "Fulfill →" shortcut button.
- Retained the fast autocomplete search input for medicines without unwanted modal popups.

### Task 3: Guardrails & Build Verification
- `npm run guardrails`: Passed clean (exit code 0; `tsc --noEmit` clean, 0 violations).
- `npm run build:client`: Passed clean (built in 51s, 0 errors).
- `node scripts/quick-update.mjs`: Knowledge Graph synchronized (1,173 nodes, 783 edges).
