# Implementation Plan: Movable Qwen Status Icon + Local AI Chat + Safe Automation Gating

## Overview & Architecture Context
Based on the verified blueprint for AI-PHARMACY-V3:
- Local Qwen runtime: Qwen3-1.7B Q4_K_M on CPU-only (`--n-gpu-layers 0`, `-ngl 0`), dynamic port hunting (8089+).
- Health monitoring: Moved from single Boolean check to explicit 5-level readiness state machine:
  `UNKNOWN`, `DISABLED`, `NOT_INSTALLED`, `STARTING`, `READY`, `BUSY`, `DEGRADED`, `OFFLINE`, `ERROR`.
- UI: Floating draggable Qwen status icon in `Layout.tsx` with viewport boundaries, position persistence (`localStorage`), keyboard accessibility, and 4 semantic visual states (Green / Yellow / Red / Grey).
- Safe Automation Gate: `aiAutomationGate.ts` classifying jobs into Class A (Qwen-dependent), Class B (Qwen-optional), Class C (Qwen-independent), with persistent manual pause/resume via `app_settings`.
- Zero duplicate execution, zero mock UI, strict No-GPU compliance, and full preservation of existing POS/refill/inventory workflows.

---

## Completed Architecture & Implementation Details

### Phase 1: Authoritative Readiness State Machine & 5-Level Health Monitor
- **`src/services/localAi/qwenReadinessService.ts`**:
  - Implements 5 levels:
    - Level 1: Configuration (`isLocalAiEnabled`)
    - Level 2: Asset validation (`validateLocalAiAssets`, GGUF presence)
    - Level 3: Process & loopback endpoint health check (`llama-server` /health)
    - Level 4: Bounded non-destructive test inference probe with timeout
    - Level 5: Stale-state protection (45s cache TTL, single-flight probe mutex)
  - Manages states: `UNKNOWN`, `DISABLED`, `NOT_INSTALLED`, `STARTING`, `READY`, `BUSY`, `DEGRADED`, `OFFLINE`, `ERROR`.
  - Exposes `getStatus()`, `isReady()`, `invalidateCache()`, and broadcasts SSE events (`local_ai_status_changed`).

### Phase 2: Safe Backend Automation Gate
- **`src/services/localAi/aiAutomationGate.ts`**:
  - Manages AI gate state (`open`, `paused`, `blocked`).
  - Classifies tasks:
    - `CLASS_A_DEPENDENT`: Requires Qwen; if offline or paused, safely queues or defers with retryable reason.
    - `CLASS_B_OPTIONAL`: Continues deterministic core flow; skips or gracefully degrades optional AI enrichment.
    - `CLASS_C_INDEPENDENT`: Bypasses AI gate entirely (POS, stock ledger, non-AI scheduled tasks).
  - Persists manual pause toggle in `app_settings` (`ai_automation_paused`).
- **`src/routes/localAi.ts`**:
  - Upgraded `GET /api/local-ai/status` with full 5-level readiness data and gate status.
  - Added `POST /api/local-ai/retry-start` for explicit user-triggered runtime recovery.
  - Added `GET /api/local-ai/automation-status` and `POST /api/local-ai/automation-pause`, `POST /api/local-ai/automation-resume`.

### Phase 3: Frontend Movable Qwen Status Icon
- **`frontend/src/components/MovableQwenStatusIcon.tsx`**:
  - Floating draggable icon with mouse and touch support.
  - Minimum drag threshold (5px) to prevent accidental clicks while dragging.
  - Viewport boundary clamp (keeps icon at least 16px from edges, adapts to window resizing).
  - Persists coordinates to `localStorage` (`qwen_icon_pos`) with bounds validation on mount.
  - Keyboard accessibility: Focusable, Arrow keys move position by 20px, Enter/Space toggles assistant modal or popover, Escape closes popover.
  - Visual status pill:
    - Green (`READY`): Model responsive, verified inference.
    - Yellow (`STARTING` / `BUSY`): Booting or inference slot busy.
    - Red (`OFFLINE` / `DEGRADED` / `ERROR`): Runtime unreachable or probe failure.
    - Grey (`DISABLED` / `NOT_INSTALLED`): Local AI off or missing assets.
  - Quick status popover displaying latency, active port, gate state, quick start/retry button, and pause/resume button.
