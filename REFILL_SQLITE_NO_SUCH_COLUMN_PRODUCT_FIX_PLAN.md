# Implementation Plan: Fix "SQLITE_ERROR: no such column: product" on Refill Operations

## 1. Problem Summary & Root Cause Analysis
When a user creates, edits, or deletes a refill schedule, or edits medicines in the Refill page, the frontend displays:
`Internal server error: SQLITE_ERROR: no such column: product`
Even though the refill record is successfully created or updated in the `patient_refills` table.

### Root Cause:
1. Per `src/AGENTS.md` (contract section 309), the `product` column on `special_orders` was unified into `medicine_name TEXT` and permanently dropped via `ALTER TABLE special_orders DROP COLUMN product`.
2. Whenever a refill is created (`POST /api/refills`), updated (`PUT /api/refills/patient-medicines`, `PUT /api/refills/:id`), or deleted (`DELETE /api/refills/:id`), the route commits the refill change and synchronously calls `await checkAllRefills(db)`.
3. If the medicine is low or out of stock (or needs ordering), `checkAllRefills(db)` invokes `refillOrderReconciler.upsertForPhone(...)`.
4. `refillOrderReconciler.ts` runs:
   - Line 111: `SELECT id, status, qty FROM special_orders WHERE ... AND LOWER(TRIM(product)) = LOWER(?)`
   - Line 143: `INSERT INTO special_orders (store_id, product, requester, phone, ...)`
   Both statements reference the non-existent column `product` instead of `medicine_name`.
5. SQLite throws `SQLITE_ERROR: no such column: product`, causing the route to return HTTP 500 with that exact message.
6. A broader codebase scan revealed identical legacy queries referencing `special_orders.product` in:
   - `src/services/refillOrderReconciler.ts` (reconciliation and deduplication)
   - `src/services/shortageReminderService.ts` (trackMedicineRequest query and insert)
   - `src/services/storeSyncService.ts` (special_orders insert)
   - `src/services/whatsappIntentService.ts` (15-min deduplication query and 5 special_orders insert statements)
   - `src/services/startupSyncCoordinator.ts` (line 295 deduplication check)
   - `src/services/localAi/pharmacyToolRegistry.ts` (special_orders insert)
   - `src/routes/orders.ts` (line 1550 update statement)
   - `src/routes/websiteOrders.ts` (line 1473 update statement)
   - `src/routes/pharmarack.ts` (lines 2246 and 3846 select statements)
   - `src/routes/refills.ts` (lines 1660 and 1711 cascade delete statements)
   - `src/database.ts` (line 3174 re-adding dropped product column, lines 3486 and 4778 updating dropped product column)

---

## 2. Proposed Surgical Changes

### A. `src/services/refillOrderReconciler.ts`
- Replace `LOWER(TRIM(product))` with `LOWER(TRIM(medicine_name))` in deduplication query.
- Replace `product` with `medicine_name` in `INSERT INTO special_orders`.

### B. `src/services/shortageReminderService.ts`
- Replace `LOWER(product)` with `LOWER(medicine_name)` in `trackMedicineRequest`.
- Replace `product` with `medicine_name` in `INSERT INTO special_orders`.

### C. `src/services/storeSyncService.ts`
- Replace `product` with `medicine_name` in `INSERT INTO special_orders`.

### D. `src/services/whatsappIntentService.ts`
- Replace `(LOWER(product) = LOWER(?) OR LOWER(medicine_name) = LOWER(?))` with `LOWER(medicine_name) = LOWER(?)`.
- Remove `product` column and duplicate value from all 5 `INSERT INTO special_orders` queries (lines 1740, 4237, 4351, 4491, 5211).

### E. `src/services/startupSyncCoordinator.ts`
- Replace `(LOWER(product) = LOWER(?) OR LOWER(medicine_name) = LOWER(?))` with `LOWER(medicine_name) = LOWER(?)` on line 295.

### F. `src/services/localAi/pharmacyToolRegistry.ts`
- Remove `product` from `INSERT INTO special_orders` (line 1890).

