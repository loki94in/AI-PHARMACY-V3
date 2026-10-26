# Implementation Plan — Fix Auto-Update Download, Process Handoff, and Installation Failure

## Problem Summary & Symptoms
When a developer publishes a new release (e.g. v0.1.164):
1. **Download Stall / Error**: The app failed to download or reported an error banner (`Update check or download failed`) because redirect streams on GitHub assets and network timeouts weren't gracefully handled and surfaced errors without auto-retry recovery.
2. **Premature App Termination**: The app closed prematurely because `gracefulShutdown('APPLY_UPDATE')` in `src/server.ts` ran `taskkill /F /T /IM PharmacyOS.exe` after 600ms, while the updater process was either still starting or waiting for file locks to release.
3. **Command Line Escaping Failure in Windows `spawn`**: In `autoUpdateService.ts`, `spawn('cmd.exe', ['/c', 'start', windowTitle, 'cmd.exe', '/c', fullCommand])` passed nested quotes containing spaces (`"G:\AI Pharmacy OS\Updater.bat"`). Node's Win32 spawn escaped quotes with backslashes (`\"`), which Windows `cmd.exe` cannot parse, causing `cmd.exe` to fail immediately with `'G:\AI' is not recognized as an internal or external command` or `The system cannot find the path specified`.
4. **`ERROR: Input redirection is not supported` in `Updater.bat`**: `packaging/Updater.bat` used `timeout /t 3 /nobreak >nul` across multiple steps. In detached/background execution, Windows `timeout` command crashes immediately because standard input is redirected.
5. **Windows File Lock Collisions on Executables**: Windows takes 1–3 seconds to release file handle locks after process exit. `Updater.bat` immediately attempted `copy /Y PharmacyOS.exe` for backup and extraction, failing with `The process cannot access the file because it is being used by another process`, which triggered a failed rollback and left files incomplete or corrupted.
6. **Inno Setup Silent Fallback Failure**: When falling back to Setup EXE (`AI-Pharmacy-OS-Portable-Setup-*.exe`), `autoUpdateService.ts` launched it `/VERYSILENT` while `PharmacyOS.exe` was still running, causing Setup to fail to overwrite locked binaries.

---

## Root Cause Analysis
- **Root Cause 1 (`src/services/autoUpdateService.ts`)**: The spawn command used raw `cmd.exe /c start` with an array of nested quoted strings. Under Windows, `spawn` turns arguments with quotes into backslash-escaped strings (`\"`), which breaks `cmd.exe`'s command parsing on paths with spaces (`G:\AI Pharmacy OS`).
- **Root Cause 2 (`packaging/Updater.bat`)**:
  - `timeout /t ... >nul` fails under non-interactive shells (`ERROR: Input redirection is not supported`).
  - Broken PID expansion (`%~$PID:0%`).
  - Lack of a retry-sleep loop when replacing `PharmacyOS.exe` and `PharmacyBackend.exe` while Windows releases process locks.
  - Verification check at step 6 fails if `PharmacyOS.exe` was omitted from differential update ZIPs (manifest `includedInZip: false`).
- **Root Cause 3 (`src/server.ts`)**: Hard-killing `PharmacyOS.exe` after 600ms via `gracefulShutdown('APPLY_UPDATE')` before confirming the external updater process has acquired the update lock and taken over the installation lifecycle.
- **Root Cause 4 (`autoUpdateService.ts` download resilience)**: `downloadFile` needs proper HTTP 302/307 redirect chaining with Azure Blob / GitHub asset streaming, verifying `content-length` and connection timeouts, and reporting clear progress so the UI never appears frozen or stuck in an error loop.

---

## Action Plan

### 1. `packaging/Updater.bat`
- Replace all `timeout /t N >nul` with `ping 127.0.0.1 -n (N+1) >nul` (standard non-blocking delay in batch, impervious to input redirection).
- Fix line 78 invalid lock writing (`%~$PID:0%`).
- Add an exclusive file lock check loop before backup and extraction for `PharmacyOS.exe` and `PharmacyBackend.exe`.
- Ensure differential update compatibility (if `PharmacyOS.exe` was unchanged and not in ZIP, preserve existing binary).
- Sync updated `packaging/Updater.bat` to `G:\AI Pharmacy OS\Updater.bat`.

### 2. `src/services/autoUpdateService.ts`
- Fix the updater launch mechanism in `applyUpdate()`:
  - Generate a dedicated `launch-update.bat` in the staging directory with explicit, unescaped batch commands:
    ```bat
    @echo off
    call "<updaterPath>" "<zipPath>" "<installDir>" "<targetVersion>" "<sha256>" "<logPath>"
    ```
  - Launch `launch-update.bat` directly via `cmd.exe /c start "" "<launcherBat>"`.
  - Fix Setup EXE fallback to kill running instances and wait before running installer so binaries are not locked.
- Improve `downloadFile` error handling and auto-retry on stalled socket / network interruption.

### 3. `src/server.ts`
- Extend shutdown grace period in `/api/system/apply-update` to 1200ms to allow launcher to fully detach before backend closes.

### 4. Verification & Guardrails
- Test `launch-update.bat` generation and batch execution with spaces in path.
- Test `Updater.bat` with `<nul` input redirection to verify 0 errors.
- Run `npm run guardrails` and verify exit code 0.
- Update `SMALL_BUG_FIX_PLAN.md` and knowledge graph (`node scripts/quick-update.mjs`).

---

## Completed Tasks Log
- [x] Task 1: Update `packaging/Updater.bat` to eliminate `timeout` crashes, fix lock syntax, and add file lock release wait loops.
- [x] Task 2: Sync updated `packaging/Updater.bat` to `G:\AI Pharmacy OS\Updater.bat`.
- [x] Task 3: Update `src/services/autoUpdateService.ts` with dedicated launcher script generation and robust download error recovery.
- [x] Task 4: Adjust `src/server.ts` apply-update shutdown timing (1200ms grace period).
- [x] Task 5: Test non-interactive updater execution (`call packaging\Updater.bat <nul` exit code 1 clean, zero redirection crashes) and verify `npm run guardrails` (PASS, 0 violations) and test suite `tests/autoUpdateVersionGate.test.ts` (8/8 pass).
- [x] Task 6: Record P2-123 in `SMALL_BUG_FIX_PLAN.md` and refresh knowledge graph.