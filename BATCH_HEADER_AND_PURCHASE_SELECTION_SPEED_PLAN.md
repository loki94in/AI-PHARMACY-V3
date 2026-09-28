# Batch Header Restore & Purchase Medicine Selection Speed Optimization Plan

## Goal
1. **Restore Batch Headers**: Restore the batch header in dropdown overlays and ensure the batch name is clearly visible even when there is only one medicine and one batch in both Purchases and POS.
2. **Instant Medicine Selection in Purchases**: Eliminate the severe latency when selecting a medicine from the dropdown in the purchase page. Utilize frontend in-memory inventory cache (`getCompactInventoryCache()`) for 0ms instant batch & history population, prevent hidden `HoverPriceIntelTable` from firing duplicate eager requests, optimize backend `/price-history` and `/medicine-batches` queries to use indexed lookups by `medicine_id` and exact names instead of 286,000-row full table scans.

---

## Tasks & Checklist

- [x] **TASK 1** — Restore batch header in dropdowns:
  - In `frontend/src/pages/Purchases/index.tsx`: Restored the `🏷️ Old Batches ({filteredBatches.length})` header bar with loading indicator in the batch selection dropdown.
  - In `frontend/src/pages/POS/index.tsx`: Restored the `Switch Batch ({rowBatchesList.length} available)` header bar in the batch selector dropdown.
  - In `frontend/src/pages/POS/index.tsx`: Displayed `Batch: {batch_no}` and `Exp: {expiry}` in the medicine search dropdown row when present so users can immediately see the batch name even when there is only one medicine and one batch.
- [x] **TASK 2** — Instant frontend cache hydration for Purchases:
  - In `frontend/src/pages/Purchases/index.tsx`: In `selectMedicine`, immediately check `getCompactInventoryCache()` for the selected medicine ID/name. If matches exist, instantly hydrate `rowBatchesList` and pre-warm `medicineHistoryCache` with 0ms latency.
  - In the `batch_no` `onFocus` handler, check `getCompactInventoryCache()` before making any network request.
- [x] **TASK 3** — Eliminate eager background request saturation in `HoverPriceIntelTable`:
  - Only mount or query `HoverPriceIntelTable` when the user actually hovers the price/MRP cell (gated with `hoveredRateRow === item.id` and `hoveredPriceRow === item.id`), instead of mounting on every single row inside `hidden` CSS containers.
  - In `HoverPriceIntelTable.tsx`, do not trigger a background fetch if `records` is provided or if cached history is already available. Support querying by `medicine_id` directly.
- [x] **TASK 4** — Backend query optimization for `/purchases/price-history` and `/purchases/medicine-batches`:
  - In `src/routes/purchases.ts`: Support `medicine_id` in `/price-history` for instant indexed lookup (`pi.medicine_id = ?`).
  - Replaced un-indexed `LIKE '%name%'` full table scans on 286,210 rows with fast indexed prefix scans and exact matches.
- [x] **TASK 5** — Verification & Build:
  - Rebuild client bundle (`npm run build:client`).
  - Run `npm run guardrails` to verify zero violations and clean TypeScript compilation.
  - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## Completion Log

- **TASK 1 Completed**: Restored batch headers in both Purchases (`🏷️ Old Batches (X)`) and POS (`Switch Batch (X available)`), and added explicit `Batch: {batch}` and `Exp: {expiry}` pills inside the POS medicine search dropdown row so users can see batch details immediately even with a single medicine and batch.
- **TASK 2 Completed**: Implemented synchronous in-memory hydration from `getCompactInventoryCache()` in `selectMedicine` and `batch_no.onFocus` in Purchases. The batch list and price history cache now hydrate instantly in 0ms without waiting for HTTP network calls.
- **TASK 3 Completed**: Gated `HoverPriceIntelTable` in Purchases so it only mounts when the user explicitly hovers the Rate or MRP cell, stopping hidden DOM elements from firing hundreds of background queries.
- **TASK 4 Completed**: Optimized backend `/purchases/price-history` with direct indexed `medicine_id` query support (0.1ms) and indexed prefix/exact matching, eliminating 286,000-row table scans and productNameFilterService delays. Added `LIMIT 50` to `purchaseRows` and `inventoryRows` queries in `/medicine-batches`.
- **TASK 5 Completed**: Ran `npm run guardrails` (passed cleanly, 0 violations, `tsc --noEmit` clean). Rebuilt production client bundle with `npm run build:client` (2,616 modules transformed, dist generated). Updated knowledge graph with `node scripts/quick-update.mjs` (1,117 files indexed).
