# Implementation Plan: In-App Background Auto-Update Download & Notification Flow

## 1. Goal
When a new software update is available (e.g. v0.1.138):
1. **Never open external download manager or browser for the full 984 MB installer** when using the in-app update flow.
2. **Auto Background Download of 105 MB OTA Update Package**:
   - The app silently downloads the lightweight `AI-Pharmacy-OS-Update-v{version}.zip` (105 MB) in the background directly into staging (`%LOCALAPPDATA%\AI Pharmacy OS\updates\staging\`).
   - Resilient HTTP streaming with `User-Agent: AI-Pharmacy-OS-AutoUpdater` and redirect following to ensure GitHub releases never reject downloads.
3. **In-App Progress & Status**:
   - In Settings > License & Updates:
     - On mount, query `/api/license/update-status` so current state is immediately visible.
     - While downloading, display `⏳ Downloading update in background ({percent}%)...`.
     - When an update is detected, offer `[ Download in Background ]` instead of an external hyperlink.
4. **Human-in-the-Loop "Install Now / Later" Prompt**:
   - Once the 105 MB update package finishes downloading and SHA-256 verification passes:
     - Top banner (`UpdateBanner.tsx`) displays: `🎉 Update Available: v{version} — Downloaded in background & ready to install` with `[ Install Now ]` and `[ Later ]`.
     - In Settings > License & Updates, the button displays `[ Install & Restart ]`.
     - Clicking `Install Now` or `Install & Restart` executes `/api/system/apply-update`, safely closes the app, runs `Updater.bat` (5-second atomic file replacement with backup & rollback), and restarts into the new version.

---

## 2. Technical Architecture & File Changes

1. **`src/services/autoUpdateService.ts`**:
   - Update `downloadFile`: Add `'User-Agent': 'AI-Pharmacy-OS-AutoUpdater'`, dynamic protocol handling (`https` / `http`) on redirects, and progress callback.
   - In `AutoUpdateService`:
     - Maintain `downloading`, `downloadProgress`, and `readyToInstall` accurately in `lastResult`.
     - Add `startBackgroundDownload(info?, reason?)` method.
     - Broadcast `update_progress` SSE event with percentage.
     - On download finish & SHA-256 verify, broadcast `update_available` with `readyToInstall: true`.
2. **`src/routes/license.ts`**:
   - Update `GET /api/license/update-status` to return `currentVersion`, `latestVersion`, `downloading`, `downloadProgress`, `readyToInstall`, `changelog`.
   - Add `POST /api/license/start-download` to allow the user or frontend to trigger the background download on demand.
3. **`frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx`**:
   - In `SoftwareUpdateCard`:
     - On mount, call `/api/license/update-status` so the card is hydrated immediately.
     - Listen to `sse:update_progress` to display real-time download percentage.
     - Replace the external `<a href={downloadUrl}>Download</a>` link with an in-app button `[ Download in Background ]` that calls `/api/license/start-download`.
     - Keep a discreet secondary text link for advanced users who explicitly want the manual standalone installer exe.
4. **`frontend/src/components/UpdateBanner.tsx`**:
   - Verify it continues listening to `sse:update_available` and only presents `[ Install Now ]` / `[ Later ]` once `readyToInstall: true`.
5. **Verification**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
   - Run `node scripts/quick-update.mjs`.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Enhance `downloadFile` and `AutoUpdateService` in `src/services/autoUpdateService.ts` with User-Agent, progress tracking, and `startBackgroundDownload`.
- [x] **Step 2**: Add `POST /api/license/start-download` and update `GET /api/license/update-status` in `src/routes/license.ts`.
- [x] **Step 3**: Update `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx` to mount-hydrate update status, track download progress, and replace external link with in-app background download action.
- [x] **Step 4**: Verify `frontend/src/components/UpdateBanner.tsx` prompt behavior.
- [x] **Step 5**: Run `npm run guardrails` and verify clean TypeScript compilation (`tsc --noEmit`).
- [x] **Step 6**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log

- **Task 1: Resilient In-App Background Streaming & Progress in `src/services/autoUpdateService.ts`**:
  - Added `User-Agent: AI-Pharmacy-OS-AutoUpdater/1.0` and dynamic protocol redirection handling to `downloadFile` to prevent GitHub download blocks.
  - Implemented streaming progress callback (`onProgress`) tracking `transferredMB`, `totalMB`, and `percent`.
  - Added `startBackgroundDownload` method and real-time SSE broadcasts for `update_progress`.
  - On SHA-256 verification pass, automatically broadcasts `update_available` with `readyToInstall: true`.

- **Task 2: API Endpoints for Background Downloading in `src/routes/license.ts`**:
  - Updated `GET /api/license/update-status` to return comprehensive state (`downloading`, `downloadProgress`, `readyToInstall`, `currentVersion`, `latestVersion`, `downloadUrl`, `changelog`).
  - Added `POST /api/license/start-download` to trigger background downloading of the 105 MB update package on demand.
  - Included `downloadProgress` in `POST /api/license/check-update`.

- **Task 3: In-App Download UI & Progress Tracking in `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx`**:
  - Hydrated update status on component mount via `GET /api/license/update-status`.
  - Added SSE event listener for `sse:update_progress` alongside `sse:update_available`.
  - Replaced external `<a href={downloadUrl} target="_blank">Download</a>` button with `[ Download Update (105 MB) ]` calling `apiClient.post('/license/start-download')`.
  - Added live progress bar showing percent and MB transferred.
  - Added human-in-the-loop `[ Install & Restart Now ]` and `[ Later ]` action buttons when package is downloaded and SHA-256 verified.
  - Kept a discreet secondary text link for advanced users needing the full standalone offline installer setup.exe.

- **Task 4: Global Update Banner Verification in `frontend/src/components/UpdateBanner.tsx`**:
  - Verified that `UpdateBanner` stays completely invisible while downloading in background.
  - Banner displays `Update Available: v{version} — Downloaded in background & ready to install` with `[ Install Now ]` and `[ Later ]` ONLY once the update is 100% verified.

- **Task 5: Guardrails, Type Safety & Knowledge Graph**:
  - Passed `npm run guardrails` with clean TypeScript compilation (`tsc --noEmit`) and zero color or performance rule violations.
  - Frontend production build (`npm --prefix frontend run build`) verified clean without errors.
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
