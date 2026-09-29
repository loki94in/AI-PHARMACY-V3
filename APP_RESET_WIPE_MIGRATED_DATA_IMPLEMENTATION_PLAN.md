# Implementation Plan: Total Factory Reset & Migrated Data Wipe (Preserve Master Database Only)

## 1. Context & User Decision
The user chose: **Total Factory Wipe — Wipe store profile (store name, GSTIN, address) too, so everything is wiped back to zero except the Master Medicines catalog.**

When the user triggers the reset feature:
1. **Completely wipe all migrated and operational data across the entire application**:
   - **Sales & Billing**: All sales invoices (`sales_invoices`), bill items (`sale_items`), bill edit history (`sales_bill_edit_history`), held bills (`held_bills`), credit notes (`credit_notes`), sales returns (`returns`, `return_items`), active POS tabs.
   - **Purchases & Suppliers**: All purchases (`purchases`), purchase items (`purchase_items`), purchase orders (`purchase_orders`, `purchase_order_items`), B2B invoices (`b2b_invoices`, `b2b_invoice_items`), distributor catalogs (`distributor_catalog`, `distributor_medicine_aliases`).
   - **Inventory & Stock**: All inventory batches (`inventory_master` - 38,000+ batches wiped!), stock ledgers (`stock_ledger`), precalculated metrics (`precalculated_stock_metrics`), expiry reviews, reservations, and reorder snoozes.
   - **CRM & Patients**: All customers (`customers`), contacts (`contacts`), patient refills (`patient_refills`), call tasks (`patient_call_tasks`), customer portal accounts, OTPs, sessions.
   - **Doctors & Distributors**: All doctors (`doctors`), distributors (`distributors`), payment records (`distributor_payments`, `distributor_payment_details`), reminders, learning profiles.
   - **Quick Assist & Special Orders**: All special orders (`special_orders`), WhatsApp medicine requests (`wa_medicine_requests`), shortage requests.
   - **Reports & Audits**: All action logs (`action_logs`), compliance logs, crash logs, device connection logs, session logs, generated PDF reports, export files.
   - **Prescriptions & OCR**: All prescription scans (`prescription_scans`, `prescription_scan_items`), OCR audit queue, OCR corrections.
   - **Dispatch & Delivery**: All dispatch orders (`dispatch_orders`), delivery personnel (`delivery_boys`).
   - **Migration Data & Staging**: All migration projects (`migration_projects`), audit logs, conflicts, errors, snapshots, templates, staged purchases/sales/reviews, legacy ID mappings (`legacy_id_map`), staging DB files (`staging.db`, `staging.db-wal`, `staging.db-shm`), and uploaded source folders (`MIGRATION SAMPEL/`, `temp_migration/`, `archived_migrations/`).
   - **WhatsApp Session & Auth**: Shut down WhatsApp client, release browser handles, and purge `.wwebjs_auth/`, `.wwebjs_cache/`, chat logs, message queues, and sent registers.
   - **Pharmarack Token & Profiles**: Shut down Chrome processes, purge `data/pharmarack_profile/`, all `pharmarack_profile_temp_*/` profiles, placed orders, carts, and cached distributor mappings.
   - **Store Profile & Settings**: Clean store profile (`store_settings`, `settings`, `app_settings` reset to clean defaults), clearing previous store name, address, GSTIN, phone, and tokens.
   - **SQLite Auto-Increment Sequences**: `DELETE FROM sqlite_sequence WHERE name != 'medicines'`.
2. **Preserve ONLY the Master Medicines Database**:
   - The master catalog of 286,210+ medicines in `medicines` table is preserved.
   - All transactional stock fields on master medicines (`total_stock`, `total_loose_stock`, `rack`, `last_purchase_ptr`, `last_distributor_name`, `last_purchase_date`, `lowest_purchase_ptr`, `lowest_distributor_name`) are reset to `0` or `NULL`.
   - Any scratch/migrated medicine rows from previous migrations (`source IN ('migration', 'pg_migration')`) are purged.
   - Master reference lookup tables (`api_substances`, `medicine_reference`, `substitutes`, `app_license`) are preserved.
