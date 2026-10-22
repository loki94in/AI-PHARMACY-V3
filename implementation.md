# Implementation Plan: Fix Old Update Loop & Enforce Strict Semver in Auto-Updater

## 1. Problem & Root Cause
1. **Inequality Check Over-Matching**:
   In `src/services/autoUpdateService.ts`, staged updates are detected with `match[1] !== APP_VERSION`. Because an older `v0.1.135` package was left over on disk in `updates/staging` and the app is running `v0.1.139`, `"0.1.135" !== "0.1.139"` evaluated to `true`. The updater incorrectly deemed `v0.1.135` as a newer pending update ready to install.
2. **Missing Semver & Stale File Retention**:
   The updater lacked semver comparison (`compareVersions(staged, current) > 0`). Furthermore, the staging directory (`G:\AI Pharmacy OS\updates\staging` or `%LOCALAPPDATA%\...\updates\staging`) never pruned packages with versions `<=` current `APP_VERSION`.
3. **Development Mode Execution Failure**:
   When `applyUpdate` is called from dev mode (`node.exe` / `tsx`), `installDir` defaults to `C:\Program Files\nodejs`. `Updater.bat` cannot replace Node.js, and graceful shutdown terminates the dev server, leaving the frontend frozen on "Installing & restarting..." and crashing dynamic imports (`Settings-...js`).

---

## 2. Technical Architecture & File Changes

1. **`src/services/autoUpdateService.ts`**:
   - Add exported `compareVersions(a: string, b: string): number` helper function.
   - In `AutoUpdateService.start()`:
     - Replace `match[1] !== APP_VERSION` with `compareVersions(stagedVersion, APP_VERSION) > 0`.
     - Automatically delete (purge) any staged `.zip` file where `compareVersions(stagedVersion, APP_VERSION) <= 0`.
     - Clean up stale `.tmp` files older than 1 hour.
   - In `applyUpdate()`:
     - Guard against dev mode: if `!isPackagedApp` (running via `node` / `tsx`), reject `applyUpdate` with a friendly error so dev servers are never accidentally killed and invalid updates are not attempted.
2. **Immediate Cleanup of Installed Staging Directory**:
   - Delete `AI-Pharmacy-OS-Update-v0.1.135.zip` and any `.tmp` files from `G:\AI Pharmacy OS\updates\staging\` and local app data staging folders.
3. **`frontend/src/components/UpdateBanner.tsx`**:
   - Add a timeout and error fallback on `handleInstallNow`. If the backend fails or takes too long, reset `isInstalling` so the button doesn't freeze permanently on "Installing & restarting...".
4. **Verification**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
   - Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Purge leftover `v0.1.135` and temp files from `G:\AI Pharmacy OS\updates\staging`.
- [x] **Step 2**: Implement `compareVersions`, strict semver checks, and auto-purge in `src/services/autoUpdateService.ts`.
- [x] **Step 3**: Guard `applyUpdate` against running in dev mode (`node.exe` / `tsx`) in `src/services/autoUpdateService.ts`.
- [x] **Step 4**: Add timeout recovery and error handling to `handleInstallNow` in `frontend/src/components/UpdateBanner.tsx` and `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx`.
- [x] **Step 5**: Run `npm run guardrails` and verify clean TypeScript compilation (`tsc --noEmit`).
- [x] **Step 6**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log

- **Task 1: Purged Obsolete Staged Files from `G:\AI Pharmacy OS\updates\staging`**:
  - Deleted `AI-Pharmacy-OS-Update-v0.1.135.zip` and `AI-Pharmacy-OS-Update-v0.1.136.zip.tmp` from disk.
  - Instantly cleared the false update notification from the installed application directory.

- **Task 2: Strict Semver Comparison & Boot Staging Housekeeping in `src/services/autoUpdateService.ts`**:
  - Exported `compareVersions(a, b)` helper to accurately compare semver release tags.
  - Replaced the flawed `!== APP_VERSION` condition with strict `compareVersions(stagedVersion, APP_VERSION) > 0`.
  - Added automatic boot-time cleanup routine: any `.zip` package where `stagedVersion <= APP_VERSION` is permanently deleted (`unlinkSync`), preventing stale files from ever triggering false notifications.
  - Added automatic purge of orphaned `.tmp` files older than 30 minutes.

- **Task 3: Protected `applyUpdate` from Development Mode Execution**:
  - In `autoUpdateService.applyUpdate()`, added validation ensuring updates can only be applied from the compiled binary (`PharmacyOS.exe`), preventing accidental shutdown of dev servers and preventing `Updater.bat` from attempting to update Node.js directory.
  - Added secondary semver gate ensuring pending version must be strictly greater than current version before spawning `Updater.bat`.

- **Task 4: Timeout Safeguard & Error Recovery in Frontend Components**:
  - Updated `frontend/src/components/UpdateBanner.tsx` and `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx`:
  - Added a 15-second timeout safeguard to `handleInstallNow` and `handleInstallAndRestart`.
  - If the server returns an error or fails to restart within 15 seconds, `isInstalling` / `installing` resets automatically and displays an informative toast, ensuring the UI never gets permanently stuck on "Installing & restarting...".

- **Task 5: Guardrails Verification & Knowledge Graph Synchronization**:
  - Passed `npm run guardrails` (`node scripts/performance-guardrails.mjs`) with clean TypeScript compilation (`tsc --noEmit`) and zero performance/color violations.
  - Synchronized knowledge graph via `node scripts/quick-update.mjs` (1310 nodes, 826 edges).

