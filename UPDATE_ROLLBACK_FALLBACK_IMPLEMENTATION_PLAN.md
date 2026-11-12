# Update Rollback & Old-Version Restart Fallback Implementation Plan

## Goal
Ensure that whenever an app update fails — either **during ZIP/Setup installation** OR **immediately after installation when the new version fails to boot** — the installer/watchdog cleanly restores the complete previous version and restarts it without leaving missing, mismatched, or nested files.

## Root Causes Identified
1. **Incomplete Backup/Rollback File List (`packaging/UpdateGUI.ps1`, `packaging/Updater.bat`)**: `WebView2Loader.dll` and `frontend\dist` are included in update ZIPs (`scripts/build-update-package.mjs`) but were omitted from `preupdate-*` backups and rollback restore.
2. **PowerShell Directory Nesting Bug (`packaging/UpdateGUI.ps1`)**: `Copy-Item ... "dist-pkg" -Destination "...\dist-pkg" -Recurse -Force` nests into `dist-pkg\dist-pkg` (and `resources\app\app`) when the destination folder already exists, leaving broken/new files in place.
3. **Silent Copy Failures & Locked Files (`packaging/UpdateGUI.ps1`)**: `Rollback-Update` used `-ErrorAction SilentlyContinue` without retrying locked files or verifying `PharmacyOS.exe` / `PharmacyBackend.exe` restoration before relaunch.
4. **No Post-Update Boot Watchdog (`src-tauri/src/main.rs`)**: If the new version extracts cleanly (`updates\staging\success.json` written) but crashes on boot (e.g., `PharmacyBackend.exe` exits or `/api/health/ready` fails), `main.rs` never rolls back to `backup\preupdate-*`.
5. **Setup EXE Fallback Lacks Backup/Rollback (`src/services/autoUpdateService.ts`)**: `launch-setup.bat` ran the Setup EXE without a pre-update backup or failure restore.

## Tasks
- [x] **Task 1**: Fixed `packaging/UpdateGUI.ps1` — added `WebView2Loader.dll` and `frontend\dist` (with parent directory creation) to pre-update backups; added `Restore-FileWithRetry` and `Restore-DirectoryFromBackup` (copying `\*` contents so PowerShell never nests `dist-pkg\dist-pkg` or `resources\app\app`); added process kill + retry on file locks, `rollback.json` write, and `PharmacyOS.exe` existence check before relaunching.
- [x] **Task 2**: Fixed `packaging/Updater.bat` — added `WebView2Loader.dll` and `frontend\dist` to both backup and `:ROLLBACK`, plus `taskkill` before restoring files.
- [x] **Task 3**: Added post-update boot watchdog & self-healing rollback in `src-tauri/src/main.rs` — detects `updates\staging\success.json` on boot; if `PharmacyBackend.exe` exits prematurely (`try_wait()`) or `/api/health/ready` times out, spawns detached `updates\staging\boot-rollback.ps1` to restore from newest `backup\preupdate-*`, writes `failure.json`/`rollback.json`, removes `success.json`, and exits so the old `PharmacyOS.exe` is restored and restarted.
- [x] **Task 4**: Hardened Setup EXE fallback in `src/services/autoUpdateService.ts` (`launch-setup.bat`) — backs up `PharmacyOS.exe`, `WebView2Loader.dll`, `PharmacyBackend.exe`, `dist-pkg`, and `frontend\dist` to `backup\preupdate-setup` before running Setup and restores them if Setup exits non-zero or `PharmacyOS.exe` is missing.
- [x] **Task 5**: Verified with PowerShell AST parse (`UpdateGUI.ps1 syntax OK`), `cargo check --manifest-path src-tauri/Cargo.toml` (0 errors), `npm run guardrails` (PASS), and `tests/autoUpdateLifecycleE2E.test.ts` (8/8 passed).
