# Implementation Plan: App Startup Optimization & Dev-Mode Latency Elimination

**Goal:** Eliminate startup latency, UI lag, and process contention when opening AI Pharmacy OS (especially alongside Antigravity IDE in `npm run electron:dev`) by reusing the active dev server, lazy-loading heavy startup evaluations until after the UI is interactive, and throttling eager route compilation in dev mode.

---

## 1. Root Cause & Architectural Strategy

1. **Duplicate Backend Spawn & Process Kill in `electron:dev`**:
   - `npm run electron:dev` starts `dev:server` (`tsx src/bootstrap.ts`) on port 5175 via `concurrently`.
   - `wait-on` waits for port 5175 and then starts `electron electron/main.ts`.
   - `electron/main.ts` executed `reclaimPort(PORT)`, found PID listening on 5175, killed it with `taskkill /F /T`, and spawned a *duplicate* backend instance.
   - **Fix:** In `electron/main.ts`, probe port 5175 in dev mode (`!app.isPackaged`). If the backend is already alive and responding, adopt it directly. Do not kill port 5175 or spawn a duplicate process.

2. **Eager Route Pre-warming CPU Thrashing in Dev Mode**:
   - `startTieredPreWarm()` in `src/server.ts` concurrently imported and compiled 25+ TypeScript route modules via `tsx` on the fly within seconds of boot.
   - **Fix:** In dev mode (`!isPackagedApp()`), bypass eager pre-warming. `lazyRoute` loads routes on-demand when requested by the frontend, eliminating the boot-time CPU spike.

3. **Startup Evaluation Storm (Phase 3 & Phase 4 Contention)**:
   - Phase 3 was running after only 8 seconds, right as the frontend window finishes loading and makes its initial API queries (compact inventory, dashboard, settings, refills panel).
   - Synchronous SQLite queries (`checkAllRefills`, `checkOverdueCreditNotes`, `scanAndCreateExpiryReviews`, `expiryScan`, `monthlyReports`) locked the Node event loop and starved the CPU software renderer (SwiftShader).
   - **Fix:** Defer Phase 3 background catch-up evaluations to 30 seconds after boot (or until the user is idle), giving the UI 100% uninterrupted CPU time to mount, hydrate, and paint.

4. **Preserve All Security, DB Safety, and Guardrails**:
   - Guardrail E1 (`app.disableHardwareAcceleration()` and `disable-gpu-compositing`) remains strictly intact in `electron/main.ts`.
   - SQLite WAL mode and schema integrity remain untouched.

---

## 2. Step-by-Step Implementation Steps

### Step 1: Optimize `electron/main.ts` Dev-Mode Backend Attachment
- Add a lightweight health probe helper (`probeBackendAlive(port: number, timeoutMs: number): Promise<boolean>`).
- In `app.whenReady()`:
  - If `!app.isPackaged`: check if backend is already alive on port 5175.
  - If alive, set `isExternalDevBackend = true`, skip `reclaimPort(PORT)`, skip `startBackend()`, and immediately load the window once ready.
  - If not alive or in packaged mode, proceed with standard single-instance port reclamation and `startBackend()`.
- In `window-all-closed`:
  - If `isExternalDevBackend`, let `concurrently` handle the process lifecycle cleanly.

### Step 2: Throttle Route Pre-Warming in Development Mode (`src/server.ts`)
- In `startTieredPreWarm()`:
  - Check if running in development mode (`!isPackagedApp() && process.env.NODE_ENV !== 'production'`).
  - In dev mode, log and exit early: `[Boot] Dev mode detected: deferring route pre-warming (routes load on-demand via lazyRoute)`.
  - In production mode, retain the existing staggered tiered pre-warm.

### Step 3: Defer Phase 3 Heavy Startup Evaluations to Post-Interactive Window (`src/server.ts`)
- Stagger Phase 3 execution:
  - Increase delay from 8s to 25–30s so the first screen gets 100% CPU on dual-core / shared CPU environments.
  - Ensure lightweight stock calculation worker starts cleanly while heavy database catch-up scans (`checkAllRefills`, `checkOverdueCreditNotes`, `scanAndCreateExpiryReviews`, `monthlyReports`) wait until the UI has settled.

### Step 4: Verification, Lint & Guardrails Check
- Run `npx tsc --noEmit` to verify type safety across modified files.
- Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`) to ensure all performance guardrails pass (including Guardrail E1).
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 3. Progress Tracking & Completed Tasks

- [x] Task 1: Dev-mode backend attachment in `electron/main.ts`
  - Completed: Added `checkBackendAlive(timeoutMs)` and `isExternalDevBackend` flag. In development mode (`!app.isPackaged`), if port 5175 is already running and responds 200 on health ready, Electron directly attaches to it without killing port 5175 with `taskkill /F /T` or spawning a duplicate child backend. On window close, it cleanly exits without terminating the dev watch server.
- [x] Task 2: Route pre-warming bypass in dev mode (`src/server.ts`)
  - Completed: Added dev-mode bypass to `startTieredPreWarm`. In dev mode (`!isPackagedApp() && process.env.NODE_ENV !== 'production'`), eager TS compilation of 25+ routes is skipped so routes load on demand via `lazyRoute`, eliminating the boot-time CPU thrashing.
- [x] Task 3: Defer heavy startup evaluations until post-hydration in `src/server.ts`
  - Completed: Deferred WhatsApp session boot restore from T+1.5s to T+12s/20s and Phase 3 startup database scans (`checkAllRefills`, `checkOverdueCreditNotes`, `scanAndCreateExpiryReviews`, `expiryScan`, `monthlyReports`) from T+8s to T+25s/35s. This gives the frontend UI 100% of CPU time to mount, hydrate, and paint without SQLite event-loop blocking.
- [x] Task 4: Run typecheck, performance guardrails, and knowledge graph update
  - Completed: `npx tsc --noEmit` exit 0 (0 errors); `npm run guardrails` exit 0 (0 violations, Guardrail E1 No-GPU contract intact); `node scripts/quick-update.mjs` synchronized knowledge graph (1267 nodes, 808 edges, 10 layers). Updated `SMALL_BUG_FIX_PLAN.md` with entry `[Fixed] P2-102`.
