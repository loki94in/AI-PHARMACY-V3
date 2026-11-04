# Implementation Plan: Permanent Elimination of Duplicate Indexes and Redundant Columns

**Status:** Completed & Verified (Zero-Bugs Gate Passed)  
**Scope:** Complete elimination of 9 duplicate database indexes and consolidation of dual-columns (`customers.preferred_language`, `special_orders.product`) across all routes, workers, and pages.

---

## 1. Objectives & Safety Gates
1. [x] Permanently DROP the 9 redundant/duplicate indexes from `data/app.dev.db` and eliminate their redundant DDL definitions from `src/database.ts`.
2. [x] Consolidate `customers.preferred_language` into `customers.language` and drop `preferred_language`.
3. [x] Consolidate `special_orders.product` into `special_orders.medicine_name` and drop `product`.
4. [x] Update all route handlers, service workers, and frontend pages referencing the dropped columns.
5. [x] Verify TypeScript compilation (`tsc --noEmit`), Jest test suites, and performance guardrails (`npm run guardrails`).
6. [x] Update knowledge graph (`node scripts/quick-update.mjs`).

---

## 2. Tasks Status & Resume Log

- [x] **Task 1: Duplicate Index Deletion (`src/database.ts` & DB)**
  - Dropped 9 duplicate indexes from live SQLite database:
    - `idx_automation_notifications_type_status`
    - `idx_expiry_reviews_status`
    - `idx_msm_activity`
    - `idx_sales_invoices_date_status`
    - `idx_sales_invoices_customer_status`
    - `idx_customers_name`
    - `idx_medicines_name`
    - `idx_medicines_generic_name`
    - `idx_medicines_api_ref`
  - Removed duplicate `CREATE INDEX` lines from `src/database.ts` (lines 1305, 2289, 2292, 2398, 2565-2567, 3432, 3745).
  - Added on-boot auto-heal `autoHealDuplicateIndexesAndRedundantColumns(db)` in `src/database.ts` across all 3 boot pathways.
  - Verified with `scripts/deep_index_audit.js`: exactly 0 duplicate indexes remain.

- [x] **Task 2: `customers.preferred_language` Elimination**
  - Migrated existing values into `customers.language`:
    ```sql
    UPDATE customers SET language = preferred_language WHERE preferred_language IS NOT NULL AND preferred_language != '';
    ```
  - Dropped `preferred_language` natively from SQLite table `customers`.
  - Removed `preferred_language` from `CREATE TABLE IF NOT EXISTS customers` and `ensureColumns`.
  - Updated callers in `src/routes/orders.ts`, `src/services/cloudCatalogSyncService.ts`, `src/services/collectionReminderWorker.ts`, `src/services/refillCartService.ts`, and `frontend/src/types/api.ts`.
  - Verified with `PRAGMA table_info(customers)`: `preferred_language: false`, `language: true`.

- [x] **Task 3: `special_orders.product` Elimination**
  - Backfilled missing values into `special_orders.medicine_name`:
    ```sql
    UPDATE special_orders SET medicine_name = product WHERE (medicine_name IS NULL OR medicine_name = '') AND product IS NOT NULL AND product != '';
    ```
  - Dropped `product` column natively from SQLite table `special_orders`.
  - Removed `product TEXT` from `CREATE TABLE IF NOT EXISTS special_orders`.
  - Updated all `INSERT INTO special_orders` in `src/routes/orders.ts`, `src/routes/enquiries.ts`, `src/routes/customerPortal.ts`, and `src/routes/websiteOrders.ts` to insert into `medicine_name` without `product`.
  - Updated queries in `src/routes/crm.ts` and `src/routes/refills.ts` to use `medicine_name`.
  - Verified with `PRAGMA table_info(special_orders)`: `product: false`, `medicine_name: true`.

- [x] **Task 4: Zero-Bugs Gate & Verification**
  - TypeScript compilation: `tsc -p tsconfig.json --noEmit` $\rightarrow$ PASSED (0 errors).
  - Jest test suites: `tests/distributorDispatchAllDirectory.test.ts`, `tests/directOrderDispatchFlow.test.ts` $\rightarrow$ PASSED (8/8).
  - Performance guardrails: `npm run guardrails` $\rightarrow$ PASSED (0 violations, speed architecture & DB integrity OK).
  - Knowledge graph: `node scripts/quick-update.mjs` synchronized.
