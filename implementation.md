# Implementation Plan: Reorder Hub Rate, Scheme, and MRP Storage & Propagation Fix

## Problem Statement & Root Cause Analysis
In the Reorder Hub, medicines were losing their **rate (PTR / cost price)**, **scheme (free goods / discount scheme)**, and **MRP** across both local storage, synchronization, and UI display due to several gaps across the pipeline:

1. **Frontend Payload Drop on Reorder Actions**:
   - In `handleConfirmReorderSame` (`frontend/src/pages/PharmarackCart/index.tsx`), the `scheme` property was absent from the item payload sent to `api.addPharmarackCart(payload)`.
   - In `handleReorderDirect` (used for 1-click shortfall filler additions in distributor cards), `scheme` was omitted from the add-to-cart payload.
   - In optimistic cart state update (`mergeItemIntoDistributors`), `scheme` was omitted, resetting the live line's scheme badge in memory.

2. **Backend Persistence Gaps**:
   - In `autoSaveMedicineDistributorLinks` (`src/routes/pharmarack.ts`): While `medicine_distributor_links` contains columns `rate` and `mrp`, the `INSERT` and `ON CONFLICT DO UPDATE` queries never included `rate`, `mrp`, or `scheme`.
   - In `src/database.ts`: `medicine_distributor_links` lacked a `scheme TEXT` column.
   - In `addItemsToPharmarackCart` (`src/routes/pharmarack.ts`): Property enrichment only ran if `productCode` or `productName` was missing (`if (!item.productCode || !item.productName)`). Items with codes but missing rates, MRPs, or schemes were never enriched from `pharmarack_distributor_products`, `distributor_catalog`, `purchase_items`, or `medicines`.

3. **Reorder Hub Data Sources Missing Scheme / Price Fallbacks**:
   - `GET /api/pharmarack/purchase-reorder-history`: Did not query `free_qty` or `scheme_per` from `purchase_items`, returned `{ ptr, mrp }` without fallback to `medicines` or `distributor_catalog`, and completely omitted `scheme`.
   - `GET /api/sales/reorder-suggestions`: Querying `purchase_items` did not retrieve `free_qty`, `scheme_per`, or link to `pharmarack_distributor_products.scheme`, omitting `scheme` from the suggestions payload.
   - `pharmarackOrderSyncService.ts`: `fetchOrderLines()` extracted `productName`, `qty`, `productCode`, `mrp`, `rate`, and `packaging`, but ignored `Scheme`, `scheme`, and `ProductScheme`.

4. **UI Display Omissions**:
   - In `Reorder Same Confirmation Modal`: The scheme and MRP were not displayed in the medicine details panel.
   - In Reorder Hub cards (`All Matches` and category sub-tabs):
     - Recent & Cart items in `All Matches` did not show PTR / MRP.
     - Past Purchase Bills in `All Matches` did not show PTR / MRP / Scheme.
     - Special Requests cards did not display estimated Rate, MRP, or Scheme.

---

## Changes Implemented

### 1. Database Schema (`src/database.ts`)
- Added `scheme TEXT` column to `CREATE TABLE IF NOT EXISTS medicine_distributor_links`.
- Added idempotent migration: `ALTER TABLE medicine_distributor_links ADD COLUMN scheme TEXT`.

### 2. Backend Cart & Link Persistence (`src/routes/pharmarack.ts`)
- **`autoSaveMedicineDistributorLinks`**: Persists `rate`, `mrp`, and `scheme` into `medicine_distributor_links` on both `INSERT` and `ON CONFLICT DO UPDATE`.
- **`addItemsToPharmarackCart`**:
  - Enriches missing `rate` (PTR), `mrp`, and `scheme` from `pharmarack_distributor_products`, `distributor_catalog`, `medicine_distributor_links`, `purchase_items`, and `medicines`.
- **`purchase-reorder-history` (`GET /api/pharmarack/purchase-reorder-history`)**:
  - Queries `pi.free_qty` and `pi.scheme_per` from `purchase_items`.
  - Formats scheme string (e.g., `10+1` or `10%`).
  - Fallbacks `ptr` and `mrp` to `medicine_distributor_links` or `medicines.ptr`/`mrp` if 0.
  - Returns `ptr`, `lastRate`, `mrp`, and `scheme` in all output items.
