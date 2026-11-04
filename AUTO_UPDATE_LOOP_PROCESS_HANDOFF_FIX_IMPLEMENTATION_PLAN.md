# Implementation Plan: Fix Auto-Update Loop, Process Handoff & Failure Purging

**Plan File:** `AUTO_UPDATE_LOOP_PROCESS_HANDOFF_FIX_IMPLEMENTATION_PLAN.md`  
**Status:** Completed & Verified (Zero-Bugs Gate Passed)

## Tasks & Execution Steps

- [x] **Task 1: Process Decoupling via `launch-update.bat` with `cmd.exe /c start` (`src/services/autoUpdateService.ts`)**
  - Consolidated updater launching in `applyUpdate` through `launch-update.bat`.
  - When `hasGui` is true, configured `launch-update.bat` to run `powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${guiPath}" ...`.
  - Spawned `launch-update.bat` using `cmd.exe /c start "AI Pharmacy OS — Updating to v${targetVersion}" cmd.exe /c launcherBat`, creating an independent, fully decoupled top-level Windows process.

- [x] **Task 2: Exempt `APPLY_UPDATE` from Tree-Kill in `src/server.ts`**
  - Added `if (signal !== 'APPLY_UPDATE')` guards in `src/server.ts:gracefulShutdown` around both watchdog and final Windows `taskkill /t /f` calls.
  - Allowed the updater script (`UpdateGUI.ps1` / `Updater.bat`), which owns `update.lock` and has dedicated retry handles, to terminate `PharmacyOS.exe` and `PharmacyBackend.exe` cleanly without being killed itself.

- [x] **Task 3: Failed Staged ZIP Purge on Boot & Rollback (`src/services/autoUpdateService.ts` & `UpdateGUI.ps1`)**
  - In `autoUpdateService.ts:checkFailedUpdate()`, added logic to purge matching `AI-Pharmacy-OS-Update-v*.zip` and `AI-Pharmacy-OS-Portable-Setup-v*.exe` when `failure.json` or `rollback.json` is detected.
  - In `packaging/UpdateGUI.ps1:Rollback-Update` and `packaging/Updater.bat:ROLLBACK`, added deletion of the staged package on rollback.
  - Synchronized updated `UpdateGUI.ps1` and `Updater.bat` to `G:\AI Pharmacy OS\`.
  - Removed stale `AI-Pharmacy-OS-Update-v0.1.210.zip` from `G:\AI Pharmacy OS\updates\staging\`.

- [x] **Task 4: Zero-Bugs Gate & Verification**
  - Ran `npm test -- tests/autoUpdateVersionGate.test.ts` (9/9 tests pass).
  - Ran `npx tsc --noEmit` (clean compilation, 0 errors).
  - Ran `npm run guardrails` (0 violations).
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
  - Updated `SMALL_BUG_FIX_PLAN.md` with entry for P2-124.
