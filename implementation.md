# Implementation Plan: Fix "Unknown Medicine" Display & Save Logic in CRM Refills

## Objective
Eliminate `"Unknown Medicine"` from the CRM Refill page, ensure medicines are always saved and displayed with their true name, prevent unlinked medicine IDs or inventory ID confusion from corrupting refill records, and guarantee that any refill with an unlinked catalog ID falls back gracefully to `pr.medicine_name`.

---

## Root Causes Addressed
1. **Omission of `pr.medicine_name` in SQL queries in `src/routes/refills.ts`**:
   - `patient_refills` has a `medicine_name` column storing the real medicine name.
   - 10 queries in `src/routes/refills.ts` (including `GET /panel`, `GET /`, and reminders) selected:
     `COALESCE(m.name, pr.cart_product_name, 'Unknown Medicine') AS medicine_name`
   - If `pr.medicine_id` did not match a record in `medicines`, it skipped `pr.medicine_name` and displayed `'Unknown Medicine'`.
2. **Missing `medicine_name` in `PUT /refills/patient-medicines` (`src/routes/refills.ts`)**:
   - The frontend passes `medicine_name` in `medicines: [{ medicine_id, medicine_name, quantity_needed }]`.
   - The backend `INSERT INTO patient_refills` omitted the `medicine_name` column and parameter, leaving `pr.medicine_name` as `NULL`.
3. **Unlinked Medicine Resolution**:
   - If `medId` is `0` or missing but `medName` is present, look up the master catalog or preserve `medName` directly in `patient_refills.medicine_name`.

---

## Code Changes Implemented

### 1. Updated SQL queries in `src/routes/refills.ts`
- Updated all 10 occurrences of `COALESCE` in `src/routes/refills.ts`:
  `COALESCE(m.name, pr.medicine_name, pr.cart_product_name, 'Unknown Medicine') AS medicine_name`
- Ensures that whenever `m.name` is null (e.g. unlinked medicine or custom prescription), the query retrieves `pr.medicine_name` rather than jumping to `'Unknown Medicine'`.

### 2. Upgraded `PUT /patient-medicines` in `src/routes/refills.ts`
- Extracted `medName = (med.medicine_name || med.name || '').trim() || null;`.
- Attempt catalog lookup if `medId` is not provided but `medName` is present.
- Updated the `UPDATE patient_refills` query to include `medicine_name = COALESCE(?, medicine_name)`.
- Updated the `INSERT INTO patient_refills` query to include `medicine_name` in the column and parameter list.

### 3. Data Integrity & Verification
- Ran database integrity check on `app.dev.db` and `app.db` to verify all existing rows have valid names.
- Verified TypeScript compilation: `npx tsc --noEmit` passed with 0 errors.
- Verified Performance Guardrails: `npm run guardrails` passed.
- Updated Knowledge Graph: `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracker

- [x] Task 1: Update `COALESCE(m.name, pr.medicine_name, ...)` across all query routes in `src/routes/refills.ts`.
  - **Completed**: Replaced all 10 query occurrences in `src/routes/refills.ts`.
- [x] Task 2: Include `medicine_name` in `PUT /patient-medicines` INSERT and UPDATE in `src/routes/refills.ts`.
  - **Completed**: Added `medName` extraction, auto-resolution, and updated `UPDATE` and `INSERT` queries.
- [x] Task 3: Data reconciliation check.
  - **Completed**: Checked both `app.dev.db` and `app.db`, confirmed all existing records are intact.
- [x] Task 4: Verification tests and performance guardrails.
  - **Completed**: `npx tsc --noEmit` passed; `npm run guardrails` passed.
- [x] Task 5: Knowledge graph synchronization.
  - **Completed**: Synced via `node scripts/quick-update.mjs`.
