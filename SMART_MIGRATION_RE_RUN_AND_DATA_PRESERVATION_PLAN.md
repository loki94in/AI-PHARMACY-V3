# Smart Migration Re-Run & Organic Data Preservation Implementation Plan

> **Tracking ID**: `TASK-SMART-MIGRATION-RE-RUN-001`  
> **Target**: Enable users to safely re-run updated migration files (e.g. edited CSVs fixing incorrect bills or stock) using Smart Upsert & Replace without appending duplicate line items or stock, while strictly preserving organic shop data (`patient_refills`, `special_orders`, counter POS sales).  
> **Status**: COMPLETED

---

## 1. Problem Statement & Root Cause

1. **Duplicate Item Accumulation on Re-runs**:
   - In `src/worker/migrationWorker.ts`, when importing sales, purchases, or returns:
     - If an invoice/purchase/return number already existed in `staging.db` from a prior migration, the code reused the header but failed to update modified amounts or dates.
     - The code unconditionally ran `INSERT INTO sale_items` (or `purchase_items` / `return_items`), appending duplicate rows to existing bills.
2. **Stock Multiplier on Re-runs**:
   - For purchases, every duplicate purchase item added to `purchase_items` triggered `upsertInventoryFromPurchase` or affected `rebuildMigrationInventoryStock`, causing stock to double or triple on re-runs.
3. **Organic Data Preservation Risk**:
   - Organic shop data (`patient_refills`, `special_orders`, customers, POS transactions) is created in the live app.
   - If a user tried to revert bad migration data using snapshot restore, the entire database reverted, wiping newly created refills and special orders.
   - With Smart Upsert & Replace, re-running an updated file updates only the target migration transactions while leaving all organic shop data untouched.

---

## 2. Tasks & Action Plan

- [x] **Task 1: Add Idempotent Schema Support in `src/database.ts`**
  - Added `source TEXT DEFAULT 'pos'` and `is_migrated INTEGER DEFAULT 0` to `sales_invoices`.
  - Added `source TEXT DEFAULT 'manual'` and `is_migrated INTEGER DEFAULT 0` to `purchases` and `returns`.
  - Added `ensureMultiPharmacyAndSnapshotSchema` to both fast-boot and DDL paths for immediate schema completeness.
  - Verified zero Query Compilation & Constraint Resolution Failure errors (Rule 9).

- [x] **Task 2: Implement Smart Upsert & Replace for Sales in `src/worker/migrationWorker.ts`**
  - Added `clearedSalesInvoices = new Set<number>()` in `parseAndImportCSV`.
  - When an invoice exists:
    - Updates invoice header with latest `total_amount`, `discount`, `subtotal`, `date`, `customer_id`, `doctor_id`, `cgst_value`, `sgst_value`, `source = 'migration'`, and `is_migrated = 1`.
    - On the first row encountered for that invoice in the run, runs `DELETE FROM sale_items WHERE invoice_id = invoice.id`.
    - Inserts clean, non-duplicated `sale_items`.
  - Applied to both standalone `sales` module and `combined` module.

- [x] **Task 3: Implement Smart Upsert & Replace for Purchases in `src/worker/migrationWorker.ts`**
  - Added `clearedPurchases = new Set<number>()` in `parseAndImportCSV`.
  - When a purchase exists:
    - Updates purchase header with latest `distributor_id`, `date`, `total_amount`, `source = 'migration'`, and `is_migrated = 1`.
    - On the first row encountered for that purchase in the run, runs `DELETE FROM purchase_items WHERE purchase_id = purchase.id`.
    - Inserts clean, non-duplicated `purchase_items`.
  - Prevents duplicate items and ensures `rebuildMigrationInventoryStock` calculates accurate stock.
  - Applied to both standalone `purchases` module and `combined` module.

- [x] **Task 4: Implement Smart Upsert & Replace for Returns in `src/worker/migrationWorker.ts`**
  - Added `clearedReturns = new Set<number>()` in `parseAndImportCSV`.
  - Updates return header and deletes previous items on first encounter (`DELETE FROM return_items WHERE return_id = retRecord.id`).
  - Inserts clean, non-duplicated `return_items`.

- [x] **Task 5: Human-in-the-Loop & Organic Data Protection Audit**
  - Verified that `patient_refills`, `special_orders`, live POS bills, and custom customer profiles are never touched, deleted, or cleared by migration runs.
  - In `inventory` module, existing batches match on `(medicine_id, batch_no)` and update batch attributes instead of creating redundant conflicts or duplicate stock rows.

- [x] **Task 6: Verification, Guardrails & Knowledge Graph Update**
  - Ran `npm run guardrails` -> PASS (0 violations, clean TypeScript compilation, schema integrity OK).
  - Ran `node scripts/quick-update.mjs` -> Updated 1188 nodes, 574 edges in 3.6s.

---

## 3. Execution Log
- **2026-10-02 20:54**: Created implementation plan.
- **2026-10-02 20:55**: Added idempotent schema columns (`source`, `is_migrated`) to `sales_invoices`, `purchases`, and `returns` in `src/database.ts`.
- **2026-10-02 20:56**: Implemented `clearedSalesInvoices`, `clearedPurchases`, and `clearedReturns` in `src/worker/migrationWorker.ts`.
- **2026-10-02 20:56**: Implemented Smart Upsert for inventory batches in `src/worker/migrationWorker.ts`.
- **2026-10-02 20:57**: Implemented Smart Upsert & line-item replacement for Sales, Purchases, and Returns in `src/worker/migrationWorker.ts`.
- **2026-10-02 20:58**: Audited organic data preservation (`patient_refills`, `special_orders`, live POS counter sales).
- **2026-10-02 20:59**: Ran `npm run guardrails` (passed, 0 violations).
- **2026-10-02 20:59**: Synced knowledge graph with `node scripts/quick-update.mjs`.
