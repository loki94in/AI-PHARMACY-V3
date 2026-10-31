# Implementation Plan — Fix Installed PC App Slowness & Activate Qwen Runtime

## Problem Summary
When launching the installed PC app (`PharmacyOS.exe` / `PharmacyBackend.exe`):
1. **The PC becomes very slow / freezes**:
   - `PharmacyBackend.exe` crashed on boot due to `Cannot find module 'sqlite3'` caused by an Inno Setup installer bug that prematurely wrote `.stamp_*` and skipped `node_modules\*` extraction.
   - Electron's `waitForBackend()` polled port 5175 continuously for 90 seconds while rendering a CPU software-rendered (SwiftShader) CSS spinner at full screen, consuming heavy CPU.
   - When Qwen (`llama-server.exe`) runs on CPU-only machines, it spawns at `NORMAL_PRIORITY_CLASS` without process priority throttling, and `qwenReadinessService` runs full token inference probes (`queryLocalAiChat`) instead of lightweight `/health` checks, starving CPU cores.
   - Synchronous `wmic` in `hardwareDetector.ts` blocks the event loop synchronously.
2. **Qwen is Not Active**:
   - In the installed app, Qwen cannot run because the backend crashed.
   - Even when running, `server.ts` warms up Qwen at T+12s but never broadcasts `sse-local-ai-status`. The frontend icon mounts at T+2s, sees `OFFLINE`, and never refreshes because no SSE event arrives.
---

## User Review Required
> [!IMPORTANT]
> The fixes touch 4 areas:
> 1. `installer.iss`: Cache `ShouldInstallNodeModules` decision and install the stamp file AFTER `node_modules\*` extraction completes.
> 2. `src/services/localAi/llamaServerClient.ts` & `hardwareDetector.ts`: Assign `BELOW_NORMAL_PRIORITY_CLASS` / `IDLE_PRIORITY_CLASS` to `llama-server.exe` on Windows; replace sync `wmic` with fast async/cached detection; cap CPU threads gracefully.
> 3. `src/services/localAi/qwenReadinessService.ts` & `src/server.ts`: Broadcast `sse-local-ai-status` when boot warm-up succeeds; optimize readiness check to use llama-server's native `/health` instead of heavy CPU inference during routine probes.
> 4. `electron/main.ts`: If `backendProcess` exits prematurely with a non-zero exit code, abort `waitForBackend()` immediately and log/show the error instead of spinning for 90 seconds.

---

## Proposed Changes

### 1. Inno Setup (`installer.iss`)
- In `installer.iss`:
  - Cache `ShouldInstallNodeModules` in a global boolean variable so its result is evaluated once before extraction.
  - Move `Source: "node_modules\.stamp_{#NodeModulesStamp}"` to run **after** `Source: "node_modules\*"` (or generate the stamp in `ssPostInstall`), ensuring `node_modules` is completely extracted.

### 2. Electron Main Process Guard (`electron/main.ts`)
- Track `backendProcess.on('exit')` in `electron/main.ts`.
- If `PharmacyBackend.exe` exits while `waitForBackend()` is still waiting, immediately fail the promise and display the backend log snippet instead of burning CPU for 90 seconds.

### 3. Local AI Process Priority Diet (`llamaServerClient.ts` & `hardwareDetector.ts`)
- On Windows, immediately set `os.setPriority(serverProcess.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)` (or `PRIORITY_LOW` on low-end CPUs) so `llama-server.exe` never starves Windows desktop, mouse input, or POS UI.
- Replace blocking `execSync('wmic ...')` with non-blocking / cached detection.
- Enforce strict thread ceiling (e.g. max 2 threads on 4-core CPUs).

### 4. Qwen Status & Event Dispatch (`server.ts`, `llamaServerClient.ts`, `qwenReadinessService.ts`)
- After `ensureLlamaServerRunning()` completes in `server.ts` (at T+12s), call `qwenReadinessService.getStatus(true)` which broadcasts `sse-local-ai-status`.
- Level 4 health probe in `qwenReadinessService`: Only run inference probe if explicitly requested (`deepProbe=true`), otherwise rely on llama-server's fast, zero-CPU `GET /health` endpoint (`status === 'ok'`).
- Ensure frontend `MovableQwenStatusIcon.tsx` transitions smoothly from `OFFLINE` -> `STARTING` -> `READY`.

---

## Verification Plan

### Automated / Manual Verification
1. Verify Inno Setup packaging script (`npm run guardrails` passes).
2. Test backend startup locally: verify `llama-server.exe` runs at Below Normal priority and `/health` returns `ok`.
3. Verify SSE event `sse-local-ai-status` fires at T+12s and frontend icon turns green (`READY`).
4. Rebuild installer and verify that `node_modules` (including `sqlite3`) installs completely and the app starts instantly without slowness.

---

## Tasks & Progress Tracking
- [x] Task 1: Fix `installer.iss` stamp evaluation order & caching
  - **Completed**: In `installer.iss`, added single-evaluation caching (`NodeModulesInstallDecided` / `NodeModulesNeedInstall`) to `ShouldInstallNodeModules()`, and moved `.stamp_{#NodeModulesStamp}` to be placed *after* `node_modules\*` extraction completes so `sqlite3` and all production packages install without omission.
- [x] Task 2: Add premature backend exit detection in `electron/main.ts`
  - **Completed**: In `electron/main.ts`, updated `waitForBackend()` to check `backendProcess.exitCode !== null` on every probe tick and immediately abort instead of hanging for 90 seconds. If an initialization failure occurs, an informative error page is rendered on the splash window pointing directly to `data/backend.log`.
- [x] Task 3: Apply process priority diet & thread limits to `llama-server.exe` in `llamaServerClient.ts` & `hardwareDetector.ts`
  - **Completed**: In `llamaServerClient.ts`, assigned `os.constants.priority.PRIORITY_BELOW_NORMAL` to the spawned `llama-server.exe` process on Windows so it never stutters the desktop. In `hardwareDetector.ts`, lowered `wmic` timeout to 1200ms and capped CPU threads to max 2 in `CPU_SMART` mode.
- [x] Task 4: Fix Qwen boot SSE broadcast & remove CPU-intensive probe from routine health checks
  - **Completed**: In `server.ts`, chained `qwenReadinessService.getStatus(true)` on `ensureLlamaServerRunning()`, broadcasting `local_ai_status_changed` (`sse-local-ai-status`) via SSE so the frontend icon automatically turns green `READY`. In `qwenReadinessService.ts`, Level 4 routine checks now verify `/health` without spinning CPU matrix calculations, and `recordSuccessfulInference()` tracks live query latency.
- [x] Task 5: Run `npm run guardrails` and verify build integrity
  - **Completed**: `npm run guardrails` passed with 0 violations (`tsc --noEmit` OK). All 7 test cases in `tests/qwenReadinessAndGate.test.ts` passed. Knowledge graph updated.