### G. `src/routes/orders.ts` & `src/routes/websiteOrders.ts`
- In `src/routes/orders.ts`: change `SET status = ?, priority = ?, qty = ?, product = ?` to `SET status = ?, priority = ?, qty = ?, medicine_name = ?`.
- In `src/routes/websiteOrders.ts`: change `SET product = ?, medicine_name = ?` to `SET medicine_name = ?`.

### H. `src/routes/pharmarack.ts` & `src/routes/refills.ts`
- In `src/routes/pharmarack.ts`: update lines 2246 and 3846 to select `medicine_name, medicine_name AS product`.
- In `src/routes/refills.ts`: update lines 1660 and 1711 to `DELETE FROM special_orders WHERE source_refill_id = ? OR (source = 'refill' AND phone = ? AND medicine_name = ?)`.

### I. `src/database.ts`
- Remove `['special_orders', 'product', 'ALTER TABLE special_orders ADD COLUMN product TEXT']` from line 3174.
- Guard lines 3486 and 4778 with column existence checks before attempting to touch `product`.

---

## 3. Step-by-Step Execution & Verification Plan
1. Apply fixes to `src/services/refillOrderReconciler.ts`.
   - Verify: Run test script calling `refillOrderReconciler.upsertForPhone` to ensure zero SQL errors.
2. Apply fixes to `src/services/shortageReminderService.ts`, `src/services/storeSyncService.ts`, `src/services/whatsappIntentService.ts`, `src/services/startupSyncCoordinator.ts`, and `src/services/localAi/pharmacyToolRegistry.ts`.
3. Apply fixes to `src/routes/orders.ts`, `src/routes/websiteOrders.ts`, `src/routes/pharmarack.ts`, `src/routes/refills.ts`, and `src/database.ts`.
4. Compile TypeScript (`npm run build` or `npx tsc --noEmit`).
5. Run automated test suite:
   - Test refill creation, editing, deletion without any `no such column: product` errors.
   - Run performance guardrails (`npm run guardrails`).
   - Run auto-knowledge graph update (`node scripts/quick-update.mjs`).
6. Human-in-the-Loop review & approval.

---

## 4. Completed Tasks Log
- [x] Task 1: Fix `refillOrderReconciler.ts` query & insert statements
  - Replaced legacy `product` column references with `medicine_name` in deduplication and insert queries.
- [x] Task 2: Fix service-layer queries referencing `special_orders.product`
  - Fixed `shortageReminderService.ts` query and insert statements.
  - Fixed `storeSyncService.ts` insert statement.
  - Fixed `whatsappIntentService.ts` 15-min idempotency check and 5 insert queries.
  - Fixed `startupSyncCoordinator.ts` website refill sync update query.
  - Fixed `localAi/pharmacyToolRegistry.ts` special order booking tool insert query.
- [x] Task 3: Fix router-layer queries in `orders.ts`, `websiteOrders.ts`, `pharmarack.ts`, `refills.ts`
  - Fixed `orders.ts` PUT update query to set `medicine_name = ?`.
  - Fixed `websiteOrders.ts` PUT update query to set `medicine_name = ?`.
  - Fixed `pharmarack.ts` candidate lookups to select `medicine_name AS product, medicine_name`.
  - Fixed `refills.ts` cascade deletion queries to delete by `medicine_name = ?`.
- [x] Task 4: Fix `database.ts` schema migrations and healing routines
  - Removed `special_orders.product` addition from migration array.
  - Guarded column healing updates with `PRAGMA table_info` checks so dropped columns are never queried.
- [x] Task 5: Run TypeScript compilation, verification tests, and guardrails
  - Verified `tsc -p tsconfig.json` compiles with zero errors.
  - Verified reproduction test: `refillOrderReconciler.upsertForPhone` creates orders without column errors.
  - Verified `checkAllRefills` passes with zero errors.
  - Ran `npm run guardrails`: PASS with 0 violations.
- [x] Task 6: Human-in-the-loop verification
  - Ready for user review and approval in UI.
