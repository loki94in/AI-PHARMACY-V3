# Implementation Plan: Silent Background Auto-Update (Option B) with Periodic Beacon & Auto-Apply on Restart

**Plan File:** `SILENT_AUTO_UPDATE_OPTION_B_IMPLEMENTATION_PLAN.md`  
**Status:** In Progress  
**Objective:** Enable the app to detect mid-day releases without waiting 24 hours, automatically download silently in the background, suppress all disruptive popups during active pharmacy work (Option B), and automatically apply the update seamlessly on restart / app exit.

---

## 1. Architectural Strategy & Design

### Phase 1: Background Version Beacon & Mid-Day Push Detection
- **File:** `src/services/autoUpdateService.ts`
- **Current problem:** `this.intervalHandle` was never instantiated in `start()`. Once the T+10s boot check ran, a running app never checked again. Additionally, `runCheck` skipped checks if `Date.now() - last_checked_at < 24 hours`.
- **Solution:**
  1. Initialize `this.intervalHandle` in `autoUpdateService.start()` with a quiet, lightweight version beacon every 30 minutes, gated by `activityTracker.isIdle()`.
  2. In `runCheck(reason)`:
     - For `'boot'` and `'manual'`: Always checks immediately.
     - For `'auto'` (the 30-min beacon): Performs a lightweight semver check against the update server. If the server has a newer version (`latestVersion > APP_VERSION`), it bypasses the 24-hour delay and immediately starts silent background download. If up to date, updates `last_checked_at` and sleeps.

### Phase 2: Silent Background Download & Integrity Verification
- **File:** `src/services/autoUpdateService.ts`
- When a newer version is detected:
  - Download begins silently to `%LOCALAPPDATA%\AI Pharmacy OS\updates\staging\` using the small ZIP package fast path (`updatePackageUrl`).
  - Progress updates silently in the background.
  - Verifies SHA-256 hash upon completion.
  - Marks `readyToInstall: true`.

### Phase 3: Option B UI Behavior (Zero Interruptions / Popups)
- **Files:** `frontend/src/components/UpdateBanner.tsx`, `frontend/src/services/updateStatusStore.ts`
- **Option B Contract:**
  - The disruptive floating update card / popup (`UpdateBanner`) is **suppressed on counter billing and operational pages** so cashiers are never interrupted.
  - In `Settings -> License & Updates`, the update status remains visible and informative (shows version ready, changelog, and manual "Restart & Install Now" button if the user wants to install immediately).

### Phase 4: Auto-Apply Staged Update on App Exit / Restart
- **Files:** `src/server.ts`, `src/services/autoUpdateService.ts`, `electron/main.ts`
- When the user closes the app at the end of the day or restarts:
  - If a verified update package is staged on disk (`readyToInstall === true`), the app automatically triggers `autoUpdateService.applyUpdate()` during graceful shutdown.
  - The updater extracts the new version cleanly without blocking the user.
  - Next time the app opens, it boots directly into the new version with zero manual intervention.

---

## 2. Tasks & Progress Tracking

- [ ] **Task 1: Add Periodic Background Version Beacon in `src/services/autoUpdateService.ts`**
  - Initialize `this.intervalHandle = setInterval(...)` (every 30 minutes, gated by `activityTracker`).
  - Update `runCheck` to detect mid-day releases without being blocked by 24h throttling when a newer semver is released.
  - Ensure clean teardown in `stop()`.

- [ ] **Task 2: Configure Option B in Frontend (`UpdateBanner.tsx`)**
  - Suppress disruptive popups on operational pages (POS, Billing, Inventory, CRM) per Option B.
  - Keep status truthful in Settings > License & Updates.

- [ ] **Task 3: Seamless Auto-Apply on Clean Shutdown / Exit**
  - In `src/server.ts:gracefulShutdown` (on `CLIENT_EXIT` / window close), if an update is staged and verified (`readyToInstall === true`), automatically spawn updater handoff before closing.

- [ ] **Task 4: Zero-Bugs Gate Verification & DOX Sync**
  - Run `npm test -- tests/autoUpdateVersionGate.test.ts`.
  - Run `npx tsc --noEmit` (clean TypeScript compilation).
  - Run `npm run guardrails` (zero violations).
  - Run `node scripts/quick-update.mjs` (knowledge graph sync).

