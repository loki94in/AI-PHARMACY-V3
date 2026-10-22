# Implementation Plan: Fix Update Installation Freeze/Hang & Execute Production Release (v0.1.146)

## 1. Root Cause Analysis

When a user clicks "Install & Restart" or "Install Now" on an update that is ready to install, the application appeared to freeze or hang. Investigation revealed four distinct causes:

### Factor 1: Electron UI Window Not Closed on Backend Shutdown
- When the frontend calls `POST /api/system/apply-update`, `autoUpdateService.applyUpdate()` spawns `packaging/Updater.bat` and schedules `gracefulShutdown('APPLY_UPDATE')` after 600ms.
- In `src/server.ts`, `gracefulShutdown` calls `closeAppBrowser()`.
- However, `closeAppBrowser()` in `src/utils/chromeBrowser.ts` specifically targets Chrome and Edge processes (`$_.Name -match 'chrome|msedge|GoogleChromePortable'`).
- In packaged Electron desktop mode, the parent wrapper process is `PharmacyOS.exe`. Because it was not targeted by `closeAppBrowser()`, the Electron window remained open on the user's screen.
- As the backend shut down, frontend network requests timed out, leaving the UI with a spinning/disabled button and looking frozen.

### Factor 2: `Updater.bat` 20-Second Wait Loop
- In `packaging/Updater.bat` lines 84–97:
  ```bat
  :WAIT_LOOP
      tasklist /FI "IMAGENAME eq PharmacyOS.exe" ...
      set /a WAIT_COUNT+=1
      if !WAIT_COUNT! GEQ 20 (
          call :LOG "PharmacyOS.exe still running after 10s. Using taskkill as fallback..."
          taskkill /F /IM PharmacyOS.exe >nul 2>&1
          timeout /t 2 /nobreak >nul
          goto :WAIT_DONE
      )
      timeout /t 1 /nobreak >nul
      goto :WAIT_LOOP
  ```
- Because `PharmacyOS.exe` was never terminated by the backend, `Updater.bat` waited **20 consecutive seconds** (with 1-second sleeps) before finally invoking `taskkill`. This caused a guaranteed 20+ second freeze delay before any update action occurred.

### Factor 3: Blocking `pause` Statements in `Updater.bat`
- `packaging/Updater.bat` contained 7 `pause` statements on error/fallback branches (lines 31, 32, 70, 119, 148, 191, 201).
- In automated execution, `pause` waits indefinitely for standard input ("Press any key to continue . . ."). If the console window is behind other windows or minimized, the installer remains completely frozen forever.

### Factor 4: `PharmacyBackend.exe` Not Checked in `Updater.bat`
- `Updater.bat` only checked for `PharmacyOS.exe`, but not `PharmacyBackend.exe`. If the backend process was finishing database checkpointing when extraction started, open file handles could cause extraction or file replacement errors.

---

## 2. Proposed Changes & Architecture

### Component 1: Immediate Electron Window Dismissal (`src/server.ts`)
- In `gracefulShutdown(signal)`:
  When `signal === 'APPLY_UPDATE'` and `process.platform === 'win32'`, immediately spawn a detached process:
  ```ts
  spawn('cmd.exe', ['/c', 'taskkill /F /T /IM PharmacyOS.exe'], { detached: true, stdio: 'ignore' }).unref();
  ```
- This terminates `PharmacyOS.exe` within 50ms of the user clicking "Install & Restart", immediately dismissing the window so the user sees seamless handoff to the updater console.

### Component 2: Instant Process Termination & Non-Blocking Loops in `packaging/Updater.bat`
1. **Reduce Wait to 2 Seconds & Monitor Both Executables**:
   - Check if either `PharmacyOS.exe` or `PharmacyBackend.exe` is running.
   - If still running after 2 seconds (`WAIT_COUNT GEQ 2`), immediately force-terminate both:
     ```bat
     taskkill /F /T /IM PharmacyOS.exe >nul 2>&1
     taskkill /F /T /IM PharmacyBackend.exe >nul 2>&1
     ```
2. **Eliminate All `pause` Calls**:
   - Replace every `pause` statement with `timeout /t 3 /nobreak >nul` so errors are logged, visible briefly, and execution cleanly exits or rolls back without hanging.

