# App-Wide Instant Load Implementation Plan (22+ Pages)

> Status: PLAN ONLY — no code changed. Implementation is a separate step.
> Scope: all SPA routes in `frontend/src/App.tsx:72` `pageRoutes` + Backup Center modal + Layout chrome.
> Binding contracts: root `AGENTS.md` (SPA Performance, Data Fetch Control, No-GPU, Pharmarack/WhatsApp persistence), `frontend/AGENTS.md` (KeepAlive, SSE, dropdown, lint), `src/AGENTS.md` (hot-path queries, transaction guard, boot lazy loading), `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` (P1 events-not-timers, P2 cache-first, P3 gated workers, P4 credentials sacred), `AGENT_DATA_FLOW_TREE.md` (one writer per fact), `FRONTEND PERFORMANCE FIX.md` (bundle budgets).

## 1. Objective

When the user opens any of the 22+ pages, it paints instantly from cache and refreshes silently. No page blocks on network. No page shows a false 1500ms/15s timeout error when the backend is briefly busy. No boot freeze on low-end PCs (i3 / 8 GB / no-GPU, software rendering).

Non-objective: removing locks forever, preloading everything at boot, deleting features to fake speed. All forbidden (see §7).

## 2. Page inventory (from `frontend/src/App.tsx:72`)

| # | Route | Component | Notes |
|---|-------|-----------|-------|
| 1 | `/pos` | `pages/POS` | Landing page, mounts at boot. Cart-first, compact inventory cache |
| 2 | `/dashboard` | `pages/Dashboard` | Prefetched once with warmup (`App.tsx:142`) |
| 3 | `/inventory` | `pages/Inventory` | Infinite list `inventory-list`, drawer + todays-receipts |
| 4 | `/sells` | `pages/Sells` | Invoice-level barcodes only |
| 5 | `/phone-sales` | `pages/PhoneSales` | Polls only while device connected |
| 6 | `/investigation` | `pages/Investigation` | Timeline cache, corrections |
| 7 | `/purchases` | `pages/Purchases` | One-shot history cache, verification modal |
| 8 | `/manual-purchase` | `pages/Purchases` | Same component, second path |
| 9 | `/purchase-history` | `pages/PurchaseHistory` | Bill + product labels |
| 10 | `/crm` | `pages/CRM` | Patients, special orders, refills, distributor priority |
| 11 | `/ai-engineering` | `pages/AIEngineering` | 4-tab hub; legacy redirects preserved |
| 12 | `/pharmarack-cart` | `pages/PharmarackCart` | Live cart, closure calendar, reorder hub |
| 13 | `/migration` | `pages/Migration` | SSE `migration_update`, 10s safety poll only |
| 14 | `/reports` | `pages/Reports` | Summary/data caches, expression indexes |
| 15 | `/settings` | `pages/Settings` | Store config hub; embeds BackupCenterContent |
| 16 | `/mail` | `pages/Mail` | Snippet list, lazy body fetch, 5000-row cap |
| 17 | `/dispatch` | `pages/Dispatch` | Delivery boys owner; reminders |
| 18 | `/database` | `pages/Database` | Catalog + image correction |
| 19 | `/learning` | `pages/Learning` | AI learning hub, 4 tabs |
| 20 | `/audit` | `pages/AuditCenter` | Audit lists |
| 21 | `/website-orders` | `pages/WebsiteOrders` | Online orders |
| 22 | `/online-catalog` | `pages/OnlineCatalog` | Online catalog |
| 23 | `/live-cart` | `pages/LiveCart` | Live cart search (upstream Pharmarack) |
| 24 | `/portal`, `/refill-portal`, `/customer-login`, `/customer/login`, `/my-bills`, `/customer-bills` | `pages/CustomerPortal` | Customer portal aliases, one component |
| 25 | `/returns` (+ `/expiry` redirect, `/customer-returns*` redirects) | `pages/Returns` | Supplier + expiry + customer returns |
| 26 | Backup Center | `components/BackupCenterModal.tsx` (`BackupCenterContent` + modal) | Opened from Layout + Settings; reported slow |
| 27 | Layout chrome | `components/Layout.tsx` (Sidebar, Topbar, QuickAssistSidebar, ConnectedDevicesFooterBar) | Always mounted; memoised |

