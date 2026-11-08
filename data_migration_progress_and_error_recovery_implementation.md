# Data Migration Live Progress & Auto-Update Conflict Prevention Implementation Plan

## 1. Problem Summary & Root Cause Analysis

### Symptoms
1. **Migration Progress Frozen at 0%**: When clicking "Run Auto Migration", the modal opened showing "Writing to Staging Database", "Starting migration...", and "0% Completed". Even though the backend was actively processing hundreds of thousands of records (Pass 1, Pass 2, Pass 3), the frontend UI remained at 0%.
2. **App Abruptly Restarted / Failed**: At 17:57:58, while Pass 3 was actively executing, an automated update (`APPLY_UPDATE` for v0.1.227) triggered an instant shutdown and restart of `PharmacyOS.exe`, killing the running worker and corrupting the migration staging session.
3. **Backup Panel Replaced by Red Error Screen**: When clicking "Run Auto Migration" while a migration was active or when restarting, a 409 Conflict ("A migration is already in progress") caused `LocalBackupPanel.tsx` to unmount the entire backup list and display a red `Backup Scanner Error` card.

---

### Verified Root Causes
1. **SSE Envelope Unpacking Mismatch in `useGlobalSseInvalidation.ts` & `ReviewModal.tsx`**:
   - Backend broadcasts `eventService.broadcast('migration_update', { ...migrationStatus })`.
   - SSE stream sends `{"type":"migration_update","payload":{"active":true,"progress":50,"message":"...","isStagingReady":false}}`.
   - `useGlobalSseInvalidation.ts` dispatches `sse-migration-update` with `detail: parsed` (the entire envelope containing `{ type, payload }`), rather than unpacking `payload`.
   - `ReviewModal.tsx` directly reads `detail.progress`, `detail.message`, and `detail.isStagingReady`, which are all `undefined`!
   - Consequently, `status.progress` was `undefined` (rendered as `0% Completed`), `status.message` was `undefined` (rendered as `'Processing rows...'`), and `detail.isStagingReady` was `undefined`, permanently blocking completion transition to the staging review screen.

2. **Zero Migration Guard on System Updates (`src/server.ts` & `autoUpdateService.ts`)**:
   - `POST /api/system/apply-update` did not check `migrationStatus.active`.
   - When an update was downloaded and triggered, the server immediately executed `gracefulShutdown('APPLY_UPDATE')`, force-closing the Electron window and killing the migration worker mid-transaction.
   - `UpdateBanner.tsx` and the update service allowed update installations while heavy database operations were executing.

3. **Destructive Error State in `LocalBackupPanel.tsx`**:
   - `const error = queryError?.message || actionError;` in `LocalBackupPanel.tsx` unmounted the backup list and rendered an error block whenever `actionError` occurred.
   - If a migration was already running, a 409 response destroyed the backup list instead of showing a non-blocking toast or opening the running migration modal.

4. **Missing Latch-On in `ReviewModal.tsx`**:
   - If `runMigration` or `runLocalBackupMigration` returned 409 because a migration was already active, `ReviewModal.tsx` marked `phase = 'error'` with "Failed to start import: A migration is already in progress", instead of latching onto the running job and tracking its live progress.

---

## 2. Proposed Architecture & Surgical Changes

### Change 1: Robust SSE Payload Unpacking & Normalization
- **File**: `frontend/src/hooks/useGlobalSseInvalidation.ts`
  - Ensure `sse-migration-update` dispatches the inner `parsed.payload || parsed`.
- **File**: `frontend/src/pages/Migration/components/ReviewModal.tsx`
  - In `onSseUpdate`, defensibly normalize:
    ```typescript
    const raw = (e as CustomEvent).detail;
    const liveStatus: LocalMigrationStatus = raw?.payload || raw;
    ```
  - Bind `liveStatus.progress`, `liveStatus.message`, `liveStatus.isStagingReady`, and `liveStatus.errorCount` safely.
  - Automatically latch onto active migration when modal opens if backend reports `active: true`.

### Change 2: Auto-Update Safety Locks During Active Migration
- **File**: `src/server.ts`
  - In `/api/system/apply-update`, check `migrationStatus.active`. If active, reject with HTTP 409:
    `{ success: false, error: 'Cannot apply update while a database migration is in progress. Please wait for migration to complete.' }`.
- **File**: `src/services/autoUpdateService.ts`
  - In `applyUpdate()`, verify migration is not active.
- **File**: `frontend/src/components/UpdateBanner.tsx`
  - Disable "Install & Restart" button and show tooltip when migration is active.

### Change 3: Resilient `LocalBackupPanel.tsx` Error Handling
- **File**: `frontend/src/pages/Migration/components/LocalBackupPanel.tsx`
  - Keep `actionError` as a non-destructive toast or inline banner; do NOT replace the list of backups (`backups.map(...)`).
  - If error is 409 ("A migration is already in progress"), open the `ReviewModal` in `importing` phase so the user can immediately observe the running progress instead of showing an error.

### Change 4: Graceful 409 Recovery in `ReviewModal.tsx`
- **File**: `frontend/src/pages/Migration/components/ReviewModal.tsx`
  - In `handleStartImport`: if error response status is 409, do not set `phase = 'error'`. Instead, query `api.getMigrationStatus()`, update `status`, and keep `phase = 'importing'` so the user is seamlessly connected to the active background migration.

---

## 3. Step-by-Step Execution Plan

### Step 1: Frontend SSE & Progress Fixes
- [x] Edit `frontend/src/hooks/useGlobalSseInvalidation.ts` to unwrap `payload` for `sse-migration-update`.
- [x] Edit `frontend/src/pages/Migration/components/ReviewModal.tsx` to handle both raw and payload-wrapped SSE frames, latch onto active migration, and avoid 409 failures.

### Step 2: Local Backup Panel UX Resilience
- [x] Edit `frontend/src/pages/Migration/components/LocalBackupPanel.tsx` so `actionError` shows a dismissible banner while keeping the list of backups accessible.
- [x] Automatically open the progress modal if a backup migration is already running (HTTP 409).

### Step 3: Backend Auto-Update Safety Gate
- [x] Edit `src/server.ts` `/api/system/apply-update` route to block restarts while `migrationStatus.active` is true.
- [x] Edit `src/services/autoUpdateService.ts` to enforce the same check.

### Step 4: Verification & Performance Guardrails
- [x] Run `npm run guardrails` to verify zero violations of DOX / performance rules (PASS).
- [x] Run `npm --prefix frontend run build` to ensure clean TypeScript compilation & bundle production (PASS, built in 52s).
- [x] Run `node scripts/quick-update.mjs` to keep knowledge graph in sync.

---

## 4. Completed Work Verification Summary

1. **`useGlobalSseInvalidation.ts`**: Included `sse-migration-update` in the payload unwrapper so consumers receive clean `LocalMigrationStatus` objects.
2. **`ReviewModal.tsx`**: Defensively normalized `raw?.payload || raw` in both SSE and REST paths. In `handleStartImport`, caught 409 conflict responses and seamlessly latched onto active background migrations without triggering an error screen.
3. **`LocalBackupPanel.tsx`**: Isolated scanning errors from single backup run errors. Single run failures display as an inline dismissible banner while keeping the list of backups intact. 409 conflict automatically opens `ReviewModal` to watch live progress.
4. **`src/server.ts` & `src/services/autoUpdateService.ts`**: Hardened `/api/system/apply-update` with an active migration gate returning HTTP 409 to block accidental or background restarts during database migrations.
5. **Guardrails**: Passed `npm run guardrails` with 0 violations and successfully built production frontend bundle.


