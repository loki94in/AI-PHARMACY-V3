# Implementation Plan: Fix Update Detection Pipeline & Enable Instant Boot-Time Update Checks

## 1. Root Cause Analysis

Investigation revealed four interconnected factors that caused the app to fail to detect the new update:

### Factor 1: Client-Side Boot Check Blocked by 15-Day Throttling Gate (Primary Client Bug)
- In `src/database.ts` (line 4581):
  ```sql
  CREATE TABLE IF NOT EXISTS update_checks (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_checked_at TEXT,
    last_known_version TEXT,
    current_version TEXT DEFAULT '1.0.0',
    check_interval_days INTEGER NOT NULL DEFAULT 15
  );
  ```
  `check_interval_days` defaults to **15 days**.
- In `src/services/autoUpdateService.ts`:
  ```ts
  // On boot (T+60s):
  setTimeout(() => this.runCheck('auto'), BOOT_DELAY_MS);

  // In runCheck():
  if (reason === 'auto' && row?.last_checked_at) {
    const lastMs      = new Date(row.last_checked_at).getTime();
    const intervalDays = row.check_interval_days ?? 1;
    const intervalMs  = intervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - lastMs < intervalMs) return; // <-- EXITS IMMEDIATELY
  }
  ```
- **Consequence**: Whenever the app performed an initial update check, `last_checked_at` was recorded. On every subsequent launch, `runCheck('auto')` checked if 15 days had passed since `last_checked_at`. Because 15 days had not elapsed, the boot check was **completely aborted**! The app never queried the update server on restart.

### Factor 2: Lack of Distinction Between Boot Checks and Periodic Background Polling
- When a user restarts the desktop application, they expect the app to immediately check if an update is available.
- Currently, boot checks reuse `reason: 'auto'` alongside periodic 2-hour idle polling, subjecting restart checks to the same long interval gate.

### Factor 3: Vercel Update Server Was Serving Stale Version 0.1.132
- The Vercel endpoint `https://website-woad-seven-26.vercel.app/api/updates?action=check` was returning `latestVersion: "0.1.132"` with `DEFAULT_LATEST_VERSION = '0.1.132'`.
- Even though GitHub had release `v0.1.144` published with binaries and update zip, the metadata had not been published to Vercel Upstash KV (`POST /api/updates?action=publish`).
- Any client comparing its version against `0.1.132` was told `hasUpdate: false`.

### Factor 4: Single Point of Failure in `website/api/updates.js` (No GitHub Fallback)
- `website/api/updates.js` exclusively relied on KV; if KV was empty or unpopulated, it blindly fell back to the hardcoded `0.1.132` rather than querying GitHub's public Releases API (`/repos/loki94in/AI-PHARMACY-V3/releases/latest`).

---

## 2. Target Architecture & Proposed Changes

### Component 1: Client Auto-Update Service (`src/services/autoUpdateService.ts`)
1. **Differentiate Reasons**:
   - `'boot'`: Runs at T+60s after application launch. **Always** contacts the update server regardless of `last_checked_at`, ensuring every restart detects new releases.
   - `'interval'`: Runs every 2 hours in the background while the PC is idle. Throttled to at most once every 24 hours (`intervalDays = 1`).
   - `'manual'`: Triggered by user from Settings → License & Updates tab ("Check Now"). Always runs immediately and broadcasts completion event.
2. **Safe Exception Handling**:
   - If the PC is offline or the server is temporarily unreachable, silently log and fail gracefully without interrupting pharmacy operations (as mandated by `PRODUCTION.md §13`).

### Component 2: Database Schema & Migration (`src/database.ts`)
1. Change default `check_interval_days` from `15` to `1` in `update_checks` DDL.
2. Add automatic schema upgrade in `ensureSchema` / migrations:
   ```sql
   UPDATE update_checks SET check_interval_days = 1 WHERE check_interval_days > 1;
   ```
   Ensures all existing pharmacy installations transition from the 15-day delay to a 1-day background interval.