## 3. OLD workflow (current, as measured in repo)

### 3.1 Boot

```
Electron window (SPLASH_URL, 0.27-0.43s)
  -> backend boot: DB ready early, core API unblocked
  -> POS mounts (landing page), loads compact inventory
  -> T+8s  Phase-3 workers start
  -> T+12s idle warmup starts, one page per 2.5s (9 paths in WARMUP_PATHS)
  -> T+30s Pharmarack scheduler start, T+45s WhatsApp restore, T+50/60s cart warmup
```

Good. Fragile if user opens a heavy page during the boot window: boot jobs (master enrichment fingerprint pass, `ensureSchema`, sales-metrics backfill when table empty) contend on CPU/disk with page fetches.

### 3.2 Page open (old, slow path)

```
User clicks page
  -> lazy chunk loads (good)
  -> component mounts, fires 1..N GETs immediately (mount saturation)
  -> some pages ALSO run setInterval/refetchInterval polls
  -> backend: some endpoints do sync fs scans or uncached COUNT(*) / DATE(col) scans
  -> SQLite single writer holds lock; concurrent page fetches queue
  -> axios default timeout 15000 (frontend/src/services/api.ts:9, frontend/src/api/client.ts:7)
  -> transient timeout -> GET retry 300/600/1200ms (frontend/src/services/api.ts:119)
     + throttled /verification/health diagnostic
  -> user sees spinner for seconds, then toast error (Backup: "Failed to retrieve backup system status")
```

Concrete old slow spots found by grep/read:

* Backup: `src/routes/utilities.ts:279` `GET /backup/status` runs `fs.readdirSync + statSync` over `snapshots/` + `archives/` per open (`src/routes/utilities.ts:335`), plus `listArchives()` + `getPreupdateBackupsInfo()` + `getScheduleConfig()`. Frontend `BackupCenterModal.tsx:105` `fetchStatus()` has no module cache; every open = full spinner. Reported symptom matches 15s axios abort, not the 1500ms restore-reload timer (`BackupCenterModal.tsx:167`).
* Residual polls: `ConnectedDevicesFooterBar.tsx:63`, `Layout.tsx:1029,1061,1300,1810,1918,2141`, `WhatsAppQueuePopover.tsx:186` (2s), `Settings/IntegrationsCredentialsTab.tsx:176` (3s), `CRM/index.tsx:50`, `Dispatch/index.tsx:252`, `PhoneSales/index.tsx:141`, `AutomationHubPopover.tsx:143`, `Migration/ReviewModal.tsx:442` (10s). Each adds SQLite + network load; `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md:18` measured ~1700 calls/hr before conversion.
* Mount fan-outs: `App.tsx:153` dashboard warmup fires reports summary+data `Promise.all`; `Layout.tsx:3306` sales+purchases `Promise.all`; `StagedReviewModal.tsx:108`, `Migration/ReviewModal.tsx:174`, `Dispatch/index.tsx:302`, `Reports/index.tsx:308` similar. Fine on click, harmful if fired during boot or on every mount.
* Heavy lists without virtualization + layout thrash on CPU rendering (No-GPU) make pages FEEL slow even when data is fast.

### 3.3 Locks (old, correct but misunderstood)

* SQLite = one writer. `src/services/...` edit services move stock by NET delta inside a transaction; every early return after BEGIN must ROLLBACK (`src/AGENTS.md` P0-69). `middleware/requestTransactionGuard.ts` + `dbManager.closeOrphanTransaction()` is a safety net, not permission.
* `utils/backgroundJobLane.ts:runHeavyJob` serializes heavy jobs FIFO + per-name single-flight. Deliberately NOT routed: token heartbeat (P4-exempt probe) and WhatsApp dispatch (latency).
* `database.ts` `isBooting` run-counter prevents overlapping `ensureSchema()` stock rebuilds (bug P2-82).

## 4. NEW workflow (target, no behavior change)

### 4.1 Page open (new, fast path)

```
User clicks page
  -> KeepAliveOutlet shows already-mounted page instantly (display:none -> visible)
     OR lazy chunk loads with instant PageLoader skeleton (no layout shift)
  -> page hydrates from module-level cache / react-query cache immediately
  -> PageQueryTracker refetches ONLY this page's own stale keys, silently, after paint
  -> backend answers from TTL cache or indexed seek in ms
  -> SSE broadcast on next write keeps it fresh; no polling
```

