# Electron Silent Backend Startup Implementation Plan

## Objective
Completely eliminate the visible black Command Prompt / Node console window when launching the installed Electron desktop app (`PharmacyOS.exe`). Ensure the backend process runs 100% silently in the background with `windowsHide: true`, pipe logs silently to disk for diagnostics, and recompile the Electron bundle.

---

## Tasks Checklist

- [x] **TASK 1 — Update `electron/main.ts` with Silent Process Spawning**
  - Added `windowsHide: true` to `child_process.spawn()` options in `electron/main.ts`.
  - Configured `stdio: ['ignore', 'pipe', 'pipe']` so Windows never creates or connects a console terminal window.
  - Redirected stdout and stderr streams silently to `data/backend.log` with clean stream closing on child termination.
  - In non-packaged development mode, mirrored output to `process.stdout`/`process.stderr` for terminal developer convenience.

- [x] **TASK 2 — Compile Electron Main Process Scripts**
  - Compiled `electron/main.ts` using esbuild into `dist/electron/main.cjs`.
  - Staged the updated `main.cjs` into `dist/resources/app/main.cjs` for immediate runtime execution.

- [x] **TASK 3 — Guardrails & Verification**
  - Ran `npm run guardrails` — passed with 0 violations (`tsc --noEmit` OK, speed architecture verified).
  - Ran `node scripts/quick-update.mjs` — updated knowledge graph (1,112 nodes, 544 edges in 5.4s).

---

## Task Progress & Execution Log

- **TASK 1**: Enhanced `startBackend()` in `electron/main.ts` to suppress Windows console allocation via `windowsHide: true` and `stdio: ['ignore', 'pipe', 'pipe']`. Streamed backend output to `data/backend.log` on disk.
- **TASK 2**: Compiled `dist/electron/main.cjs` via esbuild and mirrored it to `dist/resources/app/main.cjs`.
- **TASK 3**: Performance guardrails and knowledge graph synchronization executed successfully. Ready for deployment.
