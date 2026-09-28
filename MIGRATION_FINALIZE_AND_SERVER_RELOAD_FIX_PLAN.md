# Migration Finalize & Server Reload Fix Implementation Plan

## Goal
Resolve the Windows file lock violation (`errno: -4094`) during migration finalize when swapping `staging.db` into `app.db`, ensure all background database handles (`messageDAO`, in-process email/catalog workers, `dbManager`) are properly closed and drained, add native SQLite `backup()` fallback for 100% reliable database swaps, fix the `ReferenceError: require is not defined` crash in `src/server.ts:596`, and finalize the pending migration so 286,494 medicines and 24,639 sales invoices become active.

---

## Tasks & Checklist

- [x] **TASK 1** — Fix `src/server.ts` ES module `require` crash:
  - Import `execSync` from `'child_process'` at the top of `src/server.ts`.
  - Remove `const { execSync } = require('child_process')` in the `EADDRINUSE` error handler.
- [x] **TASK 2** — Fix `src/routes/migration.ts` finalize lock & swap mechanism:
  - Call `closeMessageDAO()` to close open `better-sqlite3` handles on `app.db`.
  - Safely stop in-process email poller and catalog workers.
  - Add a 400ms settle grace period after `dbManager.close(true)` for Windows OS file handles to drain.
  - Implement a 5-attempt retry loop for `fs.copyFileSync` with 500ms delay.
  - Implement fallback using SQLite native Backup API (`sourceDb.backup(DB_PATH)`) if Windows OS file sharing violation occurs.
- [x] **TASK 3** — Finalize migration and activate data:
  - Staging completed cleanly: 286,494 medicines, 38,021 inventory records, 16,213 purchases, 24,639 sales invoices, and 9,334 customers.
  - Finalized promotion of staging database into live database with zero file lock errors.
  - Re-queried live database to confirm all 286,494 medicines, 38,021 inventory batches, 16,213 purchases, and 24,639 invoices are live.
- [x] **TASK 4** — Quality Gates & Verification:
  - Run `npm run guardrails` (`tsc --noEmit` and performance checks).
  - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## Completion Log

- **TASK 1 Completed**: Fixed `src/server.ts` line 9 and 596 by statically importing `execSync` from `'child_process'`. Prevents `ReferenceError: require is not defined` crash when `EADDRINUSE` occurs.
- **TASK 2 Completed**: Updated `src/routes/migration.ts` finalize handler to explicitly call `closeMessageDAO()`, stop in-process email pollers, drain file handles with a 400ms settle window, retry `copyFileSync` on Windows, and fall back to SQLite's native page backup API (`stagingSourceDb.backup(DB_PATH)`).
- **TASK 3 Completed**: Executed auto migration and finalization for `retailerdb_backup_Mon 09_28_2026_11_01_00.93.sql.zip`. Verified live database tables: 286,494 medicines, 38,021 inventory records, 16,213 purchases, 63,452 purchase items, 24,639 sales invoices, 74,263 sale items, 143,157 stock movements, 1,454 returns, and 9,334 customers are all active.
- **TASK 4 Completed**: Guardrails passed cleanly with 0 violations. Knowledge graph synchronized via `node scripts/quick-update.mjs`.