- **`frontend/src/components/Layout.tsx`**:
  - Mounted `<MovableQwenStatusIcon onOpenAssistant={() => setShowAssistantModal(true)} />`.
- **`frontend/src/hooks/useGlobalSseInvalidation.ts`**:
  - Mapped backend SSE events `local_ai_status_changed` and `ai_gate_status_changed` to react-query cache keys and window custom events (`sse-local-ai-status`, `sse-ai-gate-status`).

---

## Verification Evidence & Test Results

1. **Unit Tests**:
   - `tests/qwenReadinessAndGate.test.ts`: All 6 tests passed (state evaluation, single-flight probe, gate status, Class C pass-through, Class B fallback, manual pause/resume).
   - `tests/conversationalAgentEngine.test.ts`: All 23 tests passed (`23 passed, 0 failed`).
2. **Performance Guardrails**:
   - `npm run guardrails`: Exit code 0 (`PASS — no guardrail violations. Speed architecture intact.`).
   - Clean TypeScript compilation (`tsc --noEmit`).
   - Database schema & integrity verified.
3. **Auto-Knowledge Graph**:
   - `node scripts/quick-update.mjs`: Synced 1327 files (4 new, 10 changed) in 3.4s.

---

## Task Progress & Execution Log
- [x] Task 1: Create `src/services/localAi/qwenReadinessService.ts`
- [x] Task 2: Create `src/services/localAi/aiAutomationGate.ts`
- [x] Task 3: Update `src/routes/localAi.ts` with readiness & gate endpoints
- [x] Task 4: Create `frontend/src/components/MovableQwenStatusIcon.tsx`
- [x] Task 5: Mount Movable Qwen Icon in `frontend/src/components/Layout.tsx`
- [x] Task 6: Unit tests & zero-bugs gate (`tests/qwenReadinessAndGate.test.ts`, `npm test`, `npm run guardrails`)
- [x] Task 7: Knowledge Graph update & Final Section 24 Report

---

## Section 24 Final Mandatory Report (BACKEND SCHEMA SAFETY)

```
======================= SECTION 24 FINAL MANDATORY REPORT =======================
1. Architecture & State Safety:
   - Evaluates Qwen readiness across 5 distinct levels (Config, Assets, Process, Inference, TTL Cache).
   - 9 explicit state enum: UNKNOWN, DISABLED, NOT_INSTALLED, STARTING, READY, BUSY, DEGRADED, OFFLINE, ERROR.
   - Replaced Boolean assumption with bounded non-destructive inference probe and single-flight execution.
2. Safe Automation Gate:
   - aiAutomationGate enforces Class A (Qwen-dependent), Class B (Qwen-optional), Class C (Qwen-independent).
   - Class C (POS billing, inventory calculations, queue sends) never blocked when Qwen is offline.
   - Operator manual pause persisted in app_settings table (key: 'ai_automation_paused').
3. Movable Qwen UI Contract:
   - Draggable floating widget clamped to viewport boundaries.
   - Persisted coordinates to localStorage ('qwen_icon_pos').
   - Keyboard accessible (Arrow keys move 20px, Enter/Space toggles).
   - Semantic tokens: bg-bg2, text-text, text-muted, border-border (theme toggle safe).
   - No GPU contract: Zero backdrop-filter, zero infinite animations, CPU-only inference preserved.
4. Guardrails & Compilation:
   - tsc --noEmit: OK (0 errors).
   - npm run guardrails: PASS (0 violations).
   - Jest Test Suites: 100% passing (qwenReadinessAndGate: 6/6, conversationalAgentEngine: 23/23).
5. Auto-Knowledge Graph: Updated across 1327 files in 3.4s.
================================================================================
```
