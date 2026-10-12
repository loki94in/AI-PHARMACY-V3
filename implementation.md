# Implementation Plan: Distributor-Scoped Deduplicated Order Intelligence, Auto-Linking, & Cross-Platform Sent Orders Sync

## 1. Context & User Objectives
- **Distributor-Scoped Isolation**: Product codes and IDs on Pharmarack are distributor-scoped. Distributor A and Distributor B may have colliding product IDs or codes for completely different drugs. The app anchors all items strictly to `(store_id, product_code, product_id)`.
- **Price Fluctuation Tolerance**: Changes in PTR (rate) or MRP for the same `(store_id, product_code)` update the existing record rather than generating duplicate items.
- **Deduplicated Last 300 Medicines per Distributor**: For any selected distributor, provides up to 300 unique, deduplicated medicines from historical orders and cart additions.
- **Zero Manual Linking in Suggestions / Shortfalls**: When a distributor hits a minimum order threshold (MOQ/MOV), suggestions pull **strictly** from that distributor's own verified medicines. Clicking "Add" directly calls the live cart API with `storeId`, `productCode`, and `productId` in 1 click without ever opening a manual linking modal.
- **External Orders Sync & Sent Orders Page Visibility**: External orders placed on `retailers.pharmarack.com` or the Pharmarack mobile app are synced into the **Sent Orders** view (with order numbers, items, and dates) and automatically ingested into the distributor's known product list.

---

## 2. Architecture & Implementation Highlights

### Step 1: Database Schema Extension (`src/database.ts`)
- Created table `pharmarack_distributor_products`:
  ```sql
  CREATE TABLE IF NOT EXISTS pharmarack_distributor_products (
    store_id INTEGER NOT NULL,
    product_code TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    packaging TEXT,
    company TEXT,
    ptr REAL DEFAULT 0,
    mrp REAL DEFAULT 0,
    last_ordered_at INTEGER,
    last_order_date TEXT,
    source TEXT DEFAULT 'order',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (store_id, product_code)
  );
  CREATE INDEX IF NOT EXISTS idx_pharmarack_dist_prod_store ON pharmarack_distributor_products(store_id, last_ordered_at DESC);
  ```
- Added schema creation and migration backfill from existing `medicine_distributor_links` across both `ensureSchema` and `ensureRefillCartLinkSchema`.

### Step 2: Distributor Products Ingestion & Dedicated 300-Item API (`src/routes/pharmarack.ts`)
- Added `upsertDistributorProducts(items: any[], defaultStoreId?: number, defaultStoreName?: string, source?: string)` helper:
  - Deduplicates by composite key `(store_id, product_code)`.
  - Updates `ptr`, `mrp`, `last_ordered_at`, and `updated_at` on conflict.
- Hooked into:
  - `loadLiveCartCore()`: Auto-ingests live cart items into `pharmarack_distributor_products`.
  - `autoSaveMedicineDistributorLinks()`: Ingests cart items and cross-references them with local medicines table.
- Added endpoint `GET /api/pharmarack/distributor-medicines/:storeId`:
  - Returns up to 300 deduplicated products for `storeId` ordered by `last_ordered_at DESC`.

### Step 3: External Order Sync Ingestion & 30-Day Historical Sync (`src/services/pharmarackOrderSyncService.ts`)
- In `fillOrderLines` / `syncPharmarackOrders`:
  - Ingests external order lines directly into `pharmarack_distributor_products` and `pharmarack_placed_orders`.
  - Stores real `order_no` and distributor details.
- Added `syncHistoricalPharmarackOrders(days: number)` to retrieve the past 30 days of orders from Pharmarack `DisplayOrders` on demand.
- Exposed `POST /api/pharmarack/sync-historical-orders`.

### Step 4: Sent Orders Unification (`src/routes/pharmarack.ts`)
- Updated `GET /api/pharmarack/sent-orders/dates`:
  - Returns distinct union of dates from `pharmarack_placed_orders` and `pharmarack_synced_orders`.
- Updated `GET /api/pharmarack/sent-orders?date=...`:
  - Merges in-app orders and synced external orders with accurate order numbers, line items, and provenance tags (`pharmarack_sync` vs `pharmarack_placed_orders`).

