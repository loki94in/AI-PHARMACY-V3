# Implementation Plan: Silent Background Update Download & "Install Now or Later" Prompt

## 1. Goal
Implement a frictionless, non-intrusive update experience:
- When a new version is detected, the app downloads and verifies the update package silently in the background without interrupting the user.
- Once the download is 100% complete and verified, the app displays a single clear prompt: **"Update Available: vX.X.X — Install Now or Later"**.
- Clicking **"Install Now"** restarts the app and applies the update via `Updater.bat`.
- Clicking **"Later"** dismisses the prompt and stores the dismissal in `sessionStorage`, automatically skipping any further prompts until the next app restart.

## 2. Technical Architecture & File Changes
1. **Backend (`src/services/autoUpdateService.ts`)**:
   - In `runCheck`: when `result.hasUpdate` is detected and needs downloading, launch `downloadUpdateSilently` without firing intrusive UI banners during the download phase.
   - Once the file is fully downloaded and SHA-256 is verified, broadcast `update_available` with `readyToInstall: true, downloading: false`.
   - If the update package is already on disk, broadcast `readyToInstall: true` immediately.
2. **Frontend Component (`frontend/src/components/UpdateBanner.tsx`)**:
   - Check `sessionStorage.getItem(`update_later_${latestVersion}`)`: if "Later" was chosen in this session, do not render.
   - Stay hidden while `downloading === true`.
   - When `readyToInstall === true`, render the prompt dialog with two prominent choices:
     - **"Install Now"**: calls `/api/system/apply-update` to restart and apply.
     - **"Later"**: records `sessionStorage.setItem(`update_later_${latestVersion}`, 'true')` and dismisses, skipping until next app restart.
3. **Settings Update Tab (`frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx`)**:
   - Maintain compatibility for manual checks: displays current status and allows immediate installation when ready.

## 3. Step-by-Step Implementation
- [x] Step 1: Update `src/services/autoUpdateService.ts` to download silently without broadcasting during download, detect pre-staged updates on boot, and expose `getStatus()`.
- [x] Step 2: Update `frontend/src/components/UpdateBanner.tsx` with "Install Now" & "Later" actions and `sessionStorage` session-skipping until next restart.
- [x] Step 3: Verify TypeScript compilation and performance guardrails with `npm run guardrails`.
- [x] Step 4: Verify frontend build with `npm run build --prefix frontend`.
- [x] Step 5: Update knowledge graph (`node scripts/quick-update.mjs`).

---

## 4. Completed Tasks Log
- **Silent Background Downloading**: In `src/services/autoUpdateService.ts`, suppressed intrusive UI broadcasts while downloading is in progress during automated checks. Background download runs quietly and verifies SHA-256 integrity before notifying the frontend.
- **Pre-Staged Boot Detection & API**: Added boot check in `autoUpdateService.start()` to detect if an update package was already staged on disk and broadcast it within 3s of app launch. Added `GET /api/license/update-status` endpoint for initial mount queries.
- **"Install Now or Later" Prompt**: In `frontend/src/components/UpdateBanner.tsx`, updated the prompt to only appear once `readyToInstall: true`. Provided two clear buttons:
  - **Install Now**: Starts `/api/system/apply-update` to restart and apply via `Updater.bat`.
  - **Later**: Stores dismissal in `sessionStorage.setItem('update_later_' + version, 'true')` and dismisses the prompt for the entire current app session until the next restart.
- **Verification**: `npm run guardrails` passed (0 violations, clean `tsc --noEmit`), and `npm run build --prefix frontend` built with 0 errors. Knowledge graph synchronized via `scripts/quick-update.mjs`.
