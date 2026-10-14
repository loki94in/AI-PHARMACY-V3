# Implementation Plan: Auto-Saving Pharmarack Login Credentials & Token Synchronization

Created At: 2026-10-14T19:54:30+05:30
Status: COMPLETED

## 1. Problem & Objective
- **Problem**:
  Previously, while the Pharmarack JWT session token was auto-captured into SQLite `app_settings` when logging in via Chrome, the username/mobile field in Settings required the user to manually click the "Save Pharmarack Credentials" button. Furthermore, username/mobile information present in the authenticated session token was not automatically populated into the app's settings.
- **Objective**:
  1. Auto-extract the retailer username/mobile/userId from the authenticated JWT token payload when logging in through Chrome (or during token refresh) and auto-persist `pharmarack_username` into `app_settings`.
  2. Broadcast the captured username in the `pharmarack_session_refreshed` SSE event so the frontend instantly reflects the connected account.
  3. In `IntegrationsCredentialsTab.tsx`, automatically synchronize state from `rawSettings` / SSE events, and add auto-save on blur/debounced change to the username and password fields so users never have to click "Save Pharmarack Credentials".

## 2. Technical Architecture & Surgical Changes
1. **`src/services/tokenRefreshScheduler.ts`**:
   - Added and exported `extractUserFromToken(token: string): string | null` to parse JWT payload for mobile/user/retailer identifiers.
   - When `extractTokenFromProfile` or `executeRefreshInternal` gets a token, auto-persist `pharmarack_username` if extracted.
2. **`src/routes/pharmarack.ts`**:
   - In `saveTokenAndBroadcast`, called `extractUserFromToken(token)`, auto-saved `pharmarack_username` in `app_settings`, and included `username` in the `pharmarack_session_refreshed` event.
3. **`frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx`**:
   - Added `useEffect` to sync `pharmarackUser` and `pharmarackPass` whenever `rawSettings` updates.
   - Listened for `sse-pharmarack-refreshed` to update `pharmarackUser` live when Chrome login finishes.
   - Added auto-save on blur/debounced change for username/password inputs with a visual "Auto-saved" indicator while preserving the manual "Save" button.
4. **Guardrails & Knowledge Graph**:
   - Ran `npm run guardrails` (verified `tsc --noEmit` clean compile, PASS).
   - Ran `node scripts/quick-update.mjs` (knowledge graph fully updated).

---

## 3. Execution Tasks & Status
- [x] Task 1: Add `extractUserFromToken` and auto-save `pharmarack_username` in `src/services/tokenRefreshScheduler.ts`.
  - *Completed*: Implemented `extractUserFromToken()` parsing JWT payload for `mobileNumber`, `mobile`, `userName`, `username`, `phone`, `retailerMobile`, or `userId`. Integrated into both profile LevelDB extraction and Puppeteer refresh flows to auto-persist `pharmarack_username`.
- [x] Task 2: Update `saveTokenAndBroadcast` in `src/routes/pharmarack.ts` to auto-persist `pharmarack_username` and broadcast it via SSE.
  - *Completed*: Updated `saveTokenAndBroadcast()` to decode token, auto-insert `pharmarack_username` into `app_settings`, and broadcast `username` across the `pharmarack_session_refreshed` event.
- [x] Task 3: Enhance `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx` with live SSE sync and auto-save on blur for credentials.
  - *Completed*: Added synchronization hooks for `rawSettings`, SSE listener for `sse-pharmarack-refreshed`, automatic save on blur / 1200ms debounce on keystrokes, and an "Auto-saved" visual badge without removing manual Save button fallback.
- [x] Task 4: Run `npm run guardrails` and `node scripts/quick-update.mjs` to ensure zero regressions.
  - *Completed*: `npm run guardrails` passed (exit code 0, clean TypeScript check). `node scripts/quick-update.mjs` ran cleanly in 11.2s across 1181 files.
