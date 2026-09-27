# Implementation Plan: Transaction Collision & Mutex Deadlock Elimination

> **File:** `TRANSACTION_COLLISION_AND_MUTEX_DEADLOCK_FIX_PLAN.md`  
> **Status:** Completed  
> **Target:** Fix `SQLITE_ERROR: cannot start a transaction within a transaction` across `VerificationService`, `MedicineSalesMetricsService`, and background workers.

---

## 1. Problem Summary & Root Causes

### Symptoms
1. `[MedicineSalesMetrics] Initial backfill failed: [Error: SQLITE_ERROR: cannot start a transaction within a transaction]`
2. `[VerificationService] Database health check crashed: [Error: SQLITE_ERROR: cannot start a transaction within a transaction]`
3. `Live cart details fetch error in summary route: The operation was aborted due to timeout`
4. Periodic health check crashes repeating indefinitely in the dev server.

### Root Causes
1. **`txPhase` classification defect in `src/database/connection.ts`**:
   The check `trimmed === 'COMMIT'` required exact string equality. Any statement using `COMMIT;` (semicolon), `COMMIT TRANSACTION`, `COMMIT TRANSACTION;`, `END`, or `END TRANSACTION` returned `phase: null`, bypassing `releaseIfHeld()`. As a result, the transaction committed in SQLite, but the JS mutex remained locked (`isTxLocked = true`), blocking all subsequent transactions for 60 seconds until the watchdog timer expired.
2. **Watchdog timeout without SQLite rollback**:
   When the 60s transaction watchdog fired in `connection.ts`, it forcibly released the JS mutex (`this.releaseTxLock()`) without issuing `ROLLBACK` to the underlying SQLite database. If a transaction was abandoned or stalled, SQLite remained in an uncommitted transaction state (`db->autoCommit === 0`). The next caller to acquire the lock immediately issued `BEGIN`, causing SQLite to throw `SQLITE_ERROR: cannot start a transaction within a transaction`.
3. **No self-healing of orphaned transactions on `BEGIN`**:
   When SQLite rejected `BEGIN` with `cannot start a transaction within a transaction`, the interceptor simply released the JS mutex and re-threw the error. SQLite remained stuck in the orphan transaction forever, permanently poisoning the connection so that *every* subsequent transaction failed.
4. **Nested / Reentrant transaction mutex deadlock**:
   When code already inside a transaction called a helper function that also issued `BEGIN` (e.g. `syncDistributorPhoneAcrossTables`, refill updates, etc.), the inner `BEGIN` waited on the mutex held by the outer caller. This created an asynchronous deadlock for 60 seconds until the watchdog expired.
5. **Unprotected `BEGIN` calls in services**:
   In `verificationService.ts` line 88 and `medicineSalesMetricsService.ts` line 203, `await db.run('BEGIN...')` was placed outside the `try ... finally / catch` blocks. If `BEGIN` threw an error or hit an orphan state, the cleanup `ROLLBACK` was never executed.

---

## 2. Step-by-Step Task Checklist

- [x] **Task 1: Comprehensive Transaction Interceptor & Auto-Healing in `src/database/connection.ts`**
  - Implemented sanitized SQL trimming and detection for `BEGIN`, `COMMIT`, `ROLLBACK`, `END`, and trailing semicolon variants.
  - Implemented `txDepth` tracking with reentrant nested transactions via SQLite `SAVEPOINT` (`sp_<depth>`).
  - Updated 60s watchdog in `acquireTxLock` and `releaseTxLock` to force a physical SQLite `ROLLBACK` via `rollbackUnderlying()` before resetting mutex flags.
  - Added orphan self-healing in `db.run`: if `BEGIN` encounters `cannot start a transaction within a transaction`, it automatically rolls back the orphan transaction on `_rawRun` and transparently retries `BEGIN`.
  - Added safe suppression for spurious `ROLLBACK` when `txDepth === 0` to prevent accidental lock stealing.
  - Added atomic lock scoping in `db.exec` for multi-statement transaction scripts.

- [x] **Task 2: Transaction Safety Hardening in `src/services/verificationService.ts`**
  - Wrapped `BEGIN TRANSACTION` inside `try` block with guaranteed cleanup in `finally { await db.run('ROLLBACK').catch(() => {}); }`.

- [x] **Task 3: Transaction Safety Hardening in `src/services/medicineSalesMetricsService.ts`**
  - Moved `BEGIN IMMEDIATE TRANSACTION /* BACKGROUND */` inside `try` block in `reconcileAllMedicineSalesMetrics` with safe `ROLLBACK` in catch.

- [x] **Task 4: Transaction Safety Hardening in `src/worker/catalogWorker.ts` and `src/routes/migration.ts`**
  - Wrapped batch operations in `try { ... await db.run('COMMIT'); } catch (err) { await db.run('ROLLBACK').catch(() => {}); throw err; }`.

- [x] **Task 5: Verification & Quality Assurance**
  - Executed `scratch/verify_final.mjs` verifying:
    1. Semicolon commits (`COMMIT;`) properly release mutex.
    2. Explicit commit variants (`COMMIT TRANSACTION`) properly release mutex.
    3. Reentrant/nested transactions convert to savepoints (`SAVEPOINT sp_2`) without mutex deadlocks.
    4. Multi-statement self-contained scripts in `db.exec` execute atomically.
    5. Orphan transactions auto-healed on `BEGIN`.
    6. Spurious `ROLLBACK` outside transactions safely handled without errors.
  - Executed `scratch/test_verification_health.mjs` confirming `verificationService.verifyDatabaseHealth()` succeeds with `{ success: true, layer: 'Database', message: 'Database Health & Integrity Checks passed successfully.' }`.
  - Verified `npm run guardrails` passes with 0 violations.
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
  - Updated `SMALL_BUG_FIX_PLAN.md` with entry `[Fixed] P2-48`.

---
