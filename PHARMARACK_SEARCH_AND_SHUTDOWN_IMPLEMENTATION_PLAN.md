# Pharmarack Search + Shutdown Browser Lifecycle — Implementation Plan (PLAN ONLY, no code changed)

Created: 2026-10-15. Status: PLAN ONLY — this file changes zero code paths. Build agent implements later.

Goal: (1) every medicine search in the app feels as instant as the Pharmarack Cart page; (2) closing the app auto-closes every headless/Puppeteer session running in the background at the same time, so close → re-open never hits a locked profile or orphan Chrome.

Non-goals in this plan: no GPU re-enable, no new polling loops, no second SSE connection, no dummy-data fallbacks, no auto patient messaging, no schema change.

## 1. OLD workflow (as built today — evidence)

### 1A. Cart instant path (why cart feels fast)
- `GET /api/pharmarack/cart` and boot warm-up share one loader `loadLiveCartCore()` in `src/routes/pharmarack.ts`.
- 10s TTL probe micro-cache `probeUserCartDetails()` shared by `/live-cart-summary`, `/session-status`, `/auto-verify`; `invalidatePharmarackCartCache()` clears both `serverCartCache` and probe cache on mutations.
- Boot warm-up `warmupStartupCart()` runs via `tokenRefreshScheduler.onFirstRefreshComplete()` + T+50s fallback; resolves `startupSyncCoordinator` from real data. No token = marks loaded immediately; genuine failure leaves sync pending so the startup toast stays truthful.
- Result: Cart page paints from memory; search paths below do not.

### 1B. Medicine search paths (why dropdowns lag cart)
- POS header/row search (`frontend/src/pages/POS/index.tsx:2144,2172`): instant local filter over `getCompactInventoryCache()` (`filterLocalInventory`), then 150ms-debounced `fetchPosCatalogRows()` → `GET /inventory/catalog-search` (`src/routes/inventory.ts:635`). Catalog-search = Pass 1 indexed prefix on `medicines.name` + aliases (LIMIT 40), Pass 2 FTS5/mumeric only when Pass 1 < 15 rows; former Pass 3 secondary-field scans removed (~2.7s). One row per name via alphanumeric-stripped collapse; Purchases mirrors with `dedupeMedicinesByName`.
- Purchases page: MASTER-DB ONLY via `GET /inventory/catalog-search` (local inventory-filter stage removed by owner decision); module `searchResultsCache` (5-min TTL, 40 entries) + prefix-narrow instant paint; single-flight `loadMedicineHistory` per medicine for batches/hover intel.
- Live Pharmarack search: `GET /api/pharmarack/search` (`src/routes/pharmarack.ts:525`) → `searchCache.lookup()` (`src/services/searchCache.ts:35`) serves fresh (5-min TTL) OR stale (up to 7 days) in <1ms, disk-persisted `data/search-cache.json` (100 entries, 2s debounce save, flush-on-exit); stale hit fires single-flight `revalidateStaleSearch()` (`src/routes/pharmarack.ts:513`) sharing the one `performPharmarackSearch()` core (`src/routes/pharmarack.ts:311`). Core-term fallback via `sanitizePharmarackQuery` (`src/routes/pharmarack.ts:539`). Miss path runs live OpenSearch (8s warm / 12s cold timeout, turbo parallel variant fallbacks 5s), sorts mapped-first then `scoreProductName`, caches under raw + core key, else offline catalog fallback, else `need_login` (401/403 + `executeRefresh()` kick) or `connection_error` (never silent `[]`).
- Frontend live consumers: `LiveCartSearchSection.tsx:245` (3-char gate, client `clientSearchCache` 150 entries, abort stale, `isRefreshing` honest label, strict drop of `isLocalPharmacy` rows + `restrictStoreId` filter), `MedicineLinkModal`, `QuickOrderModal`, `PharmarackCart/index.tsx`, WA Requests one-shot lookup. POS/Purchases dropdowns do NOT merge live results per keystroke.
- Gating rule (`frontend/AGENTS.md`): dropdown opens only after ≥2 typed chars (≥3 for cart/purchase rows) AND results exist; never on focus/click. So "cart shows, dropdown empty" can be correct behavior for short/zero-hit terms.

