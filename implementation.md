# Implementation Plan: Sequentialize Cold Boot Pipeline & Honest Buffer (70s Pharmarack / 40s WhatsApp)

## 1. Overview & Problem Definition
- **Issue**: 
  - On cold boot, medicine search (e.g. `fluka 150`) and "Add to Live Cart" fail and return 0 results ("No mapped distributor has product") for the first 1.0 to 1.5 minutes.
  - The header progress bar shows a fake "All services ready" flash and hides at T+2s, even though Pharmarack is unverified and WhatsApp has not connected yet.
  - After 1.5 minutes pass, the app suddenly works fast (235ms search).
- **Root Causes**:
  1. **Artificial 30s Sleep in `src/server.ts:743`**: `tokenRefreshScheduler.start()` is delayed by `setTimeout(..., 30_000)`, leaving stored tokens unverified for 30s.
  2. **Artificial 45s Sleep in `src/server.ts:1010`**: WhatsApp boot restore is delayed by `setTimeout(..., 37_000)` inside Phase 3 (+8s = 45s).
  3. **Fake `pharmarackConnected` in `src/routes/serviceStatus.ts:18`**: Marked `connected = true` solely because an old token string length is > 20, without verifying with Pharmarack API.
  4. **Premature Ticker Hide in `frontend/src/components/Layout.tsx:1713-1776`**: Ticker sees fake `ready` signals at T+1.5s, flashes "All services ready", and hides while services are still dead/idling.
  5. **Silent Empty Fallback in `src/routes/pharmarack.ts:465`**: When Pharmarack returns 401 Unauthorized, search silently returns `[]`, causing `LiveCartSearchSection.tsx` to toast the false message "No mapped distributor has product".

---

## 2. Target Sequentialization & Honest Buffer Windows
- **App Shell & SQLite**: Ready at **T+0.35s – 1.5s**.
- **Pharmarack (70s Safe Buffer Ceiling)**:
  - Immediate REST probe at **T+0.6s** (takes ~300ms, 0% CPU).
  - Normal day: Verified live at **T+0.9s** (search works in 235ms immediately).
  - Expired session fallback: Single-flight browser restore completes in **8s – 25s**.
  - Maximum buffer limit: **70 seconds** (if internet down or portal password changed, safely flags attention).
- **WhatsApp (40s Safe Buffer Ceiling)**:
  - Staggered restore starts at **T+1.5s** (1.5s CPU buffer so UI is 100% smooth).
  - Normal day: Ready at **T+6s – 10s**.
  - Maximum buffer limit: **40 seconds** (if phone offline or QR logged out, safely flags attention).
- **Dynamic Early Unlock**:
  - As soon as active services verify (typically 3s – 8s), the progress bar smoothly transitions to ready and collapses without forcing the user to wait the full 40s or 70s.
  - Zero fake success: Never hides until verified.

---

## 3. Surgical Implementation Steps

### Step 1: Remove Artificial 30s & 45s Delays in `src/server.ts`
- Move `tokenRefreshScheduler.start()` to run immediately at **T+0.6s** (right after Phase 2 in-memory cache dispatch).
- Move WhatsApp boot check (`isWhatsAppAutoConnectAllowed()`) to run at **T+1.5s** instead of T+45s.
- Keep the CPU safe for low-end dual-core PCs by keeping a 1-second stagger between UI paint and WhatsApp browser launch.

### Step 2: Fix Truthful Status in `src/routes/serviceStatus.ts`
- Update `pharmarackConnected` to require:
  `!!token && token.length > 20 && (schedulerStatus.lastHeartbeatAt !== null || sessionStatus === 'active') && sessionStatus !== 'expired'`.
- Return `isVerifying: schedulerStatus.isRefreshing || (!schedulerStatus.lastHeartbeatAt && !schedulerStatus.lastError)`.

### Step 3: Prevent False Empty Results in `src/routes/pharmarack.ts`
- In `performPharmarackSearch`, when `response.status === 401 || response.status === 403`:
  - Trigger single-flight `tokenRefreshScheduler.executeRefresh()` to restore session.
  - Return `{ status: 'need_login', isRefreshing: true, items: [] }` so frontend knows it is actively re-authenticating rather than permanently empty.

### Step 4: Configure Honest 40s & 70s Buffers in `frontend/src/components/Layout.tsx`
- Set WhatsApp startup buffer limit to **40,000ms** (40s).
- Set Pharmarack startup buffer limit to **70,000ms** (70s).
- Update `startupServices`:
  - Pharmarack is only `ready` when `ph.connected` is true AND `lastHeartbeatAt` or verified.
  - While probe/refresh is running, state is `'wait'`.
  - When expired or error, state is `'attention'`.
- Remove premature ticker hide: The ticker NEVER flashes "All services ready" unless all active services are genuinely `ready`.

### Step 5: Update `frontend/src/components/LiveCartSearchSection.tsx`
- When `prData` returns `need_login` or during cold boot while Pharmarack is restoring:
  - Display an honest inline badge in suggestions: `🔄 Restoring Pharmarack session (ready in a few seconds)...`.
  - Suppress the false toast `"No mapped distributor has product"`.

### Step 6: Verification & Guardrails
- Run `npm run guardrails` (TypeScript compile clean, 0 violations).
- Run `npm run build:client` (Vite production bundle clean).
- Test search query `fluka 150` on running backend.
- Update `SMALL_BUG_FIX_PLAN.md` and knowledge graph via `node scripts/quick-update.mjs`.

---

## 4. Tasks & Completion Log
- [x] Task 1: Remove artificial boot delays & sequentialize services in `src/server.ts`
  - Completed: Moved Pharmarack REST probe to T+600ms (takes ~300ms, verifies token right after Phase 2 cache dispatch). Moved WhatsApp boot session check to T+1500ms (clean 1.5s pause protects dual-core UI paint while completely eliminating the old 45s sleep timer).
- [x] Task 2: Implement truthful status reporting in `src/routes/serviceStatus.ts`
  - Completed: Updated `pharmarackConnected` to require proven heartbeat (`lastHeartbeatAt !== null` or `sessionStatus === 'active'`) and not expired. Returns `isVerifying` so the frontend knows when the session is being checked.
- [x] Task 3: Improve 401 handling & automatic recovery in `src/routes/pharmarack.ts`
  - Completed: Updated `PharmarackSearchOutcome` and `performPharmarackSearch` to catch 401/403 responses, trigger single-flight `executeRefresh()` in the background, and return `isRefreshing: true` instead of false empty `[]` results.
- [x] Task 4: Implement honest 40s/70s buffers & dynamic early unlock in `frontend/src/components/Layout.tsx`
  - Completed: Added dedicated 40,000ms (WhatsApp) and 70,000ms (Pharmarack) buffer ceilings. Updated `startupServices` so neither service marks ready until genuinely verified. Built dynamic early unlock so the progress bar smoothly collapses as soon as both services verify.
- [x] Task 5: Upgrade `frontend/src/components/LiveCartSearchSection.tsx` to handle session restoring
  - Completed: Updated catch block and dropdown renderer to display `🔄 Restoring Pharmarack session (ready in a few seconds)...` when `isRefreshing` is true, suppressing the misleading "No mapped distributor has product" toast.
- [x] Task 6: Run guardrails, client build, verify search, update `SMALL_BUG_FIX_PLAN.md` & knowledge graph
  - Completed: `npm run guardrails` exit 0 (`tsc --noEmit` clean, 0 violations); `npm run build:client` built in 42.71s with 0 errors; verified live search `fluka 150` returning 142 items in 235ms; registered `P2-88` in `SMALL_BUG_FIX_PLAN.md`.
