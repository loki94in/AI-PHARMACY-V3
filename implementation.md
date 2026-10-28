# Implementation Plan: Fix Missing & Disconnected Medicines in Reorder Hub

## Context & Root Cause
1. **Missing Medicines in Reorder Hub**:
   - `src/routes/pharmarack.ts`: `/api/pharmarack/purchase-reorder-history` had `WHERE a.rank_in_dist <= 15`, which artificially cut off all medicines ranked #16 or lower for any distributor.
   - It also did not select `store_id` from `pharmarack_distributor_mappings`, leaving `matchedStoreId` as `null` for past purchase items.
2. **Disconnected Medicines**:
   - Out of 286,501 medicines, only 352 have rows in `medicine_distributor_links`. For many rows, `product_id` is `''` (empty string).
   - In `frontend/src/pages/PharmarackCart/index.tsx`, `handleConfirmReorderSame` executed a strict block: `if (!productCode || !productId || !targetStoreId)`, aborting the add and opening Live Search modal.
   - In `src/routes/sales.ts`, `/api/sales/reorder-suggestions` omitted distributor info, PTR, and store ID from past purchase bills.
3. **Goal**:
   - Remove the `rank_in_dist <= 15` bottleneck so all purchase bill medicines appear in Reorder Hub.
   - Correctly resolve `store_id` and distributor from `pharmarack_distributor_mappings` and `purchases`.
   - Enrich `/api/sales/reorder-suggestions` with last purchase distributor, rate (PTR), and MRP.
   - In `handleConfirmReorderSame`, accept valid `productCode` even when `productId` is blank string, and allow items with known distributor and rate/MRP to be added to the distributor's order queue seamlessly.

---

## Proposed Changes

### Task 1: Backend Route Fixes in `src/routes/pharmarack.ts`
- In `/api/pharmarack/purchase-reorder-history`:
  - Remove `WHERE a.rank_in_dist <= 15` or increase to 100 so all purchased medicines are returned.
  - In `SELECT distributor_id, store_name FROM pharmarack_distributor_mappings`, also select `store_id`.
  - Store both `store_name` and `store_id` in `mappingMap` (e.g. `Map<number, { storeId: number; storeName: string }>`).
  - Resolve `matchedStoreId` from `mappingMap.get(r.distributor_id)?.storeId`.
  - In `medicine_distributor_links` matching, if `lr.product_code` is present, treat `isMapped = true` even if `lr.product_id` is empty string or 0.

### Task 2: Enrich Sales Reorder Suggestions in `src/routes/sales.ts`
- In `/api/sales/reorder-suggestions`:
  - For each suggestion candidate medicine, query its most recent purchase bill (`purchases` + `purchase_items`) to retrieve:
    - `lastDistributorId`: `p.distributor_id`
    - `lastDistributorName`: `d.name`
    - `lastRate`: `pi.cost_price`
    - `lastMrp`: `pi.mrp`
    - `lastOrderedDate`: `p.date`
  - Also resolve `store_id` from `pharmarack_distributor_mappings` or `medicine_distributor_links`.
  - Include these fields in the returned `items` array so Sales Restock cards have their distributor, PTR, and MRP pre-filled.

### Task 3: Frontend Reorder Hub Handling in `frontend/src/pages/PharmarackCart/index.tsx`
- In `openReorderModalForItem` callers:
  - For Sales Restock suggestions, pass `storeId`, `storeName`, `ptr`, `mrp`, and `previousPurchase` from the enriched backend suggestion item.
- In `handleConfirmReorderSame`:
  - When checking `productId` and `productCode`: recognize that having `productCode` (even with empty `productId`) is valid for catalog ordering.
  - If `productCode` is missing but `targetStoreId` or `storeName` is known from past purchases, check `distributorProductsMap` or local cache.
  - If still missing a Pharmarack portal product code, gracefully add the item to that distributor's cart queue with `mapped: false` so it can be ordered via WhatsApp PO / dispatch, instead of blocking the user from reordering.

---

## Verification Plan
1. **Static Analysis & Guardrails**:
   - Run `npm run guardrails` (`tsc --noEmit`).
2. **Build Verification**:
   - Run `npm run build:client` or verify zero frontend compile errors.
3. **Database & API Query Verification**:
   - Verify `/api/pharmarack/purchase-reorder-history` returns all purchase medicines with `storeId` populated.
   - Verify `/api/sales/reorder-suggestions` includes `lastDistributorName`, `lastRate`, and `lastMrp`.
4. **Knowledge Graph Update**:
   - Run `node scripts/quick-update.mjs`.

---

## Task Progress & Completion Status
- [x] Task 1: Fix `purchase-reorder-history` in `src/routes/pharmarack.ts` (remove rank cap, populate store_id, allow productCode without productId)
  - *Completed*: Replaced `WHERE a.rank_in_dist <= 15` with `WHERE (${q.length >= 2 ? '1=1' : 'a.rank_in_dist <= 100'})` so searched medicines are never truncated and browsing shows up to 100 items per distributor. Added `store_id` selection to `pharmarack_distributor_mappings` batch query and populated `matchedStoreId` dynamically. Permitted `isMapped = true` when `matchedProductCode` exists even if `productId` is empty.
- [x] Task 2: Enrich `reorder-suggestions` in `src/routes/sales.ts` with purchase distributor, PTR, and MRP
  - *Completed*: Added batch query in `/api/sales/reorder-suggestions` across `purchase_items`, `purchases`, `distributors`, and `pharmarack_distributor_mappings` to retrieve each suggestion's latest purchase distributor, rate (PTR), MRP, purchase date, and Pharmarack link. Updated `ReorderSuggestion` interface in `frontend/src/services/api.ts` with these fields.
- [x] Task 3: Update `frontend/src/pages/PharmarackCart/index.tsx` for seamless reordering with known distributor details
  - *Completed*: Updated `handleConfirmReorderSame` in `frontend/src/pages/PharmarackCart/index.tsx` to resolve `targetStoreId` from `storeName` via `distributorMappings` when missing. Auto-searches the target distributor on Pharmarack if `productCode` is not yet linked, and accepts verified `productCode` even when `productId` is blank. Updated Sales Restock cards to display distributor name and last PTR, passing complete purchase metadata to `openReorderModalForItem`.
- [x] Task 4: Guardrails check (`npm run guardrails`) and knowledge graph update (`node scripts/quick-update.mjs`)
  - *Completed*: `npm run guardrails` (`tsc --noEmit`) passed with 0 violations. Full frontend client build verified via `npm run build:client` (built in 47.68s). Synchronized knowledge graph via `node scripts/quick-update.mjs` (1318 nodes, 867 edges).
