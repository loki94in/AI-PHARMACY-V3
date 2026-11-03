# Implementation Plan: Fix Electron Session Resume Malformed URL Crash

**Plan Name:** `electron_resume_url_crash_fix`  
**Target:** [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts) & runtime startup resilience.

---

## 1. Problem Statement & Root Cause

### Symptoms
When launching the installed AI Pharmacy OS app (`PharmacyOS.exe`), the blue splash screen appears briefly ("AI Pharmacy OS Starting..." / "Starting ultra-fast engine...") and then the application window suddenly closes by itself without displaying the pharmacy interface.

### Root Cause Analysis
In commit [`ac5700fe`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts#L440-L465), post-update session route resumption was introduced:
```ts
const cleanRoute = cp.route.replace(/^\/+/, '');
targetUrl = `${BACKEND_URL}${cleanRoute}`;
```
- `BACKEND_URL` is defined as `http://127.0.0.1:${PORT}` (e.g. `http://127.0.0.1:5175`) — without a trailing slash.
- `cleanRoute` strips the leading slash from `cp.route` (e.g. `"/settings?tab=license"` becomes `"settings?tab=license"`).
- Consequently, `${BACKEND_URL}${cleanRoute}` produces a malformed URL with no slash separating the port and path:
  `http://127.0.0.1:5175settings?tab=license`
- Calling `mainWindow?.loadURL("http://127.0.0.1:5175settings?tab=license")` in Electron triggers an immediate synchronous URL parse error (`ERR_INVALID_URL (-300)`) and an unhandled Promise rejection.
- Because `loadURL` was unhandled and Electron lacked an uncaught exception / rejection guard, Electron terminates the main process with exit code 1.
- When `mainWindow` is destroyed, `window-all-closed` triggers `gracefulShutdown('CLIENT_EXIT')` on the backend, making the splash screen disappear and the entire app terminate ~2 seconds after opening.
- Additionally, `process.cwd()` was used to locate `data/session_checkpoint.json` instead of the canonical executable directory `exeDir` (`path.dirname(process.execPath)`), and `mainWindow` lacked crash / navigation fallback listeners (`render-process-gone`, `did-fail-load`).

---

## 2. Proposed Architectural Solution

1. **Fix URL Construction in `electron/main.ts`**:
   - Ensure the path always begins with `/`:
     ```ts
     const normalizedRoute = cp.route.startsWith('/') ? cp.route : `/${cp.route}`;
     targetUrl = `${BACKEND_URL}${normalizedRoute}`;
     ```
   - Validate `targetUrl` using `new URL(targetUrl)` before attempting to navigate. If invalid, safely fall back to `BACKEND_URL`.

2. **Wrap `mainWindow.loadURL()` in Fallback Error Handling**:
   - Add `.catch()` to `loadURL(targetUrl)`. If navigation fails for any reason, log a warning and fall back to loading the default `BACKEND_URL`:
     ```ts
     mainWindow?.loadURL(targetUrl).catch((navErr) => {
       console.warn('[ElectronMain] Target URL navigation failed, falling back to app root:', navErr.message);
       mainWindow?.loadURL(BACKEND_URL).catch(() => {});
     });
     ```

3. **Use Canonical Executable Directory**:
   - Resolve `checkpointFile` using `path.join(exeDir, 'data', 'session_checkpoint.json')` rather than `process.cwd()`.

4. **Add Process Crash & Window Protection in Electron**:
   - Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` logging guards in `electron/main.ts` so an unexpected asynchronous error never silently kills the main window.
   - Add `mainWindow.webContents.on('render-process-gone')` and `did-fail-load` handlers with automatic recovery / reload.

5. **Rebuild Binary & Validate**:
   - Recompile TypeScript backend and Electron main process (`npm run build`).
   - Run `npm run guardrails` to confirm zero violations.
   - Verify that launching with an existing `session_checkpoint.json` loads the correct URL without crashing.

---

## 3. Tasks & Verification Checklist

- [x] Task 1: Fix URL concatenation & checkpoint path in [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts)
  - **Completed**: Ensured route always begins with `/` via `normalizedRoute = cp.route.startsWith('/') ? cp.route : `/${cp.route}``, validated via `new URL(candidateUrl)`, and resolved checkpoint using `exeDir` and `process.cwd()` fallbacks.
- [x] Task 2: Add navigation rejection fallback and process safety guards in [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts)
  - **Completed**: Added `.catch()` fallback to `mainWindow.loadURL()` reverting to `BACKEND_URL`, added `process.on('uncaughtException')` and `process.on('unhandledRejection')` logging handlers, and registered `render-process-gone` and `did-fail-load` recovery listeners on `mainWindow.webContents`.
- [x] Task 3: Build & verify
  - **Completed**: Rebuilt with `npm run build`, verified `npm run guardrails` passed (0 violations, clean TypeScript compilation), compiled `dist/electron/main.cjs` and `dist/resources/app/main.cjs` with esbuild, and updated the knowledge graph via `node scripts/quick-update.mjs`.

