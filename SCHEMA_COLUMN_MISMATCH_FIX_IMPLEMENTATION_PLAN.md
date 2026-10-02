# SQLite Schema Drift & Column Mismatch Fix Implementation Plan

> Target: Fix all 12 confirmed runtime SQLite "no such column" bugs across backend routes and services.
> Rule Reference: AGENTS.md, Backend Schema Safety, and User Global Rules #5, #9, #10, #11.

---

## 📋 Task Checklist

- [x] **Task 1: Database Schema Expansion (`src/database.ts`)**
  - Added `payment_method TEXT` and `delivery_mode TEXT` to `special_orders` table across DDL, fast-boot, and migrations array.
  - Added `possible_duplicate_of INTEGER` to `staged_medicine_reviews` table across DDL, fast-boot, and migrations array.
  - Bumped `CURRENT_SCHEMA_VERSION` from 71 to 72.
  - Migrated live database `data/app.db` with columns and updated `schema_version` to 72.
  - *Status:* Completed & Verified

- [x] **Task 2: POS Held Bill Insertion Fix (`src/routes/sales.ts`)**
  - Removed dropped column `data` from `INSERT INTO held_bills`. Only valid `cart_data` is persisted.
  - *Status:* Completed & Verified

- [x] **Task 3: Patient Refills Conversion Fix (`src/routes/enquiries.ts`)**
  - Removed invalid columns `medicine_name, dosage, quantity` from `INSERT INTO patient_refills`.
  - Mapped to schema columns: `store_id, customer_id, patient_name, patient_phone, medicine_id, quantity_needed, next_refill_date, refill_interval_days, is_active, status`.
  - *Status:* Completed & Verified

- [x] **Task 4: Overdue Refill Schedule Fetch Fix (`src/services/orderScheduleService.ts`)**
  - Replaced non-existent `pr.created_at` with `COALESCE(pr.last_refill_date, pr.next_refill_date)`.
  - *Status:* Completed & Verified

- [x] **Task 5: Therapeutic Inventory Search Fix (`src/routes/inventory.ts`)**
  - Replaced non-existent `i.rate` on `inventory_master` with `COALESCE(m.rate, i.unit_price, 0) as rate`.
  - *Status:* Completed & Verified

- [x] **Task 6: Vendor Returns Master Medicine Auto-Insert Fix (`src/routes/returns.ts`)**
  - Changed `is_active = 1` to `status = 'active'` in `INSERT INTO medicines`.
  - *Status:* Completed & Verified

- [x] **Task 7: Website Orders & Owner Portal `sell_price` Fixes (`src/routes/websiteOrders.ts` & `src/routes/websiteOwner.ts`)**
  - Fixed `websiteOrders.ts:972`: `COALESCE(am.sell_price, m.sell_price, oi.sell_price, im.mrp, 0) as batch_sell`.
  - Fixed `websiteOrders.ts:1883`: Joined `medicines m` to select `COALESCE(m.sell_price, im.unit_price, im.mrp, 0) as sell_price`.
  - Fixed `websiteOwner.ts:436`: Selected `COALESCE(m.sell_price, MAX(im.unit_price), MAX(im.mrp), 0) as sell_price`.
  - *Status:* Completed & Verified

- [x] **Task 8: Online Order Held Bill Push Fix (`src/routes/websiteOrders.ts`)**
  - Fixed `websiteOrders.ts:1050` to insert into `staged_sales` using valid schema columns: `patient_name, patient_phone, discount, sale_date, items_json, status ('pending')`.
  - *Status:* Completed & Verified

- [x] **Task 9: AI Distributor Recommendation Rate & Item Name Fix (`src/services/distributorRecommendationService.ts`)**
  - Changed `AVG(pi.rate)` to `AVG(pi.cost_price)` and joined `medicines med ON med.id = pi.medicine_id` to match `med.name`.
  - *Status:* Completed & Verified

- [x] **Task 10: Market Closure Buffer Sync Column Fix (`src/services/marketClosureService.ts`)**
  - Replaced non-existent `is_synced_to_pharmarack` with schema column `pharmarack_mapped` in `INSERT INTO special_orders`.
  - *Status:* Completed & Verified

- [x] **Task 11: Telegram Prescription Inventory Batch Typo Fix (`src/services/telegramPrescriptionService.ts`)**
  - Changed `im.batch_number` to `im.batch_no as batch_number, im.batch_no`.
  - *Status:* Completed & Verified

- [x] **Task 12: Verification & Guardrails**
  - Re-ran deep column audit scanner: 0 genuine schema mismatch bugs remaining.
  - TypeScript compilation (`npx tsc --noEmit`): PASSED (0 errors).
  - Performance Guardrails (`npm run guardrails`): PASSED (0 violations).
  - Knowledge graph updated (`node scripts/quick-update.mjs`): PASSED.
  - *Status:* Completed & Verified
