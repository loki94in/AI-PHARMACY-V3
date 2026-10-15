# Pharmarack Search & Shutdown Browser Lifecycle — Implementation Tracking

Created At: 2026-10-15T14:05:00+05:30
Source Plan: `PHARMARACK_SEARCH_AND_SHUTDOWN_IMPLEMENTATION_PLAN.md`
Status: COMPLETED

## 1. Goal & Architecture Overview
1. **Headless Browser Registry & Clean Shutdown**:
   - Central registry in `src/utils/chromeBrowser.ts` tracking all headless browser instances and spawned browser processes (Pharmarack token refresh Puppeteer browsers on main and temp profiles, schedule research Puppeteer browsers, Pharmarack login window native Chrome processes).
   - `isShutdownInProgress()` abort flag to immediately reject/prevent background refreshes or heartbeats from launching new browser processes during shutdown.
   - `closeAllHeadlessBrowsers()`: Gracefully races `browser.close()` / process kill within 1.5s timeout, followed by targeted cleanup of orphan lock-holding Chrome processes (`pharmarack_profile`), temp profile folders, and profile lockfiles (`SingletonLock`, `lockfile`, etc.).
   - Integrated into `src/server.ts` `gracefulShutdown()` within the concurrent `Promise.allSettled` block.
2. **Instant Medicine Search Across the Entire App**:
   - Ensure local-first paint (<30ms) from memory caches (`getCompactInventoryCache()`, `searchResultsCache`, prefix narrowing) across search inputs.
   - Detached asynchronous live-append query to `GET /api/pharmarack/search` with monotonic sequence guarding (`searchSeqRef`) and `AbortController` cancellation so typing or selecting never repaints stale results.
   - Maintain strict contracts: no second data source in Purchases, keep autocomplete gating (≥2 chars, ≥3 for cart/purchase rows, never on focus), `.dropdown-scroll` styling, opaque dropdown panels, finite animations (No-GPU contract), no dummy data tokens, and shop-local bill dates.
   - Idle term warmup (gated on visible tab + idle, no timers when hidden) for top frequent terms to leverage disk-backed `searchCache.ts` Stale-While-Revalidate (SWR).
3. **Verification & Quality Standards**:
   - Clean `npm run guardrails` exit 0 (E1 No-GPU, B4 shop-local dates, polling intervals, no dummy tokens).
   - Zero TypeScript compilation errors (`tsc --noEmit` and `npx tsc -b frontend`).
   - Auto-Knowledge Graph updated via `node scripts/quick-update.mjs`.

---

## 2. Technical Tasks Checklist

### Phase 1: Headless Browser Registry & Shutdown Lifecycle
- [x] Task 1: Add headless browser registry (`trackHeadless`, `untrackHeadless`, `isShutdownInProgress`, `markShutdownInProgress`, `closeAllHeadlessBrowsers`) in `src/utils/chromeBrowser.ts`.
- [x] Task 2: Register Puppeteer browser instances in `src/services/tokenRefreshScheduler.ts` (both main profile and temp profile paths), check `isShutdownInProgress()` early, and untrack on completion/finally.
- [x] Task 3: Register Puppeteer browser instances in `src/services/scheduleResearchService.ts` and untrack in finally.
- [x] Task 4: Register spawned `chromeProc` in `src/routes/pharmarack.ts` (`/login-window`) and untrack on process exit.
- [x] Task 5: Wire `markShutdownInProgress()` and `closeAllHeadlessBrowsers()` into `gracefulShutdown()` in `src/server.ts`.

### Phase 2: Instant Search Performance & Stale-Guarded Live-Append
- [x] Task 6: Verify backend `GET /api/pharmarack/search` SWR behavior and ensure prefix-key/core-term lookups serve instantaneous disk/memory hits with background single-flight revalidations (`searchCache.findPrefixMatch`).
- [x] Task 7: Verify and enhance POS medicine search and Purchases search to ensure instant paint (<30ms) from local memory, followed by stale-guarded cancellation via `AbortController` and monotonic sequence IDs.
- [x] Task 8: Implement gated idle search warmup for top common terms (gated: tab visible, user idle > 45s, staggered, pause when hidden).

### Phase 3: Verification, Guardrails & Auto-Knowledge Graph
- [x] Task 9: Run `npm run guardrails` and verify exit code 0.
- [x] Task 10: Run TypeScript checks (`tsc --noEmit` and `npx tsc -b frontend`).
- [x] Task 11: Update Knowledge Graph (`node scripts/quick-update.mjs`).

