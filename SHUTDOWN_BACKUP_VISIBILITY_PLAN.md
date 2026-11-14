# Implementation Plan: Shutdown Backup Progress Visibility & Completion Card

## Problem Summary
When exiting AI Pharmacy OS via the "Exit App" button or the window close ("X") button:
1. The UI modal froze at `5%` ("Starting database safety snapshot...").
2. No real-time progress (cloning, compressing, retention) was displayed.
3. No 100% completion popup or backup archive details were shown on screen before the window abruptly closed.

## Root Cause
In `src/server.ts`, `POST /api/system/shutdown` checked `const isDirect = req.query.direct === '1' || req.body?.direct === true;`. Because `frontend/src/services/api.ts` posted an empty `{}` body without `direct: true`, the server branched into the 3.5s tab-close schedule and returned `{ message: 'Tab-close graceful shutdown scheduled.' }` in 5ms without executing `createBackup()`. Because `res.backup` was undefined, the UI's completion check failed, waited 1.2s frozen at 5%, and called `window.close()`.

---

## Technical Strategy
1. **Frontend API Call (`frontend/src/services/api.ts`)**:
   - Send `{ direct: true }` by default in `api.shutdownSystem({ direct: true })`.
2. **Backend Route (`src/server.ts`)**:
   - Explicitly default `isDirect = true` on `POST /api/system/shutdown` (unless explicitly requested as tab-close beacon).
   - Execute `createBackup('Shutdown (Client Exit)')` synchronously within the HTTP request.
   - Return `{ success: true, backup: { filename, sizeBytes } }` in the response.
3. **Frontend Modal (`frontend/src/components/Layout.tsx`)**:
   - Display real-time SSE progress frames (`cloning` 5–30%, `compressing` 30–90%, `retention` 95%, `completed` 100%).
   - Once completed, display the green "Backup Completed Safely" card showing the archive filename and formatted file size (MB).
   - Include a 3.5-second countdown timer and an immediate "Close Application" button so the user clearly sees confirmation.

---

## Tasks & Progress Tracking

- [x] Task 1: Update `frontend/src/services/api.ts` to pass `{ direct: true }` in `shutdownSystem()`
  - *Completed:* Updated `shutdownSystem: (options?: { direct?: boolean; skipBackup?: boolean }) => apiClient.post('/system/shutdown', { direct: true, ...options })` so the synchronous backup path is explicitly triggered.
- [x] Task 2: Update `src/server.ts` to ensure `POST /api/system/shutdown` runs synchronous backup and returns result
  - *Completed:* Extended server grace shutdown timer to 15 seconds so client can comfortably present the completion card without the connection dropping prematurely.
- [x] Task 3: Enhance `frontend/src/components/Layout.tsx` shutdown overlay with live stage messages, archive filename, size, and close countdown
  - *Completed:*
    - Mounted `sse-shutdown-progress` listener unconditionally so intermediate SSE frames are captured immediately.
    - Added `res.flush()` in `src/routes/notifications.ts` so SSE frames bypass HTTP compression buffer instantly.
    - Added 6-second auto-close countdown with an explicit "Close Application Now" button when `completedInfo` arrives.
- [x] Task 4: Verify with `npm run guardrails` (`tsc --noEmit`) and update knowledge graph via `node scripts/quick-update.mjs`
  - *Completed:* TypeScript check passed (`tsc --noEmit`), 0 guardrail violations, knowledge graph updated.
