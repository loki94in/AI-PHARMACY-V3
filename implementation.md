# Pharmarack Installed App Login & Complete Clean Logout Implementation Plan

## Overview
This plan resolves all issues preventing Pharmarack from functioning properly in the installed Electron/Windows application, eliminates the "unable to login / stuck popup" syndrome by adding real-time token synchronization while the login window is open, and adds a dedicated **Complete Clean & Logout** operation in Settings (External Integrations tab).

---

## User Design Decisions
1. **Login Window Behavior**: Keep the login window open and update AI Pharmacy OS in real-time when authentication succeeds, letting the user close the window manually when they are ready.
2. **Logout UI Location**: Dedicated "Complete Clean & Logout" button in Settings -> External Integrations (Pharmarack B2B Live Ordering section).

---

## Root Causes Identified in Installed App

1. **Window Visibility Inheritance Bug in Installed App**:
   - In `electron/main.ts`, the backend child process is spawned with `windowsHide: true`.
   - In `src/routes/pharmarack.ts`, Chrome was spawned without `{ windowsHide: false }`. On Windows, child processes inherit the hidden window state, causing the Chrome login window to either launch hidden or fail to acquire foreground focus.
   - Fixed by explicitly passing `{ detached: false, stdio: 'ignore', windowsHide: false }`.

2. **The "Wait-for-Exit" Token Extraction Trap**:
   - In `src/routes/pharmarack.ts`, token extraction only triggered upon `chromeProc.on('exit')`.
   - When users logged in with OTP in Chrome, they switched back to the installed app, which remained in "Session Expired" state.
   - Retrying within the app was blocked because `tokenRefreshScheduler.isLoginWindowActive` was locked.
   - Fixed by introducing active real-time token polling (every 2s) while the login window is open. As soon as the JWT is written to LevelDB, the token is saved, the live session verified, and the UI updated via SSE.

3. **Missing Microsoft Edge & Universal Windows Path Resolution**:
   - `tokenRefreshScheduler.ts` line 521 called `findChromePath()` without `{ includeEdge: true }`. On Windows machines without standalone Google Chrome (only Microsoft Edge installed), headless background refreshes failed unconditionally.
   - `src/utils/chromeBrowser.ts` lacked standard environment variables (`%ProgramFiles%`, `%ProgramFiles(x86)%`, `%PROGRAMW6432%`, `%LOCALAPPDATA%`) and 32/64-bit cross-directory resolution.
   - `killOrphanChromeProcesses` relied on deprecated `wmic` (removed in Windows 11 24H2) and only checked `chrome.exe`, ignoring `msedge.exe`.
   - Fixed by including Edge across all refresh and kill routines, using PowerShell `Get-CimInstance` directly.

4. **Overly Restrictive JWT Role Check**:
   - `extractTokenFromProfile` checked `payload.role === 'Retailer'`. If upstream Pharmarack sent lowercase `retailer` or alternative sub-roles, valid tokens were dropped.
   - Fixed with case-insensitive check `(!payload.role || String(payload.role).toLowerCase() === 'retailer')`.

5. **No "Complete Clean / Logout" Capability**:
   - When profile data became corrupted, locks were stuck, or accounts were switched, there was no way to reset.
   - Fixed by creating `POST /pharmarack/logout` and the Settings UI button.

---

## Detailed Step-by-Step Implementation Plan

### Step 1: Core Chromium & Process Utilities (`src/utils/chromeBrowser.ts`)
- Enhance `findChromePath`:
  - Check dynamic environment variables (`LOCALAPPDATA`, `PROGRAMFILES`, `ProgramFiles(x86)`, `PROGRAMW6432`).
  - Check standard paths for Google Chrome and Microsoft Edge.
  - Add fallback to `where.exe chrome` and `where.exe msedge`.
- Enhance `killOrphanChromeProcesses` in `src/services/tokenRefreshScheduler.ts`:
  - Kill both `chrome.exe` and `msedge.exe` matching the profile keyword.
  - Use fast PowerShell `Get-CimInstance` command, bypassing deprecated `wmic`.

### Step 2: Real-Time Token Monitoring & Clean Logout Endpoint (`src/routes/pharmarack.ts` & `src/services/tokenRefreshScheduler.ts`)
- Update `tokenRefreshScheduler.ts`:
  - Enable `{ includeEdge: true }` in `executeRefreshInternal()`.
  - Loosen JWT role matching in `extractTokenFromProfile()`.
  - Add `clearSession()` method to `tokenRefreshScheduler` that:
    - Kills processes holding locks on `pharmarack_profile` and temp profile dirs.
    - Resets `isRefreshing = false`, `isLoginWindowActive = false`, `heartbeatInFlight = false`, `consecutiveHeartbeat401s = 0`.
    - Recursively removes `pharmarack_profile` and `pharmarack_profile_temp_*` folders.