---

## 3. Completed Tasks Log

- **Task 1 Completed**: Built the central headless browser registry and lifecycle management in `src/utils/chromeBrowser.ts`. Added `trackHeadless`, `untrackHeadless`, `isShutdownInProgress`, `markShutdownInProgress`, and `closeAllHeadlessBrowsers()`. Relocated `killOrphanChromeProcesses`, `cleanTempProfileFolders`, and `cleanProfileLockFiles` to `chromeBrowser.ts` as canonical Chromium utilities to eliminate circular dependencies.
- **Task 2 Completed**: Updated `src/services/tokenRefreshScheduler.ts`:
  - Re-exported cleanup functions for complete backwards compatibility.
  - Added early `isShutdownInProgress()` gates in `runSessionHeartbeat()`, `executeRefresh()`, and `executeRefreshInternal()` to abort early and prevent launching new browser sessions during shutdown.
  - Registered launched Puppeteer `browser` instances on both main profile and temp profile launch paths via `trackHeadless(browser, ...)` and untracked them in the `finally` block.
- **Task 3 Completed**: Updated `src/services/scheduleResearchService.ts`:
  - Added early `isShutdownInProgress()` gate before launching Puppeteer.
  - Tracked the launched Puppeteer browser using `trackHeadless(browser, 'schedule_research')` and untracked in `finally`.
- **Task 4 Completed**: Updated `src/routes/pharmarack.ts` (`/login-window`):
  - Added early `isShutdownInProgress()` guard returning HTTP 503.
  - Tracked natively spawned `chromeProc` via `trackHeadless(chromeProc, 'pharmarack_login_window')`.
  - Untracked `chromeProc` on `error` and `exit` events, and skipped the `executeRefresh` fallback if shutdown was initiated while the window was closing.
- **Task 5 Completed**: Wired the browser shutdown lifecycle into `src/server.ts`:
  - Called `markShutdownInProgress()` at the top of `gracefulShutdown()`.
  - Added `closeAllHeadlessBrowsers()` with a 2-second timeout inside the concurrent `Promise.allSettled` block alongside worker and sidecar teardowns.
- **Task 6 Completed**: Enhanced `src/services/searchCache.ts` and `src/routes/pharmarack.ts`:
  - Added `findPrefixMatch(query, storeId, isMapped)` in `SearchCache` to match subqueries and superset queries from memory, enabling immediate (<1ms) response for family terms while background single-flight revalidations refresh the exact key.
  - Exposed `GET /api/pharmarack/warmup-terms` returning shop-specific top sale items merged with top standard chronic medicine brands.
- **Task 7 Completed**: Enhanced search cancellation and stale guards in `frontend/src/pages/POS/index.tsx` and `frontend/src/pages/Purchases/index.tsx`:
  - In `POS/index.tsx`: Aborted in-flight header and row catalog searches (`headerCatalogSearchAbortRef`, `rowCatalogSearchAbortRef`) and bumped sequence IDs upon medicine selection (`fetchDetailsAndAddToCart`, `changeRowMedicine`), preventing delayed responses from repainting closed dropdowns.
  - In `Purchases/index.tsx`: Aborted in-flight searches (`searchAbortRef`) and bumped `searchSeqRef` on `selectMedicine`, ensuring selections never get overwritten by in-flight responses.
- **Task 8 Completed**: Added gated idle search warmup in `frontend/src/App.tsx` and `frontend/src/services/api.ts`:
  - Added `api.getPharmarackWarmupTerms()` to API layer.
  - In `App.tsx`: Following initial route warmups, initiated background search warmup gated on `document.visibilityState === 'visible'` AND user idle > 45s (tracked via `keydown`/`mousedown` listeners), issuing one term lookup every 8 seconds to prefill memory and disk `data/search-cache.json`.
- **Task 9 Completed**: Ran `npm run guardrails` (`node scripts/performance-guardrails.mjs`). All 20 modified files verified cleanly with exit code 0 ("PASS — no guardrail violations. Speed architecture intact.").
- **Task 10 Completed**: Ran `npx tsc -b frontend` and `tsc --noEmit`. Both frontend and backend TypeScript compilations passed with 0 errors.
- **Task 11 Completed**: Executed `node scripts/quick-update.mjs`. Updated Auto-Knowledge Graph (1189 files, 800 edges, 10 layers, generated `3d-knowledge-graph.html`) in 3.4 seconds.