- **`reorder-recent` (`GET /api/pharmarack/reorder-recent`)**:
  - Batch-enriches missing `ptr` and `mrp` from `medicines` if 0.

### 3. Historical Order Sync (`src/services/pharmarackOrderSyncService.ts`)
- In `fetchOrderLines`: Extracts `Scheme`, `scheme`, `ProductScheme` from order detail lines and attaches `scheme` to items.

### 4. Sales Reorder Suggestions (`src/routes/sales.ts`)
- In `GET /api/sales/reorder-suggestions`:
  - Queries `free_qty` and `scheme_per` from `purchase_items`.
  - Queries `rate, mrp, scheme` from `medicine_distributor_links`.
  - Computes and returns `scheme` in each restock suggestion item.

### 5. Frontend Reorder Hub Flow (`frontend/src/pages/PharmarackCart/index.tsx`, `frontend/src/services/api.ts`)
- In `handleConfirmReorderSame`: Included `scheme: card.scheme || undefined` in `payload` and `mergeItemIntoDistributors`.
- In `handleReorderDirect`: Resolved `scheme` and included `scheme: scheme || undefined` in `payload`.
- In `openReorderModalForItem`:
  - For Special Requests: forwards `storeId`, `productCode`, `productId`, `ptr`, `mrp`, `scheme`.
  - For Sales Restock: forwards `scheme: sug.scheme`.
  - For Past Purchases: forwards `scheme: item.scheme`.
- In `Reorder Same Confirmation Modal`:
  - Visibly renders Rate (PTR), MRP, and Scheme badge (🎁 Scheme) in the product details panel.
- In Reorder Hub Cards:
  - All Matches Category 4 (Recent Orders & Cart Additions): renders PTR and MRP.
  - All Matches Category 5 (Past Purchases): renders PTR, MRP, and Scheme badge (🎁 Scheme).
  - Past Purchases sub-tab: renders Scheme badge (🎁 Scheme).
  - Special Requests cards: renders Est. Rate, MRP, and Scheme badge.
- In `frontend/src/services/api.ts`:
  - Added `scheme?: string` to `ReorderSuggestion` interface.

---

## Verification Results
1. **Compilation & Guardrails**:
   - Ran `npm run guardrails` (`tsc --noEmit` and speed architecture scanner) — **PASS** (OK, exit code 0).
2. **Knowledge Graph**:
   - Ran `node scripts/quick-update.mjs` — **PASS** (1,338 nodes, 877 edges in 4.0s).

---

## Tasks Progress & Status
- [x] Task 1: Update database schema in `src/database.ts` to ensure `scheme` column exists in `medicine_distributor_links`
  - *Completed*: Added column in table definition and idempotent `ALTER TABLE` statement.
- [x] Task 2: Update `autoSaveMedicineDistributorLinks` and `addItemsToPharmarackCart` in `src/routes/pharmarack.ts` to persist and enrich rate, scheme, and MRP
  - *Completed*: Saved `rate`, `mrp`, `scheme` into `medicine_distributor_links`; added multi-table enrichment fallback in `addItemsToPharmarackCart`.
- [x] Task 3: Update `purchase-reorder-history` and `reorder-recent` in `src/routes/pharmarack.ts` to query and return scheme and price fallbacks
  - *Completed*: Added `free_qty`, `scheme_per`, `med_ptr`, `med_mrp` to purchase query; resolved and returned `ptr`, `lastRate`, `mrp`, and `scheme`.
- [x] Task 4: Update `fetchOrderLines` in `src/services/pharmarackOrderSyncService.ts` and `src/routes/sales.ts` to extract and forward scheme
  - *Completed*: Extracted scheme keys from order lines and included scheme in sales suggestions.
- [x] Task 5: Update `frontend/src/pages/PharmarackCart/index.tsx` to forward scheme in payloads, display rate/scheme/MRP in modal and Reorder Hub cards
  - *Completed*: Forwarded scheme in add-to-cart payloads and cart cache; rendered PTR, MRP, and Scheme badges across Reorder Hub cards and confirmation modal.
- [x] Task 6: Run `npm run guardrails` and `node scripts/quick-update.mjs`
  - *Completed*: Verified clean TypeScript compilation and speed architecture compliance.