### Component 3: Performance Guardrails & Release Execution
1. Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
2. Commit and push changes to GitHub.
3. Run `npm run release` to automatically:
   - Bump version to `v0.1.146` in `package.json`.
   - Build client and node binaries.
   - Bundle `dist/installer/AI-Pharmacy-OS-Update-v0.1.146.zip` with the new `packaging/Updater.bat`.
   - Publish GitHub Release and update Vercel KV with SHA-256.
4. Verify update detection endpoint `https://website-woad-seven-26.vercel.app/api/updates/check`.
5. Run `node scripts/quick-update.mjs`.

---

## 3. Human-in-the-Loop Workflow (Rule 6)

- The pharmacist clicks **"Install & Restart"** from the banner or Settings.
- The UI window dismisses immediately without freeze or spinning hang.
- The dedicated updater progress console appears, verifies checksum, creates a safety backup, extracts files, and automatically restarts into the updated version within seconds.
- If anything fails, rollback executes automatically and restores the previous working version.

---

## 4. Verification Plan

1. **Static Analysis & Guardrails**:
   - `npm run guardrails` must pass with exit code 0.
2. **Build & Release**:
   - `npm run release` succeeds with installer, update zip, and mobile APK uploaded.
3. **Endpoint Verification**:
   - `https://website-woad-seven-26.vercel.app/api/updates/check?version=0.1.145` returns:
     - `hasUpdate: true`
     - `latestVersion: "0.1.146"`
     - Valid `sha256` matching the packaged zip.
4. **Knowledge Graph Sync**:
   - `node scripts/quick-update.mjs` completes in <30s.

---

## 5. Tasks & Progress Tracking

- [x] Task 1: Update `src/server.ts` to dismiss `PharmacyOS.exe` immediately during `APPLY_UPDATE` shutdown.
  - *Completed*: Added immediate detached `taskkill /F /T /IM PharmacyOS.exe` call when `signal === 'APPLY_UPDATE'` on Windows so the UI window is dismissed within milliseconds instead of leaving a frozen screen.
- [x] Task 2: Refactor `packaging/Updater.bat` to eliminate the 20-second wait loop, check both `PharmacyOS.exe` and `PharmacyBackend.exe`, and replace all blocking `pause` statements.
  - *Completed*: Lowered wait loop from 20s to 2s, checking both `PharmacyOS.exe` and `PharmacyBackend.exe` and terminating them with `/F /T /IM`. Replaced all 7 blocking `pause` statements with `timeout /t 3 /nobreak >nul`.
- [x] Task 3: Run `npm run guardrails` and verify TypeScript compilation and zero rule violations.
  - *Completed*: `tsc --noEmit` and performance guardrails scanner passed with 0 errors/violations.
- [x] Task 4: Commit and push changes to GitHub.
  - *Completed*: Committed `src/server.ts`, `packaging/Updater.bat`, and `implementation.md` with commit message `fix(updater): eliminate install freeze with instant window handoff and 2s process termination` and pushed to `main`.
- [x] Task 5: Execute production release (`npm run release`) to publish `v0.1.146`.
  - *Completed*: Ran `npm run release`. Generated single-executable application `PharmacyOS.exe`, compiled Inno Setup installer `AI-Pharmacy-OS-Portable-Setup-v0.1.146.exe` (983.6 MB), generated update archive `AI-Pharmacy-OS-Update-v0.1.146.zip` (105.4 MB), and uploaded all assets + companion APK to GitHub Release `v0.1.146` (ID: 421056301). Updated Vercel Upstash KV with SHA-256 `bb8860deb3e2754553ae98ad95afe5da09e4d9781052430623456ec8116cc41d`.
- [x] Task 6: Verify remote update endpoint and run `node scripts/quick-update.mjs`.
  - *Completed*: Queried `https://website-woad-seven-26.vercel.app/api/updates/check?version=0.1.145`. Verified live response returns `hasUpdate: true`, `latestVersion: "0.1.146"`, matching package URL and SHA-256. Updated knowledge graph via `node scripts/quick-update.mjs`.

