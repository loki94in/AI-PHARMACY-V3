# Implementation Plan: Fix Pharmarack Credential Clearing, Robust Windows Token Capture & Data Sync

Created At: 2026-10-15T09:54:00+05:30
Status: COMPLETED

## 1. Problem & Root Cause Summary
1. **Uncleared Credentials on Logout**:
   - `tokenRefreshScheduler.clearSession()` only deleted `pharmarack_session_token` in `app_settings`, leaving `pharmarack_username` and `pharmarack_password` in SQLite.
   - A duplicate `POST /logout` at line 3416 of `src/routes/pharmarack.ts` was unreachable/dead code due to an earlier definition at line 866.
   - Frontend `IntegrationsCredentialsTab.tsx` did not reset local input state on logout, causing the auto-save debounce hook to resurrect old credentials.
2. **Token Capture & Data Failure in Installed Windows App**:
   - Spawning Chrome with `--user-data-dir=${mainProfilePath}` failed to handle paths with spaces (e.g., `C:\Users\...\AppData\Local\AI Pharmacy OS`) properly in Windows child processes.
   - Windows LevelDB file locking (`EBUSY`) prevented `extractTokenFromProfile` from reading `.log` / `.ldb` files while Chrome was open, silently returning `null`.
   - On Windows, `spawnProc('chrome.exe')` often delegates to an existing Chrome process and exits immediately; the backend treated process exit as "window closed without token", terminating polling before the user could enter OTP.
   - Old expired tokens in the profile directory pre-empted capture because `pollTimer` grabbed whatever token was on disk without checking for valid future expiration or comparing with the previous invalid token.
   - Because the token was never saved to SQLite in the installed app, all product searches returned `{ status: 'need_login' }` and live cart returned `Need to login`.

## 2. Technical Architecture & Surgical Changes
1. **`src/services/tokenRefreshScheduler.ts`**:
   - In `clearSession()`: Wipes `pharmarack_username`, `pharmarack_password`, and `pharmarack_session_token` from SQLite `app_settings`, sets `pharmarack_session_status` to `'disconnected'`, and stops the catalog sync cron.
   - In `extractTokenFromProfile()`: Expanded JWT token extraction regex to match any standard JWT format (`{"alg":...}`, `{"typ":"JWT",...}`). Added safe non-blocking read error handling and `options.notMatchingToken` parameter to skip old expired tokens.
2. **`src/routes/pharmarack.ts`**:
   - In `POST /logout` (line 866): Wipes all DB settings, calls `clearSession()`, invalidates cart cache, and broadcasts logged-out SSE status. Removed the shadowed dead duplicate handler at line 3416.
   - In `POST /login-window`:
     - Snapshots `priorToken` before launch so expired tokens are never re-captured.
     - Keeps polling active for up to 180 seconds even if the Windows Chrome launcher process delegates and exits immediately.
     - Verifies captured token has `exp * 1000 > Date.now()`.
     - On token capture, immediately invalidates cart cache, runs session heartbeat, invokes `warmupStartupCart()`, and broadcasts SSE `pharmarack_session_refreshed` so live cart and search have data instantly.
3. **`frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx`**:
   - In `handleLogoutPharmarack`: Clears pending auto-save timeout, sets `pharmarackUser` and `pharmarackPass` to `''`, and syncs React Query cache so the inputs visually clear immediately.
4. **Verification & Release Readiness**:
   - Ran `npm run guardrails` (`tsc --noEmit` check passed, 0 violations).
   - Ran `node scripts/quick-update.mjs` (knowledge graph fully synchronized).

---

## 3. Atomic Execution Steps
- [x] Task 1: Fix `tokenRefreshScheduler.clearSession()` and safe LevelDB token extraction in `src/services/tokenRefreshScheduler.ts`.
- [x] Task 2: Fix `POST /logout`, eliminate dead duplicate, and upgrade `POST /login-window` in `src/routes/pharmarack.ts` with space-safe paths, non-blocking polling, and fresh token validation.
- [x] Task 3: Update `handleLogoutPharmarack` in `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx` to clear React state and query cache immediately.
- [x] Task 4: Verify with `npm run guardrails` and update knowledge graph with `node scripts/quick-update.mjs`.

---

## 4. Completed Tasks Log
- **Task 1 Completed**: `src/services/tokenRefreshScheduler.ts` updated. `clearSession()` explicitly purges `pharmarack_username`, `pharmarack_password`, `pharmarack_session_token`, stops catalog cron, and resets session status. `extractTokenFromProfile()` upgraded with universal JWT header support, safe read handling, and `notMatchingToken` filtering.
- **Task 2 Completed**: `src/routes/pharmarack.ts` updated. Duplicate dead `/logout` route at line 3416 removed. `POST /login-window` upgraded with prior-token snapshotting, 180s persistent polling resilient to Windows launcher delegation, live cart warm-up, and real-time SSE broadcast.
- **Task 3 Completed**: `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx` updated. Cancelled auto-save debounce timers on logout, reset local component states to empty strings, and hydrated React Query settings cache so username/password fields immediately clear in the UI.
- **Task 4 Completed**: Guardrails verified via `npm run guardrails` (`tsc --noEmit` clean, PASS). Auto-knowledge graph regenerated in 9.5s via `node scripts/quick-update.mjs`.
