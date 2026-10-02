# Pre-Seeded Database & Master Catalog Restore Implementation Plan

> **Tracking ID**: `TASK-PRESEEDED-DB-CATALOG-RESTORE-001`  
> **Target**: Package pre-seeded `app.db` containing 286k+ medicines into Inno Setup installer (`installer.iss`), preserve existing CRM/orders data on upgrade, fix SQLite ON CONFLICT constraint mismatch in `masterMedicinesSeedService.ts`, and ensure boot-time fallback and page stability.  
> **Status**: COMPLETED

---

## 1. Problem Statement & Root Cause

1. **Installer Omission**:
   - `installer.iss` created an empty `data` directory but did NOT include `data\app.db` in its `[Files]` list.
   - On a fresh PC installation, the database started at 0 rows.
2. **Query Compilation & Constraint Resolution Failure (Rule 9)**:
   - In `masterMedicinesSeedService.ts` line 531:
     `ON CONFLICT(legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET`
   - The unique index `idx_medicines_legacy_id` was created unconditionally without `WHERE legacy_id IS NOT NULL`.
   - SQLite failed with: `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`.
   - The CSV boot enricher failed to insert any records, leaving `medicines` empty.
3. **Missing Data in UI**:
   - POS, Database, Inventory, and CRM had 0 medicines and failed/showed empty or error states.
4. **Preservation of Existing Data**:
   - Existing customer CRM data, special orders, and inventory must NEVER be overwritten during installer upgrades.

---

## 2. Tasks & Action Plan

- [x] **Task 1: Update `installer.iss` to package pre-seeded `data\app.db` safely**
  - Added `Source: "data\app.db"; DestDir: "{app}\data"; DestName: "app.db"; Flags: onlyifdoesntexist nocompression skipifsourcedoesntexist`
  - Ensures fresh installations have all 286,501 medicines ready immediately.
  - Ensures upgrades preserve existing customer CRM, orders, and sales data using `onlyifdoesntexist`.

- [x] **Task 2: Fix SQLite Index & ON CONFLICT Constraint Mismatch (Rule 9)**
  - In `src/services/masterMedicinesSeedService.ts`: Aligned `ON CONFLICT(legacy_id)` with `CREATE UNIQUE INDEX idx_medicines_legacy_id ON medicines(legacy_id)`.
  - Verified zero Query Compilation & Constraint Resolution Failure errors.

- [x] **Task 3: Enhance Server Boot Seeding Fallback (`src/server.ts`)**
  - In `src/server.ts`, if `medicines` table has 0 rows on boot, automatically triggers `seedMasterMedicines(false)` so that even standalone/dev environments auto-seed without manual API calls.

- [x] **Task 4: Vacuum & Prepare `data/app.db`**
  - Verified `data/app.db` integrity (`PRAGMA integrity_check` -> ok).
  - Confirmed 286,501 medicines and 2 active special orders (CRM) preserved.

- [x] **Task 5: Verification, Guardrails & Knowledge Graph Update**
  - Ran `npm run guardrails` -> PASS (0 violations, clean TypeScript compilation).
  - Ran `node scripts/quick-update.mjs` -> Updated 1186 nodes, 574 edges in 3.0s.

---

## 3. Execution Log
- **2026-10-02 18:33**: Created implementation plan.
- **2026-10-02 18:34**: Updated `installer.iss` with pre-seeded `app.db` source using `onlyifdoesntexist`.
- **2026-10-02 18:34**: Fixed `ON CONFLICT` clause in `src/services/masterMedicinesSeedService.ts`.
- **2026-10-02 18:34**: Added automated boot seeding fallback in `src/server.ts`.
- **2026-10-02 18:35**: Ran integrity check on `data/app.db` (passed with 286,501 medicines and active CRM orders).
- **2026-10-02 18:35**: Ran `npm run guardrails` (passed, 0 violations).
- **2026-10-02 18:35**: Synced knowledge graph with `quick-update.mjs`.
