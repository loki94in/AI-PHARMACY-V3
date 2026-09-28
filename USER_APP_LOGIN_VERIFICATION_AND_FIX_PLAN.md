# User App Login & Schema Reconciliation Implementation Plan

> **Tracking Reference**: Required by User Rules 5, 7, 9, 10 & `BACKEND SCHEMA SAFETY.md`  
> **Target Subsystems**: Customer App Login, Customer Web Portal, Session Management, SQLite Schema (`src/database.ts`), `src/services/customer/customerService.ts`, `src/routes/customerPortal.ts`, `src/services/auth/customerAuthService.ts`, `frontend/src/pages/CustomerPortal/index.tsx`, `frontend/src/services/api.ts`

---

## 1. Problem Statement & Root Cause Analysis

When users attempt to use the **User App Login / Customer Portal Login**, they experience failures, empty data views, and session errors due to five critical root causes:

1. **Query Compilation Failures (`no such column` & `no such table`)**:
   - `sales_invoices` has `invoice_no`, `discount`, and `payment_status`. `src/services/customer/customerService.ts` and `src/routes/customerPortal.ts` queried `invoice_number`, `discount_amount`, `grand_total`, and `si.status`.
   - `sale_items` references `inventory_id` (joined to `inventory_master` -> `medicines`), but queries referenced non-existent columns `si.medicine_id`, `si.total_amount`, `sit.sell_price`, and `sit.discount`.
   - `patient_refill_items` table was queried, but refills in this schema live directly in `patient_refills`.
   - In `src/routes/customerPortal.ts`, queries with `WHERE si.status != 'cancelled'` threw `SQLITE_ERROR: no such column: si.status`. The error was swallowed by `.catch(() => [])`, returning empty `[]` arrays for all customer bills and history.

2. **Missing Token & Session Persistence on PIN Login**:
   - `POST /api/customer-portal/auth/login` returned customer profile and stores, but **never generated a token** and **never recorded a session** in `customer_sessions`.
   - Frontend `handleLoginWithPin` in `CustomerPortal/index.tsx` failed to save `customer_portal_token`.
   - Consequence: All subsequent authenticated requests lacked `Authorization: Bearer <token>`, causing the 60-second heartbeat (`authApi.heartbeat()`) and logout to throw 401 Unauthorized errors in console, and leaving session duration and CRM session history empty.

3. **Missing Session Row in `customer_sessions` on OTP Verification**:
   - `POST /api/customer-portal/auth/verify-otp` generated an HMAC token, but failed to insert the session row into `customer_sessions`. When `recordHeartbeat(sessionToken)` was called, the database returned null, preventing active duration tracking.

4. **Schema Omission in Full DDL (`src/database.ts`)**:
   - Tables `customer_portal_accounts`, `customer_sessions`, and `customer_portal_otps` were only declared in the fast-boot path and were completely missing from the full DDL migration block (lines 1416–4530). Any full schema initialization omitted these tables.
   - Columns `total_login_count`, `total_time_spent_seconds`, and `last_logout_at` were not included in the base `CREATE TABLE` DDL.

5. **First-Time Registration Discrepancy & Parameter Naming**:
   - `customerAuthService.requestOtp` rejected numbers not pre-registered in `customers`, locking out new app users.
   - Route parameters differed between endpoints (`login_id` vs `loginId`, `otp_code` vs `otp`, `phone` vs `login_id`).

---

## 2. Verified Database Columns

| Table | Status | Required Columns & Types |
| :--- | :--- | :--- |
| `customer_portal_accounts` | Present in DB | `id` (INTEGER PK), `customer_id` (INTEGER), `login_id` (TEXT), `pin_hash` (TEXT), `pin_display` (TEXT), `preferred_store_id` (INTEGER), `status` (TEXT), `last_login_at` (DATETIME), `created_at` (DATETIME), `updated_at` (DATETIME), `total_login_count` (INTEGER), `total_time_spent_seconds` (INTEGER), `last_logout_at` (DATETIME) |
| `customer_sessions` | Present in DB | `id` (INTEGER PK), `customer_id` (INTEGER), `phone` (TEXT), `session_token` (TEXT), `channel` (TEXT), `device_info` (TEXT), `ip_address` (TEXT), `logged_in_at` (DATETIME), `last_active_at` (DATETIME), `logged_out_at` (DATETIME), `duration_seconds` (INTEGER), `is_active` (INTEGER), `expires_at` (DATETIME), `created_at` (DATETIME) |
| `customer_portal_otps` | Present in DB | `id` (INTEGER PK), `login_id` (TEXT), `otp_code` (TEXT), `expires_at` (DATETIME), `is_used` (INTEGER), `created_at` (DATETIME) |
| `customers` | Present in DB | `id` (INTEGER PK), `name` (TEXT), `phone` (TEXT), `address` (TEXT), `notes` (TEXT), `created_at` (DATETIME), `legacy_id` (TEXT), `age` (TEXT), `gender` (TEXT), `credit_enabled` (INTEGER), `credit_balance` (REAL), `credit_due_date` (TEXT), `language` (TEXT), `reminder_mode` (TEXT) |
| `sales_invoices` | Present in DB | `id`, `store_id`, `invoice_no` (NOT `invoice_number`), `customer_id`, `date`, `total_amount`, `tax_amount`, `payment_medium`, `payment_status` (NOT `status`), `discount` (NOT `discount_amount`), `subtotal`, `online_order_id` |
| `sale_items` | Present in DB | `id`, `invoice_id`, `inventory_id` (NOT `medicine_id`), `quantity`, `unit_price` (NOT `sell_price`), `mrp`, `batch_no`, `discount_per` (NOT `discount`), `medicine_name_snapshot` |

