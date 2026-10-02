# Prevent Duplicate Purchase Bill Entries Implementation Plan

> **Goal**: 
> 1. Prevent saving duplicate purchase bills for the same distributor within the same Indian Financial Year (1st April to 31st March).
> 2. Ensure cross-year reuse of invoice numbers is allowed (distributors resetting bill sequences in April is valid).
> 3. Provide real-time proactive warnings (banner + input highlight) in the Purchases UI as the user types invoice number and selects distributor.
> 4. Enforce strict blocking on save with a human-in-the-loop action modal showing the existing conflicting bill details and a 1-click action to "Open / Edit Existing Bill".
> 5. Guard backend endpoints (`POST /purchases/manual`, `POST /staged/:id/approve`) against race conditions and silent overwrites.

---

## Tasks Checklist

- [x] `Task 1`: Indian Financial Year Utility & Safe Database Index
  - **Completed**:
    - Created `src/utils/financialYear.ts` implementing `getIndianFinancialYear(dateString)` to calculate precise Indian Financial Year bounds (`YYYY-04-01` to `(YYYY+1)-03-31`) and labels (`YYYY-YY`).
    - Added composite index `idx_purchases_dist_invoice ON purchases(distributor_id, invoice_no)` in `src/database.ts` across all startup and migration blocks.

- [x] `Task 2`: Backend Duplicate Check Endpoint & Save Protection
  - **Completed**:
    - Implemented `GET /api/purchases/check-duplicate` in `src/routes/purchases.ts` to perform fast indexed duplicate lookups by distributor and invoice number within the FY date range, supporting `exclude_id` for edit mode.
    - Updated `POST /purchases/manual` to validate against duplicate bills in the same FY & distributor. Eliminated silent overwrite and added HTTP 409 Conflict with full existing bill metadata.
    - Updated `POST /staged/:id/approve` and `handleUpdatePurchaseFull` to enforce FY duplicate validation bounds.

- [x] `Task 3`: Frontend API Client & Proactive Real-Time Warning Banner
  - **Completed**:
    - Added `checkDuplicatePurchaseBill` method to `api` in `frontend/src/services/api.ts`.
    - Added debounced real-time duplicate detection in `frontend/src/pages/Purchases/index.tsx` triggered on `invoiceNo`, `selectedDistributor`, `distributorSearch`, or `invoiceDate`.
    - Added red/amber border highlighting on the Invoice No input and an inline notice banner displaying conflicting bill details in real time.

- [x] `Task 4`: Human-in-the-Loop Duplicate Bill Blocking Modal & Direct Navigation
  - **Completed**:
    - Created `frontend/src/components/PurchaseDuplicateBillModal.tsx` following project design rules and semantic Tailwind classes.
    - Intercepted `savePurchase()` and `collectBillForSave()` to strictly block save when a duplicate bill is detected in the same FY.
    - Included full conflict details in the modal (ID, Invoice No, Distributor, Date, Item Count, Grand Total).
    - Provided human-in-the-loop actions:
      1. "Open / Edit Existing Bill" to immediately hydrate and edit the existing bill with 1 click.
      2. "Change Invoice No" to dismiss modal and focus the invoice input for correction.

- [x] `Task 5`: Comprehensive Automated Tests, Performance Guardrails, and Knowledge Graph Update
  - **Completed**:
    - Created `tests/preventDuplicatePurchaseBill.test.ts` covering FY boundary calculations, same FY & distributor blocking, cross-year allowance, cross-distributor allowance, whitespace trimming/case insensitivity, and edit-mode self-exclusion.
    - Automated tests passed 100% (2 suites, 2 passing, 0 failures).
    - `npx tsc --noEmit` passed with 0 errors.
    - `npm run guardrails` passed (exit code 0, speed architecture intact).
    - Ran `node scripts/quick-update.mjs` (synchronized 1173 nodes, 580 edges).

---

## Progress Log

- Task 1: Completed
- Task 2: Completed
- Task 3: Completed
- Task 4: Completed
- Task 5: Completed