### Step 5: Frontend Shortfall & Distributor Suggestions (`frontend/src/pages/PharmarackCart/index.tsx`)
- Updated `getDistributorShortfallFillers`:
  - Filters candidate medicines strictly to those that have verified `storeId`, `productCode`, and `productId`.
  - Zero unmapped or guessed suggestions.
  - 1-click addition directly calls `handleReorderDirect` with verified distributor credentials.
- Updated Sent Orders tab:
  - Displays "Sync Pharmarack" button to trigger external order synchronization on demand.
  - Renders external and in-app orders seamlessly with `Pharmarack Web/App` and `In-App Sent` badges, order numbers, line items, and quantities.
- Auto-loads distributor products (`distributorProductsMap[storeId]`) for all cart distributors.

### Step 6: Verification & Guardrails
- Backend `npx tsc --noEmit`: 0 errors.
- Frontend `npx tsc --noEmit`: 0 errors.
- `npm run guardrails`: 0 violations (`PASS — no guardrail violations. Speed architecture intact.`).
- Auto-knowledge graph: `node scripts/quick-update.mjs` ran cleanly.

---

## 3. Tasks & Implementation Checklist

- [x] Task 1: Add `pharmarack_distributor_products` schema in `src/database.ts` with auto-migration and backfill.
- [x] Task 2: Implement `upsertDistributorProducts` and `GET /api/pharmarack/distributor-medicines/:storeId` in `src/routes/pharmarack.ts`.
- [x] Task 3: Enhance `src/services/pharmarackOrderSyncService.ts` for external order ingestion and historical 30-day sync.
- [x] Task 4: Unify `GET /api/pharmarack/sent-orders` and `/sent-orders/dates` in `src/routes/pharmarack.ts`.
- [x] Task 5: Update `frontend/src/pages/PharmarackCart/index.tsx` for 1-click verified shortfall top-up and external sent orders display.
- [x] Task 6: Run verification tests, TypeScript check, guardrails check, and knowledge graph update.

---

## 4. Completed Tasks & Progress Report

### What Was Completed & How
1. **Schema & Deduplication Engine**:
   - `src/database.ts`: Built table `pharmarack_distributor_products` with composite primary key `(store_id, product_code)` and index `(store_id, last_ordered_at DESC)`. Backfilled existing records safely on initialization.
2. **Auto-Learning Pipeline**:
   - `src/routes/pharmarack.ts`: Created `upsertDistributorProducts` handling `ON CONFLICT(store_id, product_code) DO UPDATE SET ptr = excluded.ptr, mrp = excluded.mrp...`. Every live cart fetch (`loadLiveCartCore`) and order log automatically registers products.
   - `src/utils/orderNameMatcher.ts`: Exported `getCoreMedicineTokens` for matching without brand/packaging noise.
3. **Cross-Platform External Order Sync**:
   - `src/services/pharmarackOrderSyncService.ts`: Added `syncHistoricalPharmarackOrders(days)` and line parser `fillOrderLines` which populates lines, updates `pharmarack_placed_orders` with the real `order_no`, and feeds `pharmarack_distributor_products`.
   - `src/routes/pharmarack.ts`: Added endpoints `/api/pharmarack/distributor-medicines/:storeId` and `/api/pharmarack/sync-historical-orders`. Unified `/api/pharmarack/sent-orders` and `/sent-orders/dates`.
4. **Front-End Shortfall Top-up & Sent Orders View**:
   - `frontend/src/services/api.ts`: Added `getDistributorMedicines` and `syncHistoricalOrders`.
   - `frontend/src/pages/PharmarackCart/index.tsx`: 
     - Replaced manual linking modals in shortfall fillers with direct 1-click addition (`handleReorderDirect`).
     - Gated shortfall suggestions so only verified products for that distributor appear.
     - Added "Sync Pharmarack" button to Sent Orders tab with spinning state and feedback toasts.
     - Tagged orders with `Pharmarack Web/App` or `In-App Sent` badges.
5. **Quality Verification**:
   - Full TypeScript checks passed cleanly with 0 compiler errors.
   - Performance guardrails passed with 0 violations.
   - Updated knowledge graph via `node scripts/quick-update.mjs`.
