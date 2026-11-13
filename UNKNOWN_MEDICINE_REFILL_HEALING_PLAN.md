# Implementation Plan: Heal "Unknown Medicine" in CRM Refills & Preserve All Saved Medicines

**File:** `UNKNOWN_MEDICINE_REFILL_HEALING_PLAN.md`  
**Date:** 2026-11-13  
**Status:** In Progress  
**Objective:** Restore proper medicine names and catalog connections for Mr. TUKARMA JADHAV (FORACORT 200MCG ROTACAPS) and 10 other refill patients showing "Unknown Medicine", without deleting ANY existing medicines, refills, or distributor links.

---

## 1. Problem Analysis & Evidence
- **Symptom:** Mr. TUKARMA JADHAV (`9922556510`) shows `Unknown Medicine` under Prescriptions & Stock in CRM, while displaying `⭐ ARNAV PHARMACEUTICALS... +5` on the distributor button.
- **Mechanism Traced:**
  - `patient_refills` row (ID 160) holds `medicine_id = 6916355` and `medicine_name = NULL`.
  - In `medicines` master catalog, old ID `6916355` no longer exists; the active record is `id: 9769349`, `name: 'FORACORT 200MCG ROTACAPS'`.
  - `medicine_distributor_links` holds 6 distributor rows under `6916355`, each with `medicine_name = 'FORACORT 200MCG ROTACAPS'`.
  - The API query `COALESCE(m.name, pr.medicine_name, pr.cart_product_name, 'Unknown Medicine')` in `src/routes/refills.ts` returns `'Unknown Medicine'` because `m.name`, `pr.medicine_name`, and `pr.cart_product_name` are all `NULL`.
  - 10 other patient refills share the same pattern from the legacy catalog transition.

---

## 2. Safety & Zero-Deletion Contract
- **Rule:** NEVER delete any record from `medicines`, `patient_refills`, or `medicine_distributor_links`.
- **Action:** Only perform `UPDATE` and `INSERT OR IGNORE` operations to reconnect missing IDs and populate `medicine_name`.

---

## 3. Execution Steps

### Step 1: Reconnect & Heal Database Records
For each refill record where `medicines.id IS NULL`:
1. Retrieve medicine name from `medicine_distributor_links.medicine_name` (or `patient_refills.medicine_name`).
2. Match against active records in `medicines` table by exact/trigram name.
3. Update `patient_refills`:
   - Set `medicine_name = resolved_name`
   - Set `medicine_id = active_medicine_id`
4. Update `medicine_distributor_links`:
   - Duplicate/re-point distributor links to `active_medicine_id` so the distributor pills and Live Cart mappings resolve under both IDs.

### Step 2: Codebase Resilience in `src/routes/refills.ts`
Enhance the `/panel` SQL query so that if `m.name` and `pr.medicine_name` are missing, it checks `(SELECT mdl.medicine_name FROM medicine_distributor_links mdl WHERE mdl.medicine_id = pr.medicine_id AND mdl.medicine_name IS NOT NULL AND TRIM(mdl.medicine_name) != '' LIMIT 1)` before ever falling back to `'Unknown Medicine'`.

### Step 3: Boot-Path Self-Healing in `src/database.ts`
Add an idempotent healing routine in `ensureSchema` to backfill any future orphaned `patient_refills.medicine_name` from `medicine_distributor_links`.

### Step 4: Verification & Performance Guardrails
1. Run verification script against the database to confirm:
   - Mr. TUKARMA JADHAV displays `FORACORT 200MCG ROTACAPS`.
   - In-stock batch `6SA0735` (qty 3) is recognized.
   - All 11 affected patients have resolved medicine names.
   - Zero rows deleted in `medicines`, `patient_refills`, and `medicine_distributor_links`.
2. Run `npm run guardrails`.
3. Run `node scripts/quick-update.mjs`.

---

## 4. Completed Tasks Log
- [x] Task 1: Healing Script Executed on Live Database (`G:\AI Pharmacy OS\data\app.db` and dev DB)
  - Reconnected 18 orphaned refills to active catalog medicine IDs.
  - Preserved and cloned 34 distributor links.
  - ZERO deletions performed. Mr. TUKARMA JADHAV now accurately links to FORACORT 200MCG ROTACAPS (`9769349`) with 3 in stock.
- [x] Task 2: Backend Query Resilience in `src/routes/refills.ts`
  - Updated `GET /panel` and `GET /` queries to include fallback subquery to `medicine_distributor_links.medicine_name` in the `COALESCE` chain.
- [x] Task 3: Boot-Path Migration in `src/database.ts`
  - Added auto-healing step in `autoHealRefillIntervalsAndTasks(db)` to backfill any future missing `patient_refills.medicine_name` from `medicine_distributor_links`.
- [x] Task 4: Guardrails & Knowledge Graph Updated
  - `npm run guardrails` passed (0 violations, clean TypeScript compilation, DB integrity OK).
  - `node scripts/quick-update.mjs` completed (1616 files, 913 edges updated).
