# CLEAN APP EXIT AND WINDOW SHUTDOWN IMPLEMENTATION PLAN

## Objective
Ensure that clicking "Shut Down & Exit" / "Exit App" cleanly terminates both the backend server process (`PharmacyBackend.exe`) AND the frontend native desktop window (`PharmacyOS.exe`), eliminating stuck windows, non-functional `window.close()` buttons, and blank blue screens.

---

## Architectural Changes & Root Cause Fixes

### 1. `src/utils/chromeBrowser.ts` (`closeAppBrowser`)
- Add `PharmacyOS.exe` and `PharmacyBackend.exe` to process search patterns in PowerShell script and process kill logic.
- Ensure that closing the app browser window forcefully and cleanly terminates `PharmacyOS.exe` so the window disappears immediately at Step 1 of shutdown.

### 2. `src/server.ts` (`gracefulShutdown`)
- In lines 1286-1293 (watchdog) and lines 1439-1449 (final Windows exit):
  - Do NOT only target `pid` when `isPackagedApp()` is true.
  - When `process.ppid` exists and is positive, also kill `process.ppid` with `taskkill /pid ${ppid} /t /f`.
  - Also ensure `taskkill /im PharmacyOS.exe /f` is executed as safety sweep so no orphan window is left behind.

### 3. `src-tauri/src/main.rs`
- In `setup()`:
  - After navigating the webview window to the backend URL, spawn a lightweight background watcher thread that monitors the spawned `PharmacyBackend.exe` child process.
  - When `PharmacyBackend.exe` exits (or is killed via shutdown), the watcher invokes `app_handle.exit(0)`, closing the native window automatically.

### 4. `frontend/src/components/Layout.tsx`
- In `ExitAppButton`:
  - When `handleConfirmExit` runs, it sends `api.shutdownSystem()` to trigger backend shutdown.
  - If running in Tauri/desktop or browser, provide immediate clean exit feedback and prevent lingering on stuck screen.

---

## Task Progress Tracker

- [x] Task 1: Update `src/utils/chromeBrowser.ts` to include `PharmacyOS.exe` in `closeAppBrowser`.
  - *Completed*: Added `PharmacyOS` process and command line matching in PowerShell and taskkill logic so the native window closes cleanly.
- [x] Task 2: Update `src/server.ts` `gracefulShutdown` to terminate `PharmacyOS.exe` and `process.ppid`.
  - *Completed*: Watchdog and exit handler both target `process.ppid` and `PharmacyOS.exe`, ensuring child-to-parent process termination.
- [x] Task 3: Update `src-tauri/src/main.rs` to monitor backend exit and exit `PharmacyOS.exe` automatically.
  - *Completed*: Added background watchdog thread monitoring `child.wait()`. When backend terminates cleanly, `PharmacyOS.exe` exits automatically.
- [x] Task 4: Recompile Tauri shell (`PharmacyOS.exe`) and test compilation.
  - *Completed*: Compiled release binary with Cargo and updated `dist/PharmacyOS.exe`.
- [x] Task 5: Run `npm run guardrails` and update knowledge graph (`node scripts/quick-update.mjs`).
  - *Completed*: Guardrails passed (0 violations), TypeScript clean.

---