Rules (binding):

* P1 events-not-timers: new SSE consumers add mappings in `SSE_QUERY_MAP` / `SSE_CUSTOM_EVENTS` (`hooks/useGlobalSseInvalidation.ts`). Never open a second `EventSource`. Never reintroduce eager `refetchQueries({type:'active'})`; use mark-stale-only (`refetchType:'none'`). Chrome keys (`orders`, `refills`, `settings`) keep instant refetch via `CHROME_INSTANT_KEYS`.
* P2 cache-first: every list page keeps module cache + `initialData` seed; mount never blocks on network. Infinite lists keep last rows until own refetch replaces them (`useInfiniteScroll.ts`, `dataUpdatedAt` dep; never set mounted rows to `[]` on write).
* P3 gated workers: every interval gates on `usePageActive()` or `document.visibilityState==='visible'`, `dataFetchControl` mode, and `activityTracker.isIdle()` backoff. New heavy jobs route via `runHeavyJob()`; never await it from inside a running job.
* No-GPU: no `backdrop-filter`; `animate-pulse/ping/bounce` max 3 cycles; dropdown lists carry `.dropdown-scroll`, opaque panels, `onMouseMove` highlight guard, instant (`auto`) scroll; small shadows only.
* Data truth: `AGENT_DATA_FLOW_TREE.md` one writer per fact; missing stays missing; no invented fallbacks; bill dates shop-local via `src/utils/localTime.ts` (guardrail B4).

### 4.2 Boot (new, unchanged sequence, wider coverage)

```
Same order as §3.1. Only change: extend idle warmup coverage to remaining
high-traffic routes using the SAME 12s start + 2.5s stagger + idle/visible gates.
Prefetch LIGHT keys only (dashboard summary, counts). NEVER prefetch full
reports/timelines/catalog bodies during warmup.
```

### 4.3 Locks (new, same locks, shorter holds)

There is no "unlock forever" step. Correctness requires the locks. Speed comes from:

* Short transactions, `ROLLBACK` on every early return after BEGIN.
* Heavy scans via `runHeavyJob` lane, chunked (≤500 ids) indexed queries, TTL caches invalidated by the write interceptor (`database/connection.ts`).
* Async fs (`fs.promises`) instead of `readdirSync/statSync` on request paths.
* Keep `isBooting` counter, lazy boot imports (`tests/bootLazyImports.test.ts`), no per-request `ensureSchema()`.

## 5. Per-area work list (implementation order)

### Phase 0 — Measure (no code)

1. Production build + preview, Lighthouse before/after baseline (`FRONTEND PERFORMANCE FIX.md:319`).
2. Bundle analysis (`rollup-plugin-visualizer` or equivalent): why POS chunk is large, duplicated deps, barrel imports.
3. Network idle audit 10 min: list every repeating call + owner file:line.
4. Time slow endpoints cold/warm: `/utilities/backup/status`, `/dashboard`, `/inventory` (+count), `/refills/panel`, reports summary/data, investigation timeline, catalog-search rare terms.

### Phase 1 — Backend unblock (biggest wins first)

5. `GET /utilities/backup/status` (`src/routes/utilities.ts:279`): async fs, cap `availableArchives` payload (latest N + total count), 30-60s TTL cache for `totalBackupSize` + preupdate info, invalidation on manual/restore/delete/clean-preupdate. Keep response shape; paginate archives later if needed.
6. Sweep other request paths for the same sins: sync fs walks, uncached `COUNT(*)`, `DATE(col)`/`UPPER(col)` wraps defeating indexes, whole-table GROUP BY + window subqueries, N-per-line queries (use batch endpoints like `/purchases/match-items`). Preserve the locked hot paths in `src/AGENTS.md` (refills two-pass, inventory count cache, timeline cache, report expression indexes, catalog-search no-Pass-3).
7. Keep `runHeavyJob` routing for every heavy background job; keep token heartbeat P4-exempt and WhatsApp dispatch off-lane.

### Phase 2 — Frontend cache-first + de-poll

