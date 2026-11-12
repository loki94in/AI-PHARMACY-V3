# DESKTOP SHORTCUT APP ICON REFRESH IMPLEMENTATION PLAN

## Objective
Ensure the new application icon (`packaging/app.ico`) is packaged into all update zips, extracted to `{installDir}\app.ico`, bound to the desktop shortcut (`AI Pharmacy.lnk`), and the Windows Explorer icon cache is automatically refreshed so the new launcher icon appears immediately on user PCs.

---

## Architectural Changes & Root Cause Fixes

### 1. `scripts/build-update-package.mjs`
- Add `{ src: path.join(root, 'packaging', 'app.ico'), zipEntry: 'app.ico' }` to `UPDATE_SOURCES`.
- Ensures every update package contains the latest `app.ico` and extracts it into the application root directory.

### 2. `packaging/UpdateGUI.ps1` & `packaging/Updater.bat`
- After extracting the update zip into `$InstallDir`:
  - Locate `AI Pharmacy.lnk` on the user's Desktop and Public Desktop.
  - Re-point `IconLocation` to `$InstallDir\app.ico,0` and save.
  - Trigger `ie4uinit.exe -show` to flush the Windows Explorer icon cache immediately.

### 3. `src/server.ts`
- On Windows startup in packaged desktop mode:
  - Check if `AI Pharmacy.lnk` exists on the desktop.
  - Ensure its icon is pointing to the current `app.ico` and notify the shell if needed.

---

## Task Progress Tracker

- [x] Task 1: Add `packaging/app.ico` to `UPDATE_SOURCES` in `scripts/build-update-package.mjs`.
  - *Completed*: Added `app.ico` to `UPDATE_SOURCES` so it is extracted to `$InstallDir\app.ico` during every background update.
- [x] Task 2: Add shortcut icon update and shell icon cache refresh to `packaging/UpdateGUI.ps1`.
  - *Completed*: Auto-updates desktop shortcut `AI Pharmacy.lnk` to point to the new `app.ico` and triggers `ie4uinit.exe -show`.
- [x] Task 3: Add shortcut icon update and shell icon cache refresh to `packaging/Updater.bat`.
  - *Completed*: Added PowerShell command to update shortcut and trigger shell icon refresh in fallback bat updater.
- [x] Task 4: Add startup shortcut icon reconciliation to `src/server.ts`.
  - *Completed*: Added non-blocking deferred check (T+5s) on Windows startup to ensure desktop shortcut reflects the updated icon.
- [x] Task 5: Verify with `npm run guardrails` and update knowledge graph.
  - *Completed*: Guardrails passed (0 violations), TypeScript clean.

---