- Update `src/routes/pharmarack.ts`:
  - In `POST /pharmarack/login-window`:
    - Set `{ detached: false, stdio: 'ignore', windowsHide: false }` on process spawn.
    - Start an active polling interval (every 2 seconds) to inspect the profile for a newly written token while Chrome is open.
    - When a valid token is found:
      - Persist token, set `pharmarack_session_status = 'active'`, `pharmarack_mode = 'Live'`.
      - Trigger session heartbeat to verify connection.
      - Broadcast SSE `pharmarack_session_refreshed` with `{ status: 'success' }` so the UI instantly updates without needing the user to close Chrome.
    - Clean up interval on `exit` or on success.
  - Implement `POST /pharmarack/logout`:
    - Call `tokenRefreshScheduler.clearSession()`.
    - Delete `pharmarack_session_token` and set `pharmarack_session_status = 'disconnected'` in SQLite `app_settings`.
    - Invalidate in-memory cart cache (`serverCartCache = null`).
    - Broadcast SSE `pharmarack_session_refreshed` with `{ status: 'logged_out', message: 'Pharmarack session cleared' }`.
    - Return `{ success: true, message: 'Pharmarack session cleared and logged out successfully.' }`.

### Step 3: Electron Lock Sanitation (`electron/main.ts`)
- In `cleanAllSessionLocks()`, also resolve `getAppDataDir()` or check `%LOCALAPPDATA%\AI Pharmacy OS\data\pharmarack_profile` to ensure locks are cleanly stripped upon startup regardless of installation directory.

### Step 4: Frontend Settings UI & API Client (`frontend/src/`)
- In `frontend/src/services/api.ts`:
  - Add `clearPharmarackSession: () => apiClient.post('/pharmarack/logout').then(res => res.data)`.
- In `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx`:
  - Add "Clear & Logout" button next to "Refresh Session" and "Open Login (OTP)".
  - When clicked, prompt user confirmation dialog ("Are you sure you want to completely clear the Pharmarack session and cached data?").
  - On confirm, call `api.clearPharmarackSession()`, trigger success toast, and refresh settings.

### Step 5: Verification & Safety Guardrails
- Run `npm run guardrails` to guarantee 0 TypeScript/performance violations.
- Run `node scripts/quick-update.mjs` to update the knowledge graph.

---

## Progress Tracking

- [x] Task 1: Update browser path discovery and Windows process killing in `chromeBrowser.ts` and `tokenRefreshScheduler.ts` (Completed)
- [x] Task 2: Implement real-time token polling and spawn visibility flags in `src/routes/pharmarack.ts` (Completed)
- [x] Task 3: Implement `clearSession()` in `tokenRefreshScheduler.ts` and `POST /pharmarack/logout` in `src/routes/pharmarack.ts` (Completed)
- [x] Task 4: Align session lock cleaning in `electron/main.ts` (Completed)
- [x] Task 5: Add `logoutPharmarack` API and UI button in `IntegrationsCredentialsTab.tsx` (Completed)
- [x] Task 6: Run Guardrails (`npm run guardrails`) & Knowledge Graph Update (`node scripts/quick-update.mjs`) (Completed)

---

## Completed Tasks Summary

1. **Browser Path Discovery & Process Termination**:
   - `src/utils/chromeBrowser.ts`: `findChromePath` now searches dynamic Windows environment variables (`%PROGRAMFILES%`, `%ProgramFiles(x86)%`, `%PROGRAMW6432%`, `%LOCALAPPDATA%`), checks standard Chrome and Edge locations, and falls back to `where.exe chrome.exe` / `where.exe msedge.exe`.
   - `src/services/tokenRefreshScheduler.ts`: `killOrphanChromeProcesses` terminates both `chrome.exe` and `msedge.exe` holding locks on profile directories using fast PowerShell `Get-CimInstance` without hanging on Windows 11.
   - `tokenRefreshScheduler.ts`: `executeRefreshInternal` now uses `findChromePath({ includeEdge: true })` and `extractTokenFromProfile` supports case-insensitive retailer role matching.

2. **Real-Time Login Window Synchronization**:
   - `src/routes/pharmarack.ts`: Chrome/Edge is spawned with `{ detached: false, stdio: 'ignore', windowsHide: false }` to prevent hidden window inheritance from Electron.
   - Active polling runs every 2s while Chrome is open, capturing the JWT token the instant login is complete in LevelDB. The token is stored, session verified, and UI updated in real-time via SSE while the window remains open for the user to close manually.

3. **Complete Clean & Logout Capability**:
   - `src/services/tokenRefreshScheduler.ts`: Added `clearSession()` method to kill lock-holding processes, delete `pharmarack_profile` and temp directories, and reset SQLite session keys.
   - `src/routes/pharmarack.ts`: Added `POST /pharmarack/logout` to invalidate in-memory cart caches, invoke `clearSession()`, and broadcast SSE `pharmarack_session_refreshed { status: 'logged_out' }`.
   - `frontend/src/services/api.ts`: Added `logoutPharmarack()`.
   - `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx`: Added responsive "Clean & Logout" button with two-step inline confirmation, safe from Guardrail F9 native dialog restrictions.

4. **Electron Lock Sanitation**:
   - `electron/main.ts`: `cleanAllSessionLocks` now purges session and devtools locks from both `targetDir` and `%LOCALAPPDATA%\AI Pharmacy OS` on startup.

5. **Verification**:
   - `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) PASSED with 0 errors, all performance guardrails PASSED.
   - `node scripts/quick-update.mjs`: Knowledge Graph updated in 3.2s (1175 nodes, 797 edges, 10 layers).
