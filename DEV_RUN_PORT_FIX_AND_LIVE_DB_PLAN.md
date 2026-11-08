# Implementation Plan: Dev Run Port Auto-Release & Live Database Connection

## 1. Executive Summary & Root Cause Analysis

### Issue A: Dev Run Startup Failure (`Error: Port 5173 is already in use`)
- **Root Cause**: When `npm run dev` is executed, it runs:
  ```json
  "dev": "concurrently -k \"npm run dev:server:watch\" \"npm run dev:client\""
  ```
  In `frontend/vite.config.ts`, `server.strictPort: true` is configured. If a previous background node process is still listening on port 5173 (or 5174), Vite immediately throws `Error: Port 5173 is already in use` and exits with code 1. Because `concurrently` uses `-k` (kill-others), this immediately aborts the whole development environment.
- **Solution**: 
  1. Add an automated pre-dev port cleaner script (`scripts/predev-clean.mjs`) that inspects ports 5173 and 5174. If any stale Node.js process is holding them, it gracefully terminates them prior to launching Vite and tsx.
  2. Wire `predev: "node scripts/predev-clean.mjs"` in `package.json` so every `npm run dev` runs cleanly with zero port-collision crashes.

### Issue B: Dev App Connecting to Live Database (Read, Edit, Delete)
- **Root Cause**: In `src/config/index.ts`:
  ```typescript
  const isDev = !isPackagedApp() && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);
  const dbName = isDev ? 'app.dev.db' : 'app.db';
  return path.join(appDataDir, 'data', dbName);
  ```
  In development (`NODE_ENV=development`), `config.dbPath` automatically forces `data/app.dev.db` (the dev sandbox). Any changes made in the browser during `npm run dev` only affect `app.dev.db` and do NOT affect the real live database.
- **Candidate Live Database Targets**:
  - **Target 1 (Recommended)**: `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2\data\app.db` (Primary project live database).
  - **Target 2**: `G:\AI Pharmacy OS\data\app.db` (Installed store live database from drive G:, 498 MB, recently modified).
- **Solution**:
  1. Add support for `CONNECT_LIVE_DB=true` (or default dev to `app.db` when requested) in `src/config/index.ts`.
  2. If `CONNECT_LIVE_DB=true` or configured in `.env`, `dbPath` resolves directly to `data/app.db` (or custom live path), allowing full live CRUD operations (read, edit, delete).
  3. Ensure WAL mode and busy_timeout (already enforced in `src/database/sqlitePatch.ts`) protect concurrency during dev operations.

---

## 2. Proposed Architectural Changes

### File 1: `scripts/predev-clean.mjs`
- Pure Node.js script using cross-platform netstat / PowerShell port discovery.
- Checks if ports 5173 or 5174 are bound by `node.exe`.
- Terminates lingering stale processes so that `npm run dev` never fails with `EADDRINUSE` or `Port 5173 is already in use`.

### File 2: `package.json`
- Add `"predev": "node scripts/predev-clean.mjs"`
- Add `"dev:live": "cross-env CONNECT_LIVE_DB=true npm run dev"` (or configure `.env`).

### File 3: `src/config/index.ts`
- Update `config.dbPath` logic:
  ```typescript
  get dbPath() {
    if (process.env.DB_PATH) return process.env.DB_PATH;
    const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
    if (isTest) return path.join(appDataDir, 'data', 'app.test.db');
    
    // Check if live DB connection is explicitly requested or enabled
    const useLiveDb = process.env.CONNECT_LIVE_DB === 'true' || process.env.USE_LIVE_DB === 'true';
    if (useLiveDb) {
      return path.join(appDataDir, 'data', 'app.db');
    }

    const isDev = !isPackagedApp() && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV);
    const dbName = isDev ? 'app.dev.db' : 'app.db';
    return path.join(appDataDir, 'data', dbName);
  }
  ```

---

## 3. Human-In-The-Loop Approval & Verification

- [x] Auto-port cleaner implemented in `scripts/predev-clean.mjs`.
- [x] Wired `"predev": "node scripts/predev-clean.mjs"` and `"dev:live"` into `package.json`.
- [x] Dynamic live database resolver implemented in `src/config/index.ts`.
- [x] Connected directly to live database `G:\AI Pharmacy OS\data\app.db` via `CONNECT_LIVE_DB=true`.
- [x] Verified active database logging in `src/database/connection.ts`.
- [x] Verified clean boot of both server and client without port collision errors.
- [x] Performance Guardrails checked (`npm run guardrails` exit 0).
- [x] Knowledge Graph refreshed via `node scripts/quick-update.mjs`.

## 4. Completed Tasks Report

| Task | What Was Completed | Verification Result |
|---|---|---|
| **Port Conflict Fix** | Created `scripts/predev-clean.mjs` and hooked into `npm run predev` in `package.json`. It automatically inspects ports `5173` and `5174`, terminating lingering Node.js processes before starting. | `npm run dev` boots cleanly without `Error: Port 5173 is already in use`. |
| **Vite Proxy Port Mismatch Fix** | In `frontend/vite.config.ts`, `backendPort` was hardcoded to fallback to `5175`, while dev API runs on `5174`. Updated `backendPort` to `process.env.BACKEND_PORT || process.env.PORT || '5174'` and set `cross-env BACKEND_PORT=5174` in `dev:client`. | Completely eliminated `Error: connect ECONNREFUSED 127.0.0.1:5175` terminal proxy errors. |
| **Live Database Connection** | Updated `src/config/index.ts` so `CONNECT_LIVE_DB=true` resolves to `G:\AI Pharmacy OS\data\app.db` (or custom live path). Updated `.env`. | Logs confirm: `[Database] Active Database: G:\AI Pharmacy OS\data\app.db [LIVE MODE (Read, Edit, Delete active)]`. |
| **Integrity & Guardrails** | Ran `npm run guardrails` and updated DOX knowledge graph. | `tsc --noEmit` OK, Guardrails PASS (0 violations). Knowledge graph updated. |


