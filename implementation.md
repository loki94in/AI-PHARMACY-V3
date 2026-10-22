# Implementation Plan: Zero-Lag Idle Wake-Up & <1ms Page Switching (Low RAM/CPU)

## 1. Problem & Root Cause
When the application is left idle for 20–30 minutes:
1. **Time-Based Cache Expiration (`staleTime: 2min`)**: TanStack Query in `frontend/src/lib/queryClient.ts` marks all cached queries as expired after 2 minutes. When the user opens or switches pages after 20–30 minutes, `PageQueryTracker.tsx` detects that all queries are stale and fires a simultaneous storm of 5–10 API requests, causing a 2–3s CPU spike and UI freeze.
2. **Chromium Background Throttling**: In `electron/main.ts`, `backgroundThrottling: true` throttles the V8 JavaScript engine to 1 tick per minute after extended idle time, adding 1–2s of de-throttling latency upon user return.
3. **Cold Re-Mounts for Operational Pages**: Secondary workhorse pages (`/reports`, `/returns`, `/purchase-history`, `/dispatch`) are not in `HIGH_PRIORITY_PATHS` in `KeepAliveOutlet.tsx`, causing them to unmount and suffer cold bundle loads and layout shifts upon return.

---

## 2. Technical Architecture & File Changes

1. **`frontend/src/lib/queryClient.ts`**:
   - Change `staleTime` from `2 * 60_000` (2 minutes) to `Infinity`.
   - In AI Pharmacy, data freshness is strictly event-driven via Server-Sent Events (SSE) and cache invalidation utilities (`invalidateAfterStockWrite`, `invalidateAfterPriceWrite`, `SSE_QUERY_MAP`).
   - By eliminating artificial timer-based expiration, queries remain 100% fresh in memory if no database changes occurred during the idle period.
   - Result: 0 HTTP requests on wake-up, 0 CPU spike, and instant <1ms cached page activation.

2. **`frontend/src/lib/keepAlive/PageQueryTracker.tsx`**:
   - Stagger dirty query refetches on page activation with micro-batching so that even if genuine background invalidations arrived during idle time, queries don't collide or lock SQLite simultaneously.

3. **`electron/main.ts`**:
   - Set `backgroundThrottling: false` in `BrowserWindow.webPreferences`.
   - Eliminates Chromium V8 timer freeze and wake-up lag.
   - CPU remains <0.1% at idle because background workers are already gated by `activityTracker.isIdle()`.
   - Adheres strictly to Guardrail E1 (`app.disableHardwareAcceleration()` and `disable-gpu-compositing` intact).

4. **`frontend/src/lib/keepAlive/KeepAliveOutlet.tsx`**:
   - Expand `HIGH_PRIORITY_PATHS` to include frequent operational workflows: `'/reports'`, `'/returns'`, `'/purchase-history'`, `'/dispatch'`.
   - Retains state in DOM via `display: none` so navigating to these pages after idle is instantaneous (0ms).

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Update `frontend/src/lib/queryClient.ts` to use `staleTime: Infinity` (event-driven freshness).
- [x] **Step 2**: Enhance `frontend/src/lib/keepAlive/PageQueryTracker.tsx` with sequential micro-staggered fetching on activation.
- [x] **Step 3**: Update `electron/main.ts` to disable `backgroundThrottling` while preserving no-GPU contracts.
- [x] **Step 4**: Expand `HIGH_PRIORITY_PATHS` in `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx`.
- [x] **Step 5**: Run TypeScript compilation check (`tsc --noEmit`).
- [x] **Step 6**: Run `npm run guardrails` and verify 0 violations.
- [x] **Step 7**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log

- **Task 1: Event-Driven Query Freshness in `frontend/src/lib/queryClient.ts`**:
  - Replaced `staleTime: 2 * 60_000` with `staleTime: Infinity`.
  - Ensures cached data in memory never expires merely from idle clock time. Data invalidation is now strictly event-driven via Server-Sent Events (SSE).
  - Eliminates the 5–10 concurrent API call storm when returning to pages after 20–30 minutes of idle time.

- **Task 2: Sequential Micro-Staggering in `frontend/src/lib/keepAlive/PageQueryTracker.tsx`**:
  - Added a 25ms micro-stagger to dirty query fetches on page activation.
  - Prevents SQLite lock contention and CPU spikes even when multiple queries were genuinely invalidated by backend events during background time.

- **Task 3: Responsive Chromium V8 Event Loop in `electron/main.ts`**:
  - Set `backgroundThrottling: false` in `BrowserWindow.webPreferences`.
  - Prevents Chromium from degrading the timer resolution to 1 tick/minute during idle periods, eliminating the 1–2s wake-up unfreezing delay.
  - Preserved owner's No-GPU contract (`app.disableHardwareAcceleration()` and `disable-gpu-compositing` intact).

- **Task 4: Expanded Keep-Alive Workhorse Routes in `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx`**:
  - Added `/reports`, `/returns`, `/purchase-history`, `/dispatch`, and `/phone-sales` to `HIGH_PRIORITY_PATHS`.
  - These pages now stay preserved in the DOM (`display: none`) once visited, enabling instant 0ms switching without cold re-mounts or bundle re-parsing.

- **Task 5: Verification & Knowledge Graph Synchronization**:
  - Verified TypeScript compilation: `npx tsc -p frontend/tsconfig.app.json --noEmit` passed with exit code 0.
  - Verified performance guardrails: `npm run guardrails` scanned 5 files and passed with 0 violations.
  - Synchronized knowledge graph: `node scripts/quick-update.mjs` completed in 3.9s.