8. Give `BackupCenterContent` a module-level last-status cache: instant paint + silent `refreshStatus()`; keep explicit Retry; no interval.
9. Convert each residual poll from §3.2 to SSE mapping or visible-only gated fetch with shared query keys (Layout WA-queue 3s poll only while queue active AND visible; popover reuses `peekWhatsAppQueueStatusCache`; Migration keeps `sse-migration-update` + 10s visible safety poll).
10. Remove mount saturation: one batched call instead of N per-item calls; debounced ≥2-char (≥3 where contract says) autocomplete, abort stale controllers, monotonic seq guards; hover intel from module cache.
11. Virtualize large lists; memoize expensive render math; batch DOM reads/writes; `requestAnimationFrame` observers.

### Phase 3 — Bundle diet (`FRONTEND PERFORMANCE FIX.md:32` order)

12. Route-level lazy (done — keep), move AI/camera/PDF/OCR/charts/Excel/report/editor/map/SDK imports behind feature boundaries (lazy).
13. Remove barrel imports for route code; dedupe deps (`npm ls`); fix `manualChunks` only after measuring duplication.
14. Budgets: initial JS <400-500KB compressed, CSS <100-150KB, POS shell <1-2MB; fail a PR that grows main bundle without reason.

### Phase 4 — Verify and lock

15. `npm run guardrails` (must exit 0; fix before done). `node scripts/quick-update.mjs` after every file change. `node scripts/generate-project-docs.mjs` if graph docs are regenerated.
16. Checks: cold boot POS usable ~2s; every visited page switches instantly; Backup opens <1s warm; idle 10min ≈0 UI calls; sale → Dashboard/Reports/Inventory <1s via push; no console errors; no `alert()/confirm()`; no raw Tailwind surfaces on changed lines; no UTC bill-date regressions (B4); no GPU switches (E1).
17. Update `SMALL_BUG_FIX_PLAN.md` (Open → Fixed) only for actually fixed entries. Update `AGENTS.md` docs only if contracts change.

## 6. Old vs new comparison

| Aspect | Old | New |
|--------|-----|-----|
| Page open | Mount → fetch → spinner → paint; some pages poll forever | Paint from cache → silent refresh of own stale keys |
| Cross-page write | Stale up to 15s or refetch storm | SSE marks stale; visible page refetches own keys |
| Backup open | Sync disk scan per open, full spinner, 15s abort risk | Async + cached + capped, instant paint, silent refresh |
| Boot | Correct sequence, narrow warmup (9 paths) | Same sequence, wider idle-staggered coverage, light keys only |
| Locks | Correct, but long holds under contention | Same locks, shorter holds, serialized heavy lane |
| Bundle | ~26MB payload, duplicated JS | Feature chunks on demand, budgets enforced |
| Render | Some endless animations, smooth scroll, mouseenter storms | Finite attention cycles, instant scroll, `dropdown-scroll` |

## 7. Explicitly forbidden

* Preloading all 22+ pages with full data at boot.
* Removing SQLite/transaction/lane locks ("unlock forever").
* `toISOString().slice(0,10|19)` bill dates or `'localtime'` on stored bill dates (B4).
* GPU-forcing switches in `electron/main.ts` (E1).
* `alert()/confirm()`, dummy `B-*`/invented fallbacks, simulation UI.
* Second EventSource, eager cross-page refetch, ungated `setInterval`/`refetchInterval`.
* Auto-creating inventory from catalog/OCR/email; auto patient WhatsApp from workers.

## 8. Rollback safety

* Each phase commits separately; timer removals are independent restores.
* Worker gating is config-driven (`data_fetch_control`) — flip modes without code.
* Cache TTLs can be shortened/disabled per endpoint without touching UI.
* Keep `sent_order_*` / `wa_sent_*` history-key exclusions and session-backup inclusions intact.

## 9. Acceptance criteria

* [ ] Production Lighthouse/network payload down vs baseline with zero workflow regressions.
* [ ] All visited pages switch instantly; Backup warm open <1s.
* [ ] Idle 10min ≈0 UI-originated calls.
* [ ] Sale/purchase/return/order/refill writes reflect in <1s on visible page.
* [ ] `npm run guardrails` exit 0; graph updated; docs regenerated if needed.
* [ ] No new dummy data, no invented fallbacks (8-point audit clean).

---

*Plan only. No source files were changed to produce this document.*
