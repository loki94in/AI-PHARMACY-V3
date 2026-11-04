# Distributor Contact Duplicate Column Permanent Removal Implementation Plan

## Objective
Permanently delete and remove the redundant legacy column `contact` from the `distributors` table in SQLite, migrating all existing phone data into the canonical `distributors.phone` column, and removing all references to `contact` across the entire codebase (including schema, importers, routes, workers, and tests) so dual-indexing conflicts can never recur.

---

## Complete 16-File Scope Analysis

| # | File Path | Existing Role of `contact` | Planned Surgical Change |
|---|---|---|---|
| **1** | `src/database.ts` | Creates `distributors` table with `contact TEXT`, and auto-heals `phone`/`contact`. | 1) Change DDL to `phone TEXT` (remove `contact`).<br>2) In `autoHealDistributorPhoneMappings`, execute `ALTER TABLE distributors DROP COLUMN contact` (with safe fallback table rebuild).<br>3) Drop references to `contact`. |
| **2** | `src/worker/importers/pgMasterImporter.ts` | `INSERT INTO distributors (..., contact, ..., phone, ...)` | Remove `contact` from columns and parameter bindings. |
| **3** | `src/services/distributorDispatchReminderWorker.ts` | Queries `d.contact`, aliases `distributor_contact`. | Remove `d.contact` and use only `d.phone`. |
| **4** | `src/utils/distributorSyncHelper.ts` | Selects and inserts `d.contact`, fallback checks. | Remove `contact` from `SyncDistributorParams`, SELECT queries, and INSERT statements. |
| **5** | `src/routes/pharmarack.ts` | Lines 703, 845, 858, 863, 4121, 4130, 4132 use `COALESCE(d.phone, d.contact)` and `WHERE d.contact != ''`. | Remove all `d.contact` references; use `d.phone` directly. |
| **6** | `src/routes/settings.ts` | Line 717: `INSERT INTO distributors (name, phone, contact, email, address, state_code)`. | Remove `contact` column and placeholder from query. |
| **7** | `src/routes/dispatch.ts` | Queries delivery boys and dispatch reminders. | Fixed manual order desync: calls `syncDistributorPhoneAcrossTables` to save to master `distributors.phone`. |
| **8** | `src/routes/orders.ts` | Special orders arrival alerts and phone validation. | Verify single-source phone validation. |
| **9** | `src/routes/refills.ts` | Staged reminders and notification queues. | Verify single-source customer phone join. |
| **10** | `src/services/orderScheduleService.ts` | Overdue order & refill schedules. | Verify single-source refill join. |
| **11** | `src/services/refillService.ts` | Refill briefing and staging counters. | Verify single-source customer phone join. |
| **12** | `src/services/whatsappIntentService.ts` | `isDistributorOrInternal()` checks `distributors.contact OR .phone`. | Remove `.contact` check; check only `distributors.phone`. |
| **13** | `src/services/outboundSecurityGateway.ts` | Verifies distributor directory recipients. | Updated query to `WHERE phone LIKE ?`. |
| **14** | `src/utils/reconnectDistributorLinks.ts` | Backs up/restores `distributors.contact`. | Migrate to backup/restore `distributors.phone`. |
| **15** | `frontend/src/pages/Dispatch/index.tsx` | Displays distributor phone with 10-digit validation. | UI consumes canonical phone field. |
| **16** | `frontend/src/pages/PharmarackCart/index.tsx` | Displays distributor phone and missing phone modal. | UI consumes canonical phone field. |
| **17** | `tests/directOrderDispatchFlow.test.ts` | Verifies end-to-end dispatch notification flow. | Passes with single `phone` column. |
| **18** | `tests/distributorDispatchAllDirectory.test.ts` | Tests full distributor directory phone synchronization. | Passes with single `phone` column. |

---

## Tasks Status & Resume Log

- [x] **Task 1: Database Migration & Schema DDL (`src/database.ts`)**
  - Updated `distributors` table DDL to use `phone TEXT` exclusively (removed `contact TEXT`).
  - Added boot migration to rescue emails into `email`, ensure valid numbers in `phone`, and execute `ALTER TABLE distributors DROP COLUMN contact`.
  - Executed on database: `PRAGMA table_info(distributors)` confirmed `contact` is permanently deleted (`has_contact: False`, all 29 phones preserved).
  - Cleaned up obsolete contact sync code from line 4942.

- [x] **Task 2: Importers & Sync Helpers (`pgMasterImporter.ts`, `distributorSyncHelper.ts`, `reconnectDistributorLinks.ts`)**
  - `pgMasterImporter.ts`: Removed `contact` from batch push and `INSERT INTO distributors`.
  - `distributorSyncHelper.ts`: Removed all `d.contact` selects, inserts, and updates; aligned parameter counts.
  - `reconnectDistributorLinks.ts`: Migrated backup restore query to restore into `phone` instead of `contact`.

- [x] **Task 3: Backend Routes, Security Gateway & Workers**
  - `src/routes/distributors.ts`: Cleaned `postDistributorsHandler`, `putDistributorHandler`, and `check-duplicate-phone` to query only `distributors.phone`.
  - `src/routes/pharmarack.ts`: Removed all `COALESCE(d.phone, d.contact)` and `WHERE d.contact != ''` occurrences.
  - `src/routes/settings.ts`: Removed `contact` from distributor update and insert queries.
  - `src/routes/dispatch.ts`: Fixed the manual phone order desynchronization hole so `POST /manual-order` automatically calls `syncDistributorPhoneAcrossTables`, saving phone numbers to master `distributors` permanently.
  - `src/services/distributorDispatchReminderWorker.ts`: Removed `d.contact` and `distributor_contact` queries.
  - `src/services/whatsappIntentService.ts`: Updated `isDistributorOrInternal()` to check `distributors.phone` exclusively.
  - `src/services/outboundSecurityGateway.ts`: Updated distributor directory verification to query `WHERE phone LIKE ?`.

- [x] **Task 4: Audit & Verification of the 16 Pipeline Files**
  - Confirmed 0 occurrences of `distributors.contact` across entire codebase.
  - Updated `tests/distributorDispatchAllDirectory.test.ts` to insert into `phone` instead of `contact`.

- [x] **Task 5: Zero-Bugs Gate (TypeScript, Jest Tests, Performance Guardrails, Knowledge Graph)**
  - TypeScript compilation (`tsc -p tsconfig.json --noEmit`): PASSED (0 errors).
  - Jest test suites (`distributorDispatchAllDirectory.test.ts`, `directOrderDispatchFlow.test.ts`): PASSED (8/8).
  - Performance Guardrails (`npm run guardrails`): PASSED (0 violations, B4 date compliance verified).
  - Knowledge graph (`quick-update.mjs`): Updated in 6.5s (1452 nodes).
