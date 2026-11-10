# POS FEFO Batch Priority & Cross-Batch Split Fix — Implementation Plan

## Problem Summary
When a medicine has multiple active batches in inventory (e.g., `CP60085` with 4 units and earlier expiry vs. `STC26334` with 15 units and later expiry), entering a requested quantity larger than the near-expiry batch (e.g., 8 units) failed to prioritize the near-expiry batch and split across rows (4 from `CP60085`, 4 from `STC26334`). Instead, it pulled all 8 units from the newer full-stock batch (`STC26334`).

## Root Causes Identified
1. **Priority-batch override on rebalance (`frontend/src/pages/POS/index.tsx`)**: `rebalanceCartMedicine`, `addToCart`, and `changeRowMedicine` unconditionally passed `priorityBatchNo` / `priorityInventoryId`, forcing whichever batch was currently on the row ahead of FEFO expiry order.
2. **Broken expiry string ranking & strip-before-expiry bias**:
   - `fefoRank` compared raw `expiry_date` strings lexicographically (`MM/YY` vs `YYYY-MM-DD`, e.g., `'05/29' < '2028-01-31'`).
   - `fefoRank` placed `Number(stripQty) > 0 ? 0 : 1` *before* expiry, causing a near-expiry batch with `0` strips and `4` loose tablets to lose to a later-expiry batch with `15` strips.
   - `allocateMedicineBatches` also applied `aHasStrips`/`aHasLoose` *before* expiry timestamp comparison, overriding FEFO whenever a batch had loose-only stock or strip-only stock.
3. **Hard uniform-MRP filter blocking cross-batch spill**: `allocateMedicineBatches` dropped all batches whose MRP differed from `fallbackItem.mrp`, preventing cross-batch splitting when a newer batch arrived with a revised MRP (or skipping the near-expiry batch if the newer batch's MRP was in `fallbackItem`).
4. **Backend compact cache ordering (`src/services/inventoryCache.ts`)**: `ORDER BY m.name ASC, im.expiry_date ASC` sorted mixed expiry formats lexicographically.

## Tasks
- [x] **Task 1**: Add canonical expiry month/timestamp helpers (`getExpiryMonthKey`, `getExpirySortTimestamp`) in `frontend/src/utils/date.ts` reusing the existing multi-format expiry parser.
  - Completed: Added `parseExpiryYearMonth`, `getExpiryMonthKey`, and `getExpirySortTimestamp` in `frontend/src/utils/date.ts`, shared with `isExpiredDate` and `expiryWarning`.
- [x] **Task 2**: Extract & fix `fefoRank` and `allocateMedicineBatches` in `frontend/src/utils/posBatchAllocator.ts` (re-exported by `frontend/src/pages/POS/index.tsx`):
  - Pure FEFO ordering (earliest expiry timestamp first; strip/loose stock as same-expiry tiebreaker only).
  - Remove the hard uniform-MRP filter so different-MRP batches allocate across separate rows with each batch's own MRP/pricing.
  - Honor `priorityBatchNo`/`priorityInventoryId` ONLY when `respectPriorityBatch` is true (invoice edit or explicit manual Switch Batch override).
  - Completed: Implemented `frontend/src/utils/posBatchAllocator.ts` and verified multi-batch loose, strip, mixed-expiry, and mixed-MRP splitting.
- [x] **Task 3**: Wire `frontend/src/pages/POS/index.tsx` (`CartRow.manualBatchSelected`, `Switch Batch` FEFO sorting + manual flag, `rebalanceCartMedicine`, `addToCart`, `changeRowMedicine`, `filterLocalInventory`) and normalize `ORDER BY` expiry in `src/services/inventoryCache.ts`.
  - Completed: Wired `posBatchAllocator.ts` into `frontend/src/pages/POS/index.tsx` and updated `src/services/inventoryCache.ts` SQL ordering.
- [x] **Task 4**: Add unit tests in `tests/posBatchAllocator.test.ts` (and register in `jest.config.js`), run Jest tests, `npm run build --prefix frontend`, `npm run guardrails`, update `SMALL_BUG_FIX_PLAN.md`, and run `node scripts/quick-update.mjs`.
  - Completed: Added `tests/posBatchAllocator.test.ts` (registered in `jest.config.js`), verified Jest tests pass, guardrails pass, and updated `SMALL_BUG_FIX_PLAN.md`.
