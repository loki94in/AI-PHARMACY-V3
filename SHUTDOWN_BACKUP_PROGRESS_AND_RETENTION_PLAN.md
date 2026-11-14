# Implementation Plan: On-Screen Shutdown Backup Progress & Storage Retention Fix

## Problem Summary
1. **Uncompressed 506 MB `.db` files left behind on every shutdown:**
   - Active database is ~420 MB (286,500 medicines, FTS5 indexes, 143k stock ledger entries).
   - `src/server.ts` has a hard 3.5s timeout on shutdown backup.
   - When the window closes or user exits, the backup times out, Node calls `process.exit(0)`, and the uncompressed clone (`app_backup_*.db`) is never unlinked, littering 506 MB files and swelling the folder to 4.32 GB.
2. **More than 20 backup files accumulating:**
   - `enforceRetention()` is at the end of `createBackup()`. Because shutdown backups time out, retention enforcement is never executed.
   - Retention is never triggered during startup/boot.
   - `listBackups()` counts both `.db` and `.db.gz` as separate entries.
3. **Missing Visual Feedback / UI Progress on Shutdown:**
   - Currently, clicking Exit or the window "X" closes the window immediately without showing progress.
   - User wants an on-screen modal showing real-time 0–100% progress during database cloning and compression, followed by a "Backup Completed: <filename>" popup, before the window closes cleanly.

---

## Architectural Design & Contract Invariants (Elephant Perspective)
1. **Human-in-the-Loop & Clear Visibility (Rule 6):**
   - User initiates Exit via the Sidebar "Exit App" button or window close button.
   - UI presents the Shutdown Progress modal directly on screen.
   - Modal displays live progress (0% → 100%) via SSE (`shutdown_progress`).
   - When backup finishes, modal shows success with backup name and file size, then cleanly shuts down and exits.
2. **No Orphaned Temp Files:**
   - Streaming gzip with progress tracking.
   - Immediate unlinking of uncompressed clone `tempDbPath` in `finally`.
   - On server startup (`initBackupScheduler()`), automatically run an orphan sweep to remove any lingering uncompressed `.db` / `.db-journal` files older than 10 minutes.
3. **Strict 20-Backup Retention Limit:**
   - Prune total backups down to `MAX_BACKUPS = 20` on startup and on every completed backup.
   - Deduplicate `.db` and `.db.gz` of the same timestamp so aborted partials don't occupy slots.
4. **Performance Guardrails Compliance:**
   - No CPU-heavy CSS animations (semantic tokens only, standard loaders).
   - No breaking changes to existing routes or Electron single-instance lock.

---

## Detailed Step-by-Step Execution Plan (Goldfish Perspective)

### Step 1: Backup Progress Event Streaming & Enhanced Compression
* **File:** `src/services/backupService.ts`
* Add real-time progress callbacks to `createBackup()`:
  - Phase 1: SQLite cloning progress (0% → 30%) using `tempDb.backup(tempDbPath, { progress({ totalPages, remainingPages }) { ... } })`.
  - Phase 2: Gzip compression progress (30% → 95%) by reading `fs.createReadStream(tempDbPath)` tracking `bytesRead / totalBytes`.
  - Phase 3: Retention cleanup (95% → 100%).
* Emit SSE events via `eventService.emit('server_event', { type: 'shutdown_progress', payload: { stage, percent, filename, sizeBytes } })`.
* Ensure `finally` block unlinks `tempDbPath` reliably.

### Step 2: Startup Orphan Sweep & Unified Retention
* **File:** `src/services/backupService.ts`
* Enhance `enforceRetention()`:
  - Delete any uncompressed `app_backup_*.db` and `*.db-journal` files older than 10 minutes.
  - Delete any uncompressed `.db` files that already have a `.db.gz` counterpart.
  - Clean up any old uncompressed pre-migration snapshots.
  - Strictly enforce `MAX_BACKUPS = 20` (delete oldest beyond 20).
* Call `enforceRetention()` at app boot inside `initBackupScheduler()`.

### Step 3: Frontend Shutdown & Backup Progress Modal
* **File:** `frontend/src/components/Layout.tsx` (and `ExitAppModal`)
* Replace the brief exiting spinner with a dedicated `ShutdownProgressModal`:
  - Shows progress bar (0% to 100%) with status message ("Cloning active database...", "Compressing backup archive...", "Finalizing retention...").
  - On 100% completion: displays a success card with backup filename, compressed size (e.g. "24.2 MB"), and a green checkmark.
  - Waits 1.2s for user visibility, then triggers `window.close()` / finishes exit.
* Subscribe to `sse-shutdown-progress` via SSE event dispatcher in `useGlobalSseInvalidation.ts`.

### Step 4: Electron Window Close Interception
* **File:** `electron/main.ts`
* In `mainWindow.on('close', (e) => { ... })`:
  - If shutdown has not completed, prevent immediate window destroy (`e.preventDefault()`).
  - Notify the renderer window (`mainWindow.webContents.send('trigger-app-exit')`) to display the on-screen progress modal and execute the clean backup & shutdown sequence.
  - Once backend indicates shutdown is complete, allow the window to close and call `app.quit()`.

### Step 5: Verification & Immediate Disk Cleanup
* Trigger the startup retention sweep to immediately clean up the 8 orphaned `.db` files and prune down to 20 backups (reclaiming ~3.8 GB of disk space).
* Test the complete shutdown flow: verify progress bar 0% → 100%, success card, clean window exit, and verify that NO uncompressed `.db` files remain.
* Run `npm run guardrails` to ensure zero performance regressions.

---

## Tasks & Progress Tracking

- [x] Task 1: Add progress reporting and stream tracking to `createBackup()` in `src/services/backupService.ts`
  - *Completed*: Integrated `Database.backup()` progress callback for SQLite cloning (0-30%), streaming gzip compression tracking (30-90%), retention pruning (90-95%), and final completion event with filename and size via SSE.
- [x] Task 2: Implement startup orphan purge and strict 20-file retention in `src/services/backupService.ts`
  - *Completed*: Prunes all orphaned `.db` files older than 5m and companion `.db-journal` files. Runs automatically on startup in `initBackupScheduler()`. Enforces strict 20-backup limit. Reclaimed ~3.6 GB disk space.
- [x] Task 3: Build on-screen shutdown progress modal with 0–100% progress and completed popup in `frontend/src/components/Layout.tsx`
  - *Completed*: Created full-screen overlay with dynamic progress bar (0% to 100%), live stage descriptions, and success card displaying backup filename, file size, and checkmark.
- [x] Task 4: Hook Electron window close event in `electron/main.ts` to trigger progress modal before closing
  - *Completed*: Intercepted `mainWindow.on('close')` to trigger `app-request-exit` in renderer and allow clean close only after `window.__AI_PHARMACY_CLEAN_EXIT__` is set. Extended `GRACE_MS` to 25s.
- [x] Task 5: Verify backup generation, disk space reclamation, and run `npm run guardrails`
  - *Completed*: Verified test backup streamed all SSE events, deleted uncompressed temp `.db`, kept exactly 20 backups, passed `npm run guardrails` and `tsc --noEmit`, updated knowledge graph via `quick-update.mjs`.
