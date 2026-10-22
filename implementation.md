# Implementation Plan: End-to-End Update Download & Installation Progress

## 1. Problem & Root Cause
1. **Unquoted Path Crash on Spaces**: In `src/services/autoUpdateService.ts`, `Updater.bat` was spawned via `cmd.exe /c updaterPath ...` without proper enclosing quotes. On standard installations with spaces (e.g. `G:\AI Pharmacy OS\Updater.bat`), `cmd.exe` failed with `'G:\AI' is not recognized as an internal or external command`. Because `stdio: 'ignore'` was set, the updater died silently.
2. **Invisible Download Progress**: `UpdateBanner.tsx` was configured to stay completely hidden during downloads, only popping up once 100% finished. The user had no visual confirmation of whether the download started or how many MBs were left.
3. **Invisible Installation Phase**: `Updater.bat` ran completely hidden (`stdio: 'ignore'`) without any window, progress bar, or extraction feedback.

---

## 2. Technical Architecture & File Changes

1. **`src/services/autoUpdateService.ts`**:
   - Fix process spawn quoting: format arguments so `cmd.exe` launches `Updater.bat` safely with paths containing spaces.
   - Launch `Updater.bat` via `start "AI Pharmacy OS — Updater" cmd.exe /c ...` in a dedicated visible console window so the user sees live progress.

2. **`packaging/Updater.bat`**:
   - Modernize the updater window with clear progress titles and color formatting.
   - Replace silent `Expand-Archive` with high-performance .NET zip extraction that prints live progress (`[3/4] Extracting update files... 78% (550/712)`).
   - Display clear step-by-step milestones: `[1/4] Closing app`, `[2/4] Verifying integrity`, `[3/4] Extracting files`, `[4/4] Restarting app`.

3. **`frontend/src/components/UpdateBanner.tsx`**:
   - Listen to SSE `sse:update_progress` events to render a live download progress bar with percentage and MB transfer counter (`Downloading update v0.1.141: 45% (47 MB / 105 MB)`).
   - Add a full-screen transition overlay when "Install Now" is clicked, informing the user that the updater window is taking over and the app will restart in ~10 seconds.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Write implementation plan to `implementation.md`.
- [x] **Step 2**: Enhance `packaging/Updater.bat` with visible styled console UI and live extraction progress.
- [x] **Step 3**: Fix path quoting and visible window spawning in `src/services/autoUpdateService.ts`.
- [x] **Step 4**: Update `frontend/src/components/UpdateBanner.tsx` with live download progress bar and installation transition modal.
- [x] **Step 5**: Run TypeScript compilation check (`tsc --noEmit`).
- [x] **Step 6**: Run `npm run guardrails` and verify 0 violations.
- [x] **Step 7**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
- [ ] **Step 8**: Commit changes and publish new release (`npm run release`).

---

## 4. Completed Tasks Log

1. **Root Cause Diagnosis**:
   - Analyzed failure on Windows paths with spaces (`G:\AI Pharmacy OS`). `cmd.exe /c` without proper quoting choked on `G:\AI`.
   - Identified lack of download progress in UI because banner was hidden during active download.
   - Identified lack of installation progress in `Updater.bat` because it was headless and used silent `Expand-Archive`.

2. **Console UI & Live Extraction Progress (`packaging/Updater.bat`)**:
   - Replaced silent extraction with .NET `[System.IO.Compression.ZipFileExtensions]` stream extraction reporting real-time percentage and file count: `[4/4] Installing update: 78% (550/712 files) [OK]`.
   - Added milestone status headers `[1/4]` to `[4/4]` with cyan console styling (`color 0B`).
   - Synced updated `Updater.bat` directly into `G:\AI Pharmacy OS\Updater.bat`.

3. **Space-Safe Quoting & Dedicated Console Window (`src/services/autoUpdateService.ts`)**:
   - Updated `installUpdate()` to wrap paths with `call "<updaterPath>"` inside `cmd.exe /c start "<title>" cmd.exe /c ...`.
   - Set `windowsHide: false` so the updater window is explicitly brought to the foreground.

4. **Live Download Progress & Transition Overlay (`frontend/src/components/UpdateBanner.tsx`)**:
   - Subscribed to SSE `update_progress` events to render active download progress bar, percent indicator, and MB counter (`45 MB / 105 MB`).
   - Added fullscreen transition modal when user clicks "Install Now" explaining that the updater is launching and the app will restart.

5. **Validation & Verification**:
   - Ran `npx tsc -p frontend/tsconfig.app.json --noEmit` -> Passed with 0 errors.
   - Ran `npm run guardrails` (`node scripts/performance-guardrails.mjs`) -> Passed with 0 violations.
   - Synchronized knowledge graph via `node scripts/quick-update.mjs`.

