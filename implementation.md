# Implementation Plan: Fix Release v0.1.171 Crash on Launch (SQLITE_READONLY) & Setup / Update Obstruction

## 1. Executive Summary & Root Cause Analysis

### Problem Description
Following release `v0.1.171`, users reported:
1. **App fails to open and crashes on launch**: When launching `PharmacyOS.exe`, the splash screen ("Starting...") briefly appears, then the application terminates/crashes.
2. **Unable to install / update**: In-app updates fail to complete or roll back to the prior version; manual setup installer is blocked by running background processes or launches a build that immediately crashes.

### Root Cause 1: Global `sqlitePatch.ts` Write PRAGMA on `OPEN_READONLY` Connection (Primary Crash)
- In `src/database/sqlitePatch.ts`, `sqlite3.Database` constructor was globally monkey-patched to execute performance tuning queries immediately on every new connection:
  ```ts
  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;', (err1) => { ... });
  });
  ```
- In commit `eb56e0a2`, the database schema version was bumped from `83` to `84`, introducing pre-migration snapshot verification (`src/utils/migrationSafety.ts:verifyBackupReadability`).
- `verifyBackupReadability` and `verifyRestoredDatabaseAndContacts` open the database snapshot using:
  ```ts
  testDb = await open({
    filename: snapshotPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });
  ```
- Because `sqlitePatch.ts` executes `PRAGMA journal_mode = WAL;` (which writes to the database file header) on **all** opened connections, SQLite instantly rejects the write query on `OPEN_READONLY` with:
  ```
  [Migration Safety] Backup Verification Failure: Snapshot verification failed: SQLITE_READONLY: attempt to write a readonly database
  Failed to initialize database schema during boot: Error: [Migration Safety] Backup Verification Failure: Pre-migration backup is unreadable or corrupted (Snapshot verification failed: SQLITE_READONLY: attempt to write a readonly database). Migration aborted to preserve original database.
      at ensureSchema (dist-pkg/server.cjs:27059:15)
  ```
- In `src/server.ts`, an uncaught error in `ensureSchema` executes `console.error(...)` and `process.exit(1)`.
- When `PharmacyBackend.exe` exits with code 1, Electron's `waitForBackend()` rejects, logs `Backend failed to start`, and calls `app.quit()`, instantly terminating the desktop application.
- This defect affects **both** existing installations upgrading from v83 to v84 AND fresh installations (whose seeded `data/app.db` is at v75 and must migrate to v84).

### Root Cause 2: Orphaned `PharmacyBackend.exe` Blocking Port 5175 in `installer.iss`
- When `PharmacyOS.exe` crashed, `PharmacyBackend.exe` sometimes lingered or was restarted by watchdog/child launcher.
- In `installer.iss:InitializeSetup()`, the installer checked:
  ```pascal
  if IsPortInUse(5175) and (not IsProcessRunning('PharmacyOS.exe')) then
  ```
  Surfacing a blocking prompt: `"Port 5175 is currently in use by another application. AI Pharmacy OS needs port 5175 to run. Continue installing anyway?"`
- If the user clicked "No", the installer aborted immediately. Proactively terminating `PharmacyBackend.exe` before the check eliminates this false obstacle.

---

## 2. Proposed Surgical Changes

### Phase 1: Fix `src/database/sqlitePatch.ts`
- Detect if `mode` contains `sqlite3.OPEN_READONLY` (`(mode & sqlite3.OPEN_READONLY) !== 0`).
- For read-only connections, **skip** `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;`.
- Apply only read-safe pragmas (`busy_timeout`, `cache_size`, `temp_store = MEMORY`).

### Phase 2: Add Defense-in-Depth in `src/utils/migrationSafety.ts`
- In `verifyBackupReadability` and `verifyRestoredDatabaseAndContacts`, if an unexpected `SQLITE_READONLY` error occurs during snapshot read verification, gracefully retry without `OPEN_READONLY` before failing the migration.

### Phase 3: Proactively Terminate Lingering Backend in `installer.iss`
- In `InitializeSetup()`, check `IsProcessRunning('PharmacyBackend.exe')` and terminate it before evaluating port 5175 availability, ensuring clean installations without manual task manager intervention.

### Phase 4: Build, Verify & Rollout
- Rebuild backend bundle (`npm run build:bundle`) and Node SEA executable (`node scripts/buildSea.cjs`).
- Verify boot on `G:\AI Pharmacy OS\data\app.db` and dev sandboxes.
- Run `npm test -- tests/migrationDistributorSafety.test.ts`.
- Run `npm run guardrails` (exit 0).
- Run `node scripts/quick-update.mjs`.

---

## 3. Verification Plan

| Step | Verification Command | Expected Outcome |
|---|---|---|
| 1 | `npx tsx -e "import './src/database/sqlitePatch.ts'; import sqlite3 from 'sqlite3'; import { open } from 'sqlite'; ..."` | Successfully opens in `OPEN_READONLY` without `SQLITE_READONLY` error |
| 2 | `npm test -- tests/migrationDistributorSafety.test.ts` | All 9 tests pass |
| 3 | Backend boot test with schema v84 | `[Boot] Applying schema v84...` succeeds, verifies snapshot, and stamps v84 |
| 4 | Guardrails check `npm run guardrails` | Exit code 0, 0 violations |
| 5 | Knowledge graph update `node scripts/quick-update.mjs` | Graph updated cleanly |

---

## 4. Tasks Register

- [x] Task 1: Fix `src/database/sqlitePatch.ts` to exempt `OPEN_READONLY` connections from write PRAGMAs
  - Completed: Added `isReadOnly` flag detection (`mode & sqlite3.OPEN_READONLY`) and skipped write PRAGMAs (`journal_mode = WAL;`, `synchronous = NORMAL;`) on read-only connections.
- [x] Task 2: Fix false distributor contact validation failures on legacy email addresses in `src/utils/migrationSafety.ts`
  - Completed: Added `isEmailString(val)` check in `validateDistributorContacts` to recognize legacy email addresses cleaned from `phone`/`contact` columns; added backoff retry in `restorePreMigrationSnapshot`.
- [x] Task 3: Enhance `installer.iss:InitializeSetup()` to terminate lingering `PharmacyBackend.exe`
  - Completed: Added taskkill invocation before port 5175 socket check so orphaned backend processes never block updates.
- [x] Task 4: Compile bundle (`dist-pkg/server.cjs`) and Node SEA (`dist/PharmacyBackend.exe`)
  - Completed: Built `dist-pkg/server.cjs` and injected Node SEA blob into `dist/PharmacyBackend.exe`.
- [x] Task 5: Verify migration v84 applies cleanly and fast-boot is restored
  - Completed: Live verified on production database `G:\AI Pharmacy OS\data\app.db`, stamped `schema_version = 84`, and verified `/api/health` returned `status: ok`.
- [x] Task 6: Run `npm run guardrails` and `node scripts/quick-update.mjs`