### Component 3: Resilient Update Server (`website/api/updates.js`)
1. Update `DEFAULT_LATEST_VERSION` to `0.1.144`.
2. Add dynamic fallback to GitHub Releases API (`https://api.github.com/repos/loki94in/AI-PHARMACY-V3/releases/latest`) when KV is unpopulated or out of date, so releases uploaded to GitHub are never invisible to clients.

### Component 4: Vercel KV Publish Sync
1. Publish `v0.1.144` metadata to Vercel KV with verified SHA-256 (`56cc6909ed21a35703f19624a48a568499a45032303abb9c25ce4cbf64ffbdaa`) from `dist/installer/update-manifest.json`.

---

## 3. Human-in-the-Loop Workflow (Rule 6)

1. The app automatically detects new versions and downloads the 105 MB update package in the background without freezing or interrupting billing.
2. Once downloaded and SHA-256 verified, the app displays a prominent top banner:
   - **"Update v0.1.144 Ready — Install & Restart"**
   - **"Remind Me Later"**
3. A human pharmacist always maintains control:
   - Clicking **"Install & Restart"** triggers the graceful shutdown and runs `Updater.bat`.
   - Clicking **"Remind Me Later"** silences the banner for the active shift.
   - Pharmacists can manually initiate checks or installs at any time from Settings → License & Updates.

---

## 4. Verification Plan

1. **Unit & Database Check**:
   - Verify `update_checks` table has `check_interval_days = 1`.
2. **Boot Check Verification**:
   - Trigger `autoUpdateService.start()` simulation and verify that a boot check executes even when `last_checked_at` is set to the current minute.
3. **Guardrails Audit**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`) to verify zero rule violations.
4. **End-to-End API Test**:
   - Query `/api/license/update-status` and `/api/license/check-update` to verify `hasUpdate: true`, `latestVersion: "0.1.144"`, and `readyToInstall` status.

---

## 5. Tasks & Progress Tracking

- [x] Task 1: Fix `src/services/autoUpdateService.ts` to implement separate `'boot'` check logic (bypassing interval throttle on every restart) and `'interval'` check logic (1-day throttle).
  - *Completed*: Separated `reason: 'boot' | 'interval' | 'manual' | 'auto'`. Startup `setTimeout` now passes `'boot'` which skips the interval gate so every app restart checks immediately. Background interval polling enforces a 24-hour gate while idle.
- [x] Task 2: Update `src/database.ts` schema and migration to set `check_interval_days = 1` for existing and new databases.
  - *Completed*: Changed default `check_interval_days` from 15 to 1 in table DDL, and added migration in `ensureOrderTimingSchema` (`UPDATE update_checks SET check_interval_days = 1 WHERE check_interval_days > 1`) that runs on both fast-boot and full schema migration paths.
- [x] Task 3: Enhance `website/api/updates.js` with GitHub Releases API fallback and update default version constants.
  - *Completed*: Bumped `DEFAULT_LATEST_VERSION` to `0.1.144` with accurate SHA-256 and URLs. Added `fetchLatestGitHubRelease()` that queries GitHub Releases API when KV is unpopulated or out of date.
- [x] Task 4: Publish verified `v0.1.144` release metadata (with matching SHA-256 checksum) to the Vercel update server.
  - *Completed*: Sent authenticated `POST /api/updates?action=publish` to Vercel KV with verified SHA-256 (`56cc6909ed21a35703f19624a48a568499a45032303abb9c25ce4cbf64ffbdaa`). Verified `GET /api/updates/check` returns `latestVersion: "0.1.144"` with `hasUpdate: true`.
- [x] Task 5: Verify via `npm run guardrails` and live API endpoints.
  - *Completed*: Executed local update verification script confirming `checkForUpdate()` and `autoUpdateService.triggerCheck()` cleanly discover `0.1.144` and initiate background download. `npm run guardrails` passed with 0 violations. Updated knowledge graph via `node scripts/quick-update.mjs`.