### 1C. Session keep-alive (REST-first, browser-last)
- `tokenRefreshScheduler` (`src/services/tokenRefreshScheduler.ts`): `start()` T+30s; `runSessionHeartbeat()` (`:425`) = ONE `GetUserCartDetails` probe per interval (P4-exempt, runs while idle; `off` suppresses). Chrome launches ONLY on probe 401/403, profile-without-token legacy capture, or user-clicked manual re-auth. `executeRefresh()` (`:546`) single-flight mutex shared by cron/401-retry/catalog-cache.
- `executeRefreshInternal()` (`:554`): LevelDB direct `extractTokenFromProfile()` ~5ms first (zero browser); else `killOrphanChromeProcesses('pharmarack_profile')` + `cleanTempProfileFolders()` + `cleanProfileLockFiles(main)` → `puppeteer.launch({userDataDir: mainProfile})` → on lock failure copy to `pharmarack_profile_temp_*` (async `copyProfileFolder`, `src/utils/chromeBrowser.ts:132`) and launch there → `page.goto(retailers.pharmarack.com, domcontentloaded, 10s)` + request-header/localStorage token capture (8s poll) → persist token + `pharmarack_session_status=active` → `finally browser.close()` + copy-back-if-token + rm temp dir.
- Login window (`src/routes/pharmarack.ts:703`): native `spawn(chrome --user-data-dir=mainProfile .../loginotp)` (no Puppeteer overhead), 2s LevelDB poll while open, exit-scan + `executeRefresh` fallback, `isLoginWindowActive` mutex.
- Schedule research (`src/services/scheduleResearchService.ts:72`): `puppeteer.launch` per capture, `finally browser.close()`; Google primary + DuckDuckGo fallback, labeled engine.
- WhatsApp (`src/whatsappClient.ts:1059,1697`): `launchClientInstance()` with init-promise settle on every exit; `destroyClient()` (15s race) + `cleanupProfileLocks()`; idle-sleep evaluator destroys resident client after `whatsapp_idle_sleep_min`.

### 1D. Shutdown today (what closes, what can orphan)
- Electron (`electron/main.ts`): `cleanAllSessionLocks()` (`:64`, SingletonLock/lockfile/devtoolsactiveport for `.wwebjs_auth` + `data/pharmarack_profile`), `reclaimPort(5175)` (`:93`), splash-first window (`:117`), `ELECTRON_MODE=true` backend spawn (`:170`), `window-all-closed` (`:405`) → POST `/api/system/client-exit`, 5s grace, else `forceKillBackendTree` (`:395`, `taskkill /F /T`).
- Backend (`src/server.ts`): tab-close 3.5s grace (`:339` `/api/system/shutdown?type=tab_close`, dev-ignored), direct `CLIENT_EXIT` 100ms (`:359`), `gracefulShutdown()` (`:1128`) with 6s hard watchdog: close UI window → drain 1s → `last_clean_shutdown=true` → backup ≤3.5s → `Promise.allSettled(workerSupervisor.stop, whatsapp destroyClient ≤1.5s, scispaCy stop, email ≤1.5s, cloudflare stop)` → `dbManager.close(true)` → `closeAppBrowser()` → win32 self-taskkill → `process.exit(0)`.
- Gap: `gracefulShutdown` never closes an in-flight Pharmarack refresh Puppeteer browser, schedule-research browser, or login-window Chrome PIDs. Their `finally browser.close()` only runs on normal completion; a close landing mid-`goto`/poll orphans Chrome holding the profile lock. Next boot recovers via kill/clean helpers, but pays the slow temp-profile-copy path and cache-only first searches.

## 2. Problems to fix (observed)
- P1: dropdown slower/emptier than cart on same term in installed app (cold `getCompactInventoryCache()`, SQLite contention under 512MB cap + boot jobs, cache-miss spinner instead of local-first paint, cold-token window serving stale/401).
- P2: close during a refresh/login-window/research capture → orphan `chrome.exe --user-data-dir=...pharmarack_profile...` → next boot lock → temp copy → slow first search + possible `last_clean_shutdown=false` warning.
- P3: no single place tracks all headless browsers; shutdown has no targeted headless-close step (relies on next-boot cleanup + whole-tree taskkill fallback).

## 3. NEW workflow (proposed — Build agent implements)

### 3A. Unified local-first + live-append search (every medicine input)
- Keep gates (≥2 chars, ≥3 for cart/purchase rows; never on focus), keep `combine_pharmarack_pharmacy_search` toggle semantics, keep single data source per page (no second local source in Purchases).
- Paint local instantly (<30ms) from existing caches (compact cache / `searchResultsCache` / prefix-narrow), then fire `api.searchPharmarack` detached (150–300ms debounce, AbortController stale-guard, `selectSuggestion` aborts in-flight so late responses never repaint a closed dropdown). Never `Promise.all(local, live)` blocking.
- Reuse server SWR as-is: `lookup()` fresh+stale, `revalidateStaleSearch` single-flight, core-term + prefix-key lookup on every path, offline rows flagged (`isOffline`/`isLocalPharmacy`) and never linkable/addable. UI labels: live-mapped vs stale vs `Restoring session...` (401 `isRefreshing`) vs connection-error; suppress false `No mapped distributor` toast during restore (P2-88 pattern).
- Idle warm (gated: >45s idle + visible tab, one term per 8s, no timers while hidden): top ~20 frequent terms through the same core so repeat keystrokes hit disk/memory cache.