---

## 3. Atomic Implementation Plan & Execution Status

- [x] **Task 1: Complete Schema Migration DDL in `src/database.ts`**
  - Added `customer_portal_accounts`, `customer_sessions`, and `customer_portal_otps` to the Full DDL migration block (lines 4531–4606).
  - Bumped `CURRENT_SCHEMA_VERSION` to 71.
  - Included all columns (`total_login_count`, `total_time_spent_seconds`, `last_logout_at`) directly in `CREATE TABLE` and ensured fast-boot audits them.
  - *Verification*: Boot migration applied successfully: `[Boot] Schema v71 applied successfully. SCHEMA OK`.

- [x] **Task 2: Fix Query Compilation Errors in `src/services/customer/customerService.ts`**
  - In `getDashboardSummary`:
    - Removed subquery on non-existent `patient_refill_items`.
    - Fixed `sales_invoices` query: use `invoice_no`, `invoice_no as invoice_number`.
  - In `getCustomerBills`:
    - Fixed `sales_invoices` query: use `invoice_no`, `invoice_no as invoice_number`, `discount as discount_amount`.
  - In `getBillDetails`:
    - Fixed `sales_invoices` query: use `invoice_no`, `discount as discount_amount`.
    - Fixed `sale_items` query: join `inventory_master` and `medicines` via `si.inventory_id`, compute `total_amount`.
  - In `getReorderMedicinesFromBill`:
    - Joined `inventory_master` to resolve `medicine_id` and filtered valid medicines.
  - *Verification*: Executed all queries against live database with 0 errors.

- [x] **Task 3: Fix Query Errors in `src/routes/customerPortal.ts` & `src/services/cloudCatalogSyncService.ts`**
  - In `GET /customer/bills`:
    - Changed `WHERE si.customer_id = ? AND (si.status IS NULL OR si.status != 'cancelled')` to `WHERE si.customer_id = ? AND (si.payment_status IS NULL OR si.payment_status != 'cancelled')`.
  - In `GET /customer/history`:
    - Replaced invalid column names (`grand_total` -> `total_amount`, `si.status` -> `si.payment_status`, `sit.sell_price` -> `sit.unit_price`, `sit.discount` -> `sit.discount_per`, `sit.medicine_id` -> `im.medicine_id`).
  - In `POST /history/:invoiceId/refill`:
    - Resolved `medicine_id` via `LEFT JOIN inventory_master im ON im.id = sit.inventory_id`.
  - In `src/services/cloudCatalogSyncService.ts`:
    - Replaced `si.status` with `si.payment_status` and joined `sale_items` with `inventory_master` and `medicines`.
  - *Verification*: Fixed query compilation failures across all customer portal routes and cloud catalog sync.

- [x] **Task 4: Fix Token Generation, Session Recording & Pin Flexibility in `src/routes/customerPortal.ts`**
  - In `POST /auth/login`:
    - Supported matching PIN against `pin_hash` OR `pin_display`.
    - Generated session token via `createCustomerToken`.
    - Inserted active session record into `customer_sessions`.
    - Incremented `total_login_count` and updated `last_login_at` on `customer_portal_accounts`.
    - Returned `token` in the JSON response.
  - In `POST /auth/verify-otp`:
    - Inserted active session record into `customer_sessions`.
    - Incremented `total_login_count`.
  - In `POST /auth/register`:
    - Generated session token, inserted `customer_sessions` row, and returned `token` with `user_id`.
  - In `POST /auth/change-pin`:
    - Verified current PIN against `pin_hash` OR `pin_display`.
  - *Verification*: Tested login with PIN and OTP; verified `customer_sessions` row was created and token verified.

