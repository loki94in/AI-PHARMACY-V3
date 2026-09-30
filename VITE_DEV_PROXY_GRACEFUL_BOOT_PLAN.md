# Vite Dev Proxy Graceful Startup & Boot Synchronization Plan

## 1. Problem Statement & Root Cause Analysis
- **Observed Behavior**: During `npm run dev`, `concurrently` starts the Express backend (`tsx src/bootstrap.ts`) and the Vite frontend dev server (`npm run dev --prefix frontend`) concurrently.
- **Root Cause**:
  1. Vite dev server starts almost instantaneously (< 150ms) on `http://127.0.0.1:5173`.
  2. The browser (or previously open tab) connects immediately and attempts to open `/api/notifications/stream` (SSE) and fetch initial data.
  3. The backend is in **Phase 1 Boot** (database schema verification, WAL mode, indexing, worker initialization) and has not yet bound to `http://127.0.0.1:5174`.
  4. Vite's underlying `http-proxy` tries to connect to `127.0.0.1:5174`, receives `ECONNREFUSED`, and logs an unhandled error stack trace to the console terminal.
  5. Once Phase 1 completes and the backend begins listening, the frontend automatically establishes the SSE stream, meaning the error is a transient startup timing artifact.

---

## 2. Desired Outcome
1. **Clean Developer Console**: Suppress raw `ECONNREFUSED` stack dumps during the initial 1–2 second backend warm-up window.
2. **Graceful Proxy Handling**: Configure Vite proxy in [`frontend/vite.config.ts`](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/vite.config.ts) to intercept transient `ECONNREFUSED` errors and respond with a clean `503 Service Unavailable (Backend Booting)` header/status or silent retry.
3. **Frontend Reconnection Resilience**: Ensure SSE `EventSource` in [`frontend/src/hooks/useGlobalSseInvalidation.ts`](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/useGlobalSseInvalidation.ts) backs off gracefully and reconnects cleanly once the backend is ready.
4. **Human-in-the-Loop Safeguard**: Allow the user to review and verify startup behavior across development and production modes.

---

## 3. Step-by-Step Implementation Tasks

- [x] **Task 1: Enhance Vite Proxy Configuration in `frontend/vite.config.ts`**
  - Add proxy error listeners on `/api`, `/uploads`, `/data`, and `/products`.
  - Check if `err.code === 'ECONNREFUSED'`.
  - When backend is booting, return a clean `503 (Backend initializing)` JSON response instead of crashing or logging an unhandled proxy error stack trace.

- [x] **Task 2: Verify SSE & Fetch Resilience in Frontend**
  - Verify that `useGlobalSseInvalidation.ts` and React Query client retry transient `503` booting responses smoothly without user-facing alert disruptions.

- [x] **Task 3: Run Guardrails & Type Safety Verification**
  - Ran `npm run guardrails` (TypeScript `tsc --noEmit` + guardrail checks passed cleanly).
  - Executed `node scripts/quick-update.mjs` to keep knowledge graph up to date.

- [x] **Task 4: Human-in-the-Loop Review**
  - Final human review and confirmation of graceful proxy boot handling.
