# Implementation Plan - POS Batch Switcher & Stock Isolation Fix

## 1. Overview & Root Cause
- **Issue:** When a user adjusted/edited medicine `OFLOX 200MG TABLET`, in the POS page:
  1. Live stock displayed `14 / 9` instead of `11 / 9` because stock from `OFLOX 200MG INF` (Infusion) was merged.
  2. The Switch Batch dropdown header showed "6 AVAILABLE", but only 2 batches (`5SD0371` and `5SD0368`) were visible because the container was clamped to `max-h-48` (192px) without an obvious scrollbar or scroll indicator.
  3. Batch `5SD0368` (which is an Infusion product, MRP 100.46) was incorrectly shown inside the Tablet batch list because `api.searchMedicine` was text-based and fell back to raw mixed search results instead of strictly scoping to `medicine_id`.
  4. The desktop Electron app runs on `data/app.db`, whereas dev mode uses `data/app.dev.db`.

## 2. Implementation Steps
1. **Frontend Dropdown Ergonomics & Height (`frontend/src/pages/POS/index.tsx`)**:
   - Change `max-h-48` to `max-h-72` (288px) on the Switch Batch dropdown container.
   - Add clear scrollbar styling and a footer count indicator when items exceed visible space.
2. **Strict Medicine ID Scoping for Batch Switcher (`frontend/src/pages/POS/index.tsx`)**:
   - Filter `compactInventory` strictly by `item.medicine_id`.
   - When calling `api.searchMedicine`, strictly filter results matching `medicine_id` (or exact name if no id). Never fall back to unmatching search items.
3. **Strict Live Stock Isolation (`frontend/src/pages/POS/index.tsx`)**:
   - Prioritize `item.medicine_id` in `medMatches` so different forms/salt variants (e.g. Tablets vs Infusion) never cross-aggregate.
4. **Database Alignment**:
   - Align batch `5SD0371` on `data/app.db` with `data/app.dev.db` so the purchase edit reflects in both dev mode and packaged Electron desktop mode.
5. **Validation & Guardrails**:
   - Verify TypeScript compilation and run `npm run guardrails`.
   - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## Completed Tasks Log
- [x] Task 1: Update Batch Switcher UI in POS (height, scroll, indicator)
  - Expanded dropdown height from `max-h-48` (192px) to `max-h-72` (288px) in `frontend/src/pages/POS/index.tsx`.
  - Added `scrollbar-thin` and a dynamic footer indicator: *"Showing X batches • Scroll to see all"* when batches exceed 3.
- [x] Task 2: Implement strict `medicine_id` scoping in batch switcher & live stock
  - Updated `allocateMedicineBatches` to strictly enforce `medicineId` matching over fuzzy name matching when `medicineId > 0`.
  - Scoped `setRowBatchesList` to the row's `medicine_id` so batches from different medicine forms (e.g., Infusion vs Tablet) never mix.
  - Scoped Live Stock aggregation `medMatches` strictly to `rowMedId` when present so total stock (`11 / 9`) is 100% accurate.
- [x] Task 3: Align `app.db` records for batch `5SD0371`
  - Safely synchronized the purchase edit on `app.db` (reassigning batch `5SD0371` from `1141129` to `1141130`) so changes persist across dev mode and packaged Electron desktop mode.
- [x] Task 4: Run guardrails and update knowledge graph
  - Ran `npm run guardrails` — TypeScript compilation passed with zero violations.
  - Ran `node scripts/quick-update.mjs` — knowledge graph updated in 4.6s.