### 3B. Central headless-browser registry + shutdown-coupled close
- Extend `src/utils/chromeBrowser.ts` (beside `activeAppBrowserProcess:168`): `trackHeadless(handle|pid, tag)` / `untrack()`. Register: token-refresh both launch paths, schedule-research capture, Pharmarack login-window `chromeProc`, WhatsApp login-window Chrome.
- New `closeAllHeadlessBrowsers()`: iterate registry → `browser.close()` (or PID kill) under ~1.5s `Promise.race` each, then `killOrphanChromeProcesses('pharmarack_profile')` + WhatsApp auth keyword + `cleanTempProfileFolders()` + `cleanProfileLockFiles(main)`. Failures logged, never thrown.
- Wire into `gracefulShutdown()` `src/server.ts:1195` `Promise.allSettled` block (same timeout budget; 6s watchdog unchanged). Add abort flag so `executeRefreshInternal()`/heartbeat exit early during shutdown instead of relaunching.
- Electron unchanged except already-present 5s grace + `/T` fallback; after backend `exit` keep `cleanAllSessionLocks()`. No new intervals; heartbeat P4 exemption untouched; No-GPU switches untouched.

## 4. Contracts that MUST hold (do not regress)
- Autocomplete gating, `.dropdown-scroll` + `onMouseMove` highlight guard, instant `behavior:auto` scroll, opaque dropdown panels, finite animations (`frontend/AGENTS.md`).
- Single global SSE (`useGlobalSseInvalidation` only), deferred-SSE mark-stale-only, `PageQueryTracker` visible-page refresh; new search must not add `EventSource`/`setInterval` polls.
- `tokenRefreshScheduler` single-flight mutex; no periodic browser refresh loop; `copyProfileFolder` stays async; `findChromePath` stays single source.
- `searchCache.lookup()` fresh+stale semantics; request + revalidation share `performPharmarackSearch` core; `need_login`/`connection_error` codes unchanged; only-cache-non-empty preserved.
- Shutdown 6s cap; `last_clean_shutdown` write before backup; WhatsApp `destroyClient` race kept; whole-tree taskkill stays last resort.
- Zero dummy data (no invented links/prices/batches), strict link saving (`sameProductName`, single-product auto-link ≥ threshold, 406 dead-link delete), manual-only patient messaging, shop-local bill dates (B4).

## 5. Implementation tasks (NOT DONE — for Build agent)
- Phase 1 backend: registry (`chromeBrowser.ts`) + registrations (tokenRefreshScheduler ×2 paths, scheduleResearchService, pharmarack login-window, whatsapp login-window) + `closeAllHeadlessBrowsers()` + `gracefulShutdown` wiring + shutdown-abort flag. Guard: `tests/bootLazyImports`-style lazy import kept; no top-level heavy imports.
- Phase 2 search: local-first paint + detached live-append in POS/Purchases/LiveCart shared helper (no second source in Purchases; keep `searchSeqRef` stale-guard + shimmer row); prefix/core-term lookup reuse; idle warm list.
- Phase 3 Electron/verify: confirm `window-all-closed` 5s + backend 6s interplay; close-mid-refresh drill; reopen-clean drill.
- Phase 4 checks: `npm run guardrails` (E1, B4, polling rules), `tsc --noEmit` (root + frontend), `node scripts/quick-update.mjs`, targeted jest (requestTransactionGuard first), live timing (`catalog-search` vs `/pharmarack/cart` vs `/pharmarack/search`), lock/orphan check (no `chrome.exe` with profile keyword, no `pharmarack_profile_temp_*`, `last_clean_shutdown=true`).

## 6. Verification (acceptance)
- Cold-boot `fluka 150`-class term: local rows <30ms paint, live append replaces spinner, no false no-distributor toast during restore.
- Close mid-refresh + reopen: `last_clean_shutdown=true`, zero orphan Chrome for profile keyword, zero temp profile dirs, first search needs no temp-copy path.
- `npm run guardrails` exit 0; `tsc --noEmit` clean both; knowledge graph updated.

## 7. Rollback
- Registry/wiring is additive: revert = stop calling `closeAllHeadlessBrowsers()` (shutdown falls back to today's next-boot cleanup + taskkill). Search helper revert = back to local-only dropdown + explicit live search (today's behavior). No migration/rollback needed (no schema change).
