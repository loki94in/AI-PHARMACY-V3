# Current Implementation Plan: Permanent Elimination of Duplicate Indexes and Redundant Columns

**Plan File:** `DUPLICATE_INDEXING_AND_REDUNDANT_COLUMN_ELIMINATION_PLAN.md`  
**Status:** Completed & Verified (Zero-Bugs Gate Passed)

## Plan Overview
Permanently dropped 9 duplicate database indexes from SQLite and `src/database.ts`, consolidated `customers.preferred_language` into `language`, and consolidated `special_orders.product` into `medicine_name` across all 22+ pages, routes, and workers with zero bypasses.

## Tasks & Resume Log
- [x] **Task 1: Duplicate Index Deletion (`src/database.ts` & DB)**
  - Dropped 9 duplicate indexes from SQLite (`idx_automation_notifications_type_status`, `idx_expiry_reviews_status`, `idx_msm_activity`, `idx_sales_invoices_date_status`, `idx_sales_invoices_customer_status`, `idx_customers_name`, `idx_medicines_name`, `idx_medicines_generic_name`, `idx_medicines_api_ref`).
  - Removed duplicate DDL creation statements in `src/database.ts`.
  - Added boot auto-heal `autoHealDuplicateIndexesAndRedundantColumns(db)` across all startup pathways.
  - Verified 0 duplicate indexes remain via `deep_index_audit`.

- [x] **Task 2: `customers.preferred_language` Elimination & Consolidation**
  - Migrated values into `customers.language`.
  - Dropped column `preferred_language` natively from `customers` table.
  - Cleaned all callers in routes, workers, and types to use `customers.language`.

- [x] **Task 3: `special_orders.product` Elimination & Consolidation**
  - Backfilled `special_orders.medicine_name` from `product`.
  - Dropped column `product` natively from `special_orders` table.
  - Cleaned all frontend UI pages (`WebsiteOrders`, `Dispatch`, `OrderModifyModal`) to eliminate fallback struggles (`order.medicine_name || order.product`).
  - Updated all INSERT/SELECT queries across `orders.ts`, `enquiries.ts`, `customerPortal.ts`, `websiteOrders.ts`, `crm.ts`, and `refills.ts` to use `medicine_name`.

- [x] **Task 4: Zero-Bugs Gate & Verification**
  - TypeScript compilation: PASSED (`tsc --noEmit`, 0 errors).
  - Jest test suites: PASSED (8/8 tests).
  - Performance guardrails: PASSED (`npm run guardrails`, 0 violations).
  - Auto-Knowledge Graph: Updated (1,454 nodes, 881 edges).
