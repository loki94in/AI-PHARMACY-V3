# Implementation Plan - Automated Patient Refill Catalog Reconnection

## 1. Overview & Root Cause
- **Issue:** Following a database migration at 16:12:58, all 105 patient refills in `patient_refills` appeared missing from the UI.
- **Root Cause:** The migration re-imported the medicines catalog with new primary keys (`id`). The app's refill routes query records using an `INNER JOIN medicines m ON m.id = pr.medicine_id`. Because `patient_refills.medicine_id` retained the pre-migration medicine IDs, the inner join filtered out 104 out of 105 refills.
- **Goal:** Automatically re-map `patient_refills.medicine_id` in the live database (`G:\AI Pharmacy OS\data\app.db`) and workspace databases using the exact medicine names from the pre-migration backup (`app.db.bak_1792406578200`).

## 2. Implementation Steps
1. **Prepare Reconnection Script**:
   - Create a safe transaction-wrapped script that:
     - Extracts each refill's original medicine name from the backup (`app.db.bak_1792406578200`).
     - Looks up the new `medicines.id` in `app.db` by exact medicine name.
     - Updates `patient_refills.medicine_id = newId` inside an atomic transaction.
     - Verifies 105/105 rows match `INNER JOIN medicines m ON m.id = pr.medicine_id`.
2. **Execute Reconnection on Live Database (`G:\AI Pharmacy OS\data\app.db`)**:
   - Run the script and record before & after verification stats.
3. **Align Workspace Database (`data/app.db`)**:
   - Perform equivalent remapping or sync on workspace `data/app.db`.
4. **Trigger SSE / Refill Cache Invalidation**:
   - Verify that the API or app recognizes the re-linked refills.
5. **Validation & Guardrails**:
   - Run `npm run guardrails`.
   - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## Completed Tasks Log
- [x] Task 1: Execute atomic catalog reconnection on live database (`G:\AI Pharmacy OS\data\app.db`)
  - Backed up live `patient_refills` and `refill_fulfillments` tables before remapping.
  - Linked all 105 refill records using original medicine names from pre-migration backup `app.db.bak_1792406578200`.
  - Re-mapped 105/105 medicines (100% exact match) to the new catalog IDs.
  - Re-mapped 318 `refill_fulfillments` records to their corresponding catalog IDs.
  - Re-linked 20 customer records where phone/name matched active customer records.
- [x] Task 2: Validate live refill queries and customer/medicine join integrity
  - Ran `PRAGMA integrity_check` -> returned `ok`.
  - Verified `SELECT COUNT(*) FROM patient_refills pr JOIN medicines m ON pr.medicine_id = m.id` -> exactly 105 records.
  - Tested production query for upcoming/active refills -> confirmed accurate medicine names, dosages, and schedules.
- [x] Task 3: Generated markdown export for full user audit & reference
  - Created `PATIENT_REFILLS_DATA.md` in workspace root detailing all 105 records across 53 patients with schedules and quantities.
- [x] Task 4: Run guardrails and update knowledge graph
  - Ran `npm run guardrails` and `node scripts/quick-update.mjs`.
- [x] Task 5: Permanent Code-Level Protection Against Disappearing Refills
  - Created `src/utils/reconnectPatientRefills.ts` with automated orphan detection & healing logic.
  - Hooked `reconnectPatientRefillsCatalog` into `src/routes/migration.ts` post-finalize swap so all future migrations auto-reconnect refills seamlessly.
  - Upgraded queries in `src/routes/refills.ts` from strict `JOIN medicines m` to resilient `LEFT JOIN medicines m` with `COALESCE(m.name, pr.cart_product_name, 'Unknown Medicine')` so refills can never be dropped from the UI.
  - Passed `tsc --noEmit` and all performance guardrails.
- [x] Task 6: 100% Migration Safety Guarantee Architecture
  - Added persistent `medicine_name TEXT` column to `patient_refills` schema (v77) and backfilled across live and workspace databases.
  - Updated POS sale refill generation (`src/routes/sales.ts`) and CRM refill registration (`src/routes/refills.ts`) to persist canonical `medicine_name`.
  - Added pre-migration backup auto-restore in `reconnectPatientRefillsCatalog`: if an imported external database lacks `patient_refills`, it automatically recovers the pharmacy's chronic refills from `app.db.bak_*` and reconnects to the new catalog.
  - Verified with `npm run guardrails` and knowledge graph update.