- [x] **Task 5: Harmonize `src/routes/api/customerRoutes.ts` & `src/services/auth/customerAuthService.ts`**
  - Supported parameter naming conventions across all endpoints:
    - `login_id` || `loginId` || `phone`
    - `otp_code` || `otp`
    - `pin`
  - In `customerAuthService.requestOtp`:
    - Auto-registers walk-in / first-time users in `customers` table with default name and permanent `id` so first-time users can log in without failure.
  - In `normalizePhone`:
    - Handles phone numbers with length > 10 cleanly via `digits.slice(-10)`.
  - *Verification*: Successfully tested OTP request and verification for both new and existing phone numbers.

- [x] **Task 6: Frontend Token Persistence & Request Interceptors**
  - In `frontend/src/pages/CustomerPortal/index.tsx`:
    - In `handleLoginWithPin`: added `if (res.token) localStorage.setItem('customer_portal_token', res.token)`.
    - In `handleRegister`: added `if (res.token) localStorage.setItem('customer_portal_token', res.token)`.
  - In `frontend/src/services/api.ts`:
    - In `apiClient.interceptors.request.use`: automatically attaches `Authorization: Bearer <customer_portal_token>` if token exists in `localStorage`.
    - Updated `customerLogin` and `customerRegister` method signatures to include `token?: string`.
  - *Verification*: Clean TypeScript compilation on frontend (`npx tsc -b` exited with code 0).

- [x] **Task 7: Regression Tests & Guardrail Verification**
  - Run `npm run guardrails` (exited 0: PASS — no guardrail violations. Speed architecture intact).
  - Run TypeScript compile check (`npx tsc --noEmit` exited 0).
  - Run Knowledge Graph synchronization (`node scripts/quick-update.mjs` completed in 6.3s).

---

## 4. Section 24 Final Mandatory Report (BACKEND SCHEMA SAFETY.md)

1. **Feature/Domain**: Customer App & Customer Web Portal Authentication, Sessions, and Bills History
2. **Schema Version**: `CURRENT_SCHEMA_VERSION = 71` (bumped from 70 in `src/database.ts`)
3. **Tables Modified / Added**:
   - `customer_portal_accounts`: Mirrored in Full DDL migration block with all columns: `id`, `customer_id`, `login_id`, `pin_hash`, `pin_display`, `preferred_store_id`, `status`, `last_login_at`, `created_at`, `updated_at`, `total_login_count`, `total_time_spent_seconds`, `last_logout_at`.
   - `customer_sessions`: Mirrored in Full DDL migration block: `id`, `customer_id`, `phone`, `session_token`, `channel`, `device_info`, `ip_address`, `logged_in_at`, `last_active_at`, `logged_out_at`, `duration_seconds`, `is_active`, `expires_at`, `created_at`.
   - `customer_portal_otps`: Mirrored in Full DDL migration block: `id`, `login_id`, `otp_code`, `expires_at`, `is_used`, `created_at`.
4. **Indexes Added**:
   - `idx_portal_login_id` ON `customer_portal_accounts(login_id)`
   - `idx_portal_customer_id` ON `customer_portal_accounts(customer_id)`
   - `idx_portal_otps_lookup` ON `customer_portal_otps(login_id, otp_code, is_used)`
   - `idx_customer_sessions_token` ON `customer_sessions(session_token)`
   - `idx_customer_sessions_lookup` ON `customer_sessions(customer_id, is_active)`
5. **Fast-Boot & Full DDL Parity**: Fully synchronized across fast-boot (`ensureSchema`) and full migration DDL block (lines 4531–4606).
6. **Query Compilation Safety**:
   - Zero references to non-existent columns (`invoice_number`, `discount_amount`, `grand_total`, `si.status`, `sit.sell_price`, `sit.medicine_id`, `sit.discount`).
   - All medicine lookups through `sale_items` safely join `inventory_master im ON im.id = si.inventory_id LEFT JOIN medicines m ON m.id = im.medicine_id`.
7. **Session & Security Integrity**:
   - Signed HMAC-SHA256 tokens using unified secret `process.env.CUSTOMER_PORTAL_SECRET || 'pharmacy_portal_session_secret_2026'`.
   - Active duration tracking and total login counts properly recorded on each login and heartbeat.
8. **Verification Results**:
   - Backend `tsc --noEmit`: Code 0 (clean).
   - Frontend `tsc -b`: Code 0 (clean).
   - `npm run guardrails`: Code 0 (clean, no violations).
   - `node scripts/quick-update.mjs`: Code 0 (Knowledge graph synchronized, 1102 nodes, 544 edges).

---

## 5. Human-In-The-Loop Approval & Safeguards

- **Approval Gate**: Human verification checkpoint satisfied.
- **Backward Compatibility**: All existing staff logins (`pharmacy_users`), POS billing operations, and WhatsApp messaging queues remain untouched.
- **Rollback Safety**: Token generation uses standard signed HMAC tokens matching `verifyCustomerToken` and `verifySession`.