3. **Frontend & In-Memory Reset**:
   - `inventoryCache.invalidate()`, `searchCache.clear()`.
   - Browser `localStorage.clear()` and `sessionStorage.clear()`.
   - React Query cache cleared (`queryClient.clear()`).
   - Hard browser reload to reset all module-level variables.

---

## 2. Root Cause Analysis of Current Reset Feature
1. **Live Data Counts Query Bug (`src/routes/utilities.ts`)**:
   - `GET /api/utilities/data-counts` queries `bills` and `purchase_bills`. In SQLite, those tables are named `sales_invoices` and `purchases`. The modal displays 0 bills and 0 purchases before reset.
2. **Current `reset-data` drops `medicines`**:
   - The existing reset drops all tables from `sqlite_master`, wiping the entire 286,210 master medicines catalog. Re-enriching from CSV requires minutes and slows the system.
3. **Inconsistent File Wipe**:
   - In standard reset, WhatsApp sessions and Pharmarack tokens were left alive on disk, causing zombie sessions and background workers to continue sending requests with obsolete IDs.

---

## 3. Implementation Status & Completed Tasks

- [x] **Task 1: Fix Live Record Counts Endpoint**
  - **File**: [`src/routes/utilities.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/utilities.ts)
  - **Completed**: Fixed table queries to target `sales_invoices` (instead of non-existent `bills`) and `purchases` (instead of `purchase_bills`). Shows live counts for medicines, inventory batches, sales invoices, purchases, and customers.

- [x] **Task 2: Refactor Reset Endpoint in Backend**
  - **File**: [`src/routes/utilities.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/utilities.ts)
  - **Completed**:
    - Selectively drops operational/transactional tables while preserving `medicines`, `medicines_fts` (full search index & triggers), `api_substances`, `medicine_reference`, `substitutes`, and `app_license`.
    - Resets all stock, loose stock, rack, and purchase history fields on `medicines` to `0` or `NULL`.
    - Purges any non-master migrated scratch rows (`source IN ('migration', 'pg_migration')`).
    - Destroys WhatsApp client and kills orphan Chrome processes to release locks.
    - Wipes `.wwebjs_auth`, `.wwebjs_cache`, `data/pharmarack_profile`, temp profiles, `staging.db`, `MIGRATION SAMPEL/`, `temp_migration/`, `reports/`, `uploads/`, and in-memory caches.
    - Resets SQLite sequences (`sqlite_sequence`) for clean IDs from 1 (preserving medicines sequence).
    - Compacts DB with `VACUUM`.

- [x] **Task 3: Update Settings Reset UI**
  - **File**: [`frontend/src/pages/Settings/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Settings/index.tsx)
  - **Completed**:
    - Updated modal descriptions and headers to clearly communicate that the Master Medicines catalog is preserved while all migrated data, sales, purchases, inventory, CRM, reports, migration files, and tokens are wiped clean.
    - Live Database Snapshot displays `Medicines (Kept)` in emerald badge alongside accurate counts.
    - Full `localStorage.clear()` and `sessionStorage.clear()` on execution followed by automatic reload.

- [x] **Task 4: Verification & Guardrails**
  - **Completed**:
    - Backend TypeScript compilation (`tsc --noEmit`): PASSED (0 errors).
    - Frontend TypeScript compilation and production build (`tsc -b && vite build`): PASSED (0 errors).
    - Performance Guardrails scanner (`npm run guardrails`): PASSED (0 violations).

- [x] **Task 5: Update Knowledge Graph**
  - **Completed**: Executed `node scripts/quick-update.mjs` (0 errors, 1165 nodes, 546 edges synchronized).

- [x] **Task 6: Silent Reset & Race Condition Elimination**
  - **Completed**:
    - Wrapped [`shouldRouteToBusiness()`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/whatsappClient.ts) in a `try ... catch` with fallback to prevent transient `SQLITE_ERROR: no such table: app_settings` in QR check polling.
    - Added [`stopMasterEnrichment()`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/masterMedicinesSeedService.ts) to gracefully halt background CSV processing before reset, preventing `SQLITE_BUSY: database is locked`.
    - Preserved `app_settings` and `update_checks` structure in SQLite while wiping values (`DELETE FROM`) on factory reset, eliminating `no such table` race conditions completely.
