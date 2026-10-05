# Autocomplete & Search Performance — SINGLE STRICT IMPLEMENTATION PLAN (whole app)

> **STATUS: PARTIALLY IMPLEMENTED (2026-10-05, owner said "implement"; defaults: stale-serve, Purchases master TTL 15 min, POS overlay 30 s fresh-only, stash kept shelved).**
> Done: shared `utils/recentSearchCache.ts`; A5 SWR; A1/A2 deferred local scan + >2000-row unindexed skip + 30 s fresh-only master-leg cache; A3 already gated (<5). NOT done: Phase 0 measurements (§8), compact persist (§6.6), chunked index (§6.7), Phase 3 backend — all measurement-gated or risky.
> Created: 2026-10-05. This is the ONE plan file for this work. No app code is changed by this file.
> Note: a partial implementation was shelved untouched into `git stash` ("shelved partial autocomplete
> perf edits…") to restore this plan-only state; it must NOT be popped without an explicit owner order.
> Scope: laggy medicine autocomplete **after idle / first load**, audited across the WHOLE app —
> nothing skipped (§2 inventories every caller). Primary pain: (1) POS cart row (`row-med-input-*`),
> (2) POS top search (`medicine-search-input`), (3) Purchases medicine rows.

---

## 1. Issue statement

Typing a medicine name in any autocomplete input lags on first load and after the app sits idle, then
recovers once caches are warm. The painful window is the cold/wake window: empty local cache, unbuilt
search index, cold SQLite page cache, and (Purchases) an expired 5-minute recent-search cache — so every
keystroke does maximum work on the main thread plus network round-trips. Owner confirmed all three
primary inputs are affected and ordered: one single detailed plan in the root folder, strict, skipping
nothing in the app; implementation only on explicit go-ahead.

---

## 2. Complete site inventory (strict — nothing skipped; verified 2026-10-05 against HEAD)

### Table A — every medicine-search API caller in `frontend/src`

| # | Site | Call | Debounce / guard | Cache | Verdict |
|---|---|---|---|---|---|
| A1 | POS cart row `pages/POS/index.tsx:2097` | `filterLocalInventory` sync per keystroke + `catalogSearch` @150ms (`:2126`) | network debounced/abort+seq; LOCAL NOT debounced | compact module cache only | **FIX (Phase 1+2)** |
| A2 | POS top search `pages/POS/index.tsx:2991` | same two-stage + barcode auto-add (`:3005`) | same as A1 | same as A1 | **FIX (Phase 1+2)** |
| A3 | POS thin-result suggest `POS:2588` | `suggestMedicine` @200ms when <5 results (`:2603`) | debounced/abort | none | **FIX: fold into A1/A2 budget or drop when local hits ≥5** |
| A4 | POS refill accept `POS:2398`, staged-load chain `POS:1562/1571/1577`, refill-name `POS:1351`, row click `POS:5636` | `searchMedicine` (one-shot, click-driven) | user-click only, no keystroke loop | none needed | **KEEP AS-IS** (no per-keystroke cost) |
| A5 | Purchases rows `pages/Purchases/index.tsx:1767` | `catalogSearch` @180ms (`:1830`) + exact/prefix/inventory preview | debounced/abort+seq | `searchResultsCache` 5-min TTL 40-LRU + prefix narrow + compact preview | **FIX TTL cliff (Phase 1)** |
| A6 | Purchases invoice prefill `:2275`, token fallback `:2312`, save verification `:2972` | `catalogSearch` (one-shot, batch/event-driven) | explicit user/batch action | shares A5 cache | **KEEP AS-IS** (already batched; never convert to per-keystroke) |
| A7 | StagedReviewModal `:251` | `catalogSearch` on explicit Review click | user-click only | shares Purchases dedupe | **KEEP AS-IS** (already one batched `match-items` first) |
| A8 | Investigation `:622` | `searchMedicine` | check debounce on edit; low-traffic page | none | **VERIFY ONLY (Phase 0)** — fix only if measured slow |
| A9 | LiveCartAddModal `:1153`, QuickOrderModal `:494`, MedicineLinkModal `:87`, PharmarackCart `:3298/:3317`, WebsiteOrders `:288`, WaRequestsPanel `:588`, SpecialOrdersSection `:409` | `searchPharmarack` (live upstream) | each has own debounce/abort; Link modal ≥3-char gate | disk `searchCache` SWR server-side | **OUT OF SCOPE** for local-perf work — do not touch upstream search behavior |

### Table B — every backend search endpoint in `src/routes`

| Endpoint | Owner consumer | Design | Verdict |
|---|---|---|---|
| `GET /inventory/catalog-search` (`inventory.ts:626`) | Purchases, StagedReviewModal, POS merge leg | Pass-1 indexed prefix `LIMIT 40`, FTS fill only if <15, ex-Pass-3 scans REMOVED, name-dedupe in-stock-wins | **DO NOT REGRESS; micro-cache only if Phase 0 proves need** |
| `GET /sales/search-medicine` (`sales.ts:1497`) | POS one-shots, Investigation | prefix-first, numeric branch, per-row expiry `CASE`, `LIMIT 30` | **REDUCE per-row expiry cost only if measured (Phase 3)** |
| `GET /medicines/compact` (`medicines.ts:606`) | all POS/Purchases previews via `inventoryCache` | full active-inventory dump + frontend O(N) index build | **SHRINK payload or move persist to IndexedDB if Phase 0 confirms quota fail** |
| `GET /sales/universal-search` (`sales.ts:2048`) | header/universal search | verify debounce + limit on edit | **VERIFY ONLY** |
| `GET /medicines/online-search` (`medicines.ts:488`) | POS online enrich | user-click only | **KEEP AS-IS** |
| `GET /medicines/search-full`, `/inventory/therapeutic-search`, `/investigation/search`, `/website/medicines/search`, `/customerReturns/search-invoice`, `/clinical/search-by-salt`, `/pharmarack/search` | various single pages | each ≤1 caller, none per-keystroke hot | **KEEP AS-IS; never add per-keystroke callers** |

### Table C — non-medicine autocompletes (audited, not hot)

POS patient `getPatients` (300ms debounce, `POS:2204`), POS/CRM doctors `getDoctors` (react-query, `POS:1940`, `Layout:448`),
Purchases/Returns distributors `getDistributors` (query-cached), Purchases `medicine-batches` one-shot per medicine
(single-flight module cache — never duplicate), Returns manual-item medicine search, Expiry client-side filter,
CRM special-order rows, OrderModifyModal, MedicineVisualReferenceModal. **Verdict: KEEP AS-IS.** Any future
per-keystroke endpoint here must follow §6 rules from birth.

---

## 3. Search-order answer (master DB vs live inventory — the asked question)

- **POS (both inputs): LIVE SELLABLE INVENTORY FIRST, master second.** Stage 1 `filterLocalInventory`
  (`POS:615`) over compact cache (`api.ts:343` ← `/medicines/compact` ← `inventory_master JOIN medicines
  WHERE is_active=1 AND qty>0`, `inventoryCache.ts:102`, `inventoryActive.ts:7`) with `isValidForPos`
  double-guard (`api.ts:318-333`). Stage 2 `catalog-search` on `medicines` master, merged with zero-stock
  dropped (`POS:2137/:3046`) and `onlySellable` ranking. Expired/out-of-stock can never display.
- **Purchases rows: MASTER DB ONLY** (owner rule — local inventory stage deliberately removed). Stock chips
  come from pre-aggregated row fields, never a second source.
- **Stashed (not active):** the shelved stash contains POS `useDeferredValue` scans + Purchases
  stale-while-revalidate. It is NOT in the tree and must not be referenced as current behavior.

---

## 4. Root causes, ranked (each becomes a Phase-0 measurement in §8)

1. Cold compact cache on boot/wake → `getCompactInventoryCache()` returns `[]` ("Warming up search index…")
   or forces the `useIndex=false` per-row `toLowerCase/split` full scan over ~37k rows per keystroke.
2. `sessionStorage` persist likely exceeds ~5 MB quota with 37k rows → silent hydrate fail → every reload cold.
3. Purchases hard 5-min TTL deletes exact + prefix entries after idle → falls back to cold compact preview, then network.
4. POS local scan un-debounced (150 ms covers network leg only) on the CPU-rendered main thread (no-GPU policy).
5. Synchronous O(N) `buildPrecomputedInventoryIndex` competes with first paint on data arrival.
6. Backend cold cost after idle (evicted SQLite pages): prefix query + per-row expiry `CASE` + JOIN at worst moment.
7. POS fan-out per settled term: `catalogSearch` (×2 paths) + `suggestMedicine` when thin — guarded but still issued.

---

## 5. Binding constraints (violations fail guardrails / review)

- `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` §7: no new `setInterval`/`refetchInterval`; mount paints from
  module cache; loops respect `activityTracker.isIdle()` + visibility; new call sites registered in `dataFetchControl`.
- Deferred-SSE: mark-stale-only invalidations; visible page refetches via `PageQueryTracker`; never eager cross-page storms.
- Autocomplete gating (`frontend/AGENTS.md`): dropdown only after ≥2 typed chars; never fetch/open on focus/click;
  never seed fabricated entries; Purchases ≥3-char rule where it applies.
- Dropdown performance: `dropdown-scroll` on the scrolling element, guarded `onMouseMove` highlight (never
  `onMouseEnter`), opaque panels, instant `behavior:'auto'` keyboard scroll, finite pulse (3 cycles), no
  `backdrop-filter`, no endless keyframes (only `animate-spin`).
- Purchases single-master contract: master DB ONLY; no second local source; no server stock-first grouping.
- Zero dummy data: missing stock/rate/batch renders missing; no invented MRP/rate/stock/batch; search paths never
  create inventory or master rows (master creation = Universal editor `POST /medicines` only).
- No-GPU contract (`electron/main.ts` locked) + boot order (window first, Pharmarack/WhatsApp lazy at T+30s/T+45s).
- `npm run guardrails` exit 0 before done; `pre-push` hook independent; `node scripts/quick-update.mjs` after changes.

---

## 6. Strict per-site rules (the "skip nothing" enforcement checklist)

1. A1/A2: local scan MUST be deferred-or-debounced (≤100 ms) AND skipped entirely when the index is not ready
   on lists >2000 rows (serve stale/prefix preview instead). Network leg keeps 150 ms + abort + seq guard.
2. A3: `suggestMedicine` MUST NOT fire when local+master already yield ≥5 rows; else keep 200 ms + abort.
3. A4/A6/A7: one-shot/click-driven searches MUST stay click-driven; forbid wiring them to keystroke effects.
4. A5: hard TTL expiry is FORBIDDEN — convert to stale-while-revalidate (serve expired instantly + ONE background
   revalidation per key); keep 40-entry LRU; prefix narrowing MUST include stale entries.
5. Shared helper: ONE module-cache/prefix helper for A1/A2/A5 (no three forks); TTL for POS stock overlay SHORTER
   than Purchases master TTL — values recorded in §8 before coding.
6. Compact persist: if payload > ~4 MB, shrink persisted fields or move to IndexedDB; keep single-flight
   `ensureCompactInventoryReady` + focus/visibility wake unchanged.
7. Index build: chunk off the critical path (idle-scheduled); consumers MUST handle not-ready (rule 1 covers it).
8. Backend: prefix-first + `LIMIT 30/40` inviolable; no `CAST(mrp AS TEXT)`; no secondary-field OR scans;
   `/sales/search-medicine` expiry simplification ONLY via indexed `expiry_month` pattern, only if measured slow.
9. A9/Pharmarack surfaces: NO changes in this work (upstream behavior + zero-ban-risk heartbeat untouched).
10. Table C: NO changes; any new per-keystroke caller anywhere MUST satisfy rules 1–8 + §5 from birth.

---

## 7. Implementation phases (DO NOT START without explicit owner "implement")

- **Phase 0 — Measure (no behavior change).** Prod `build`+`preview` timings cold/warm/6-min-idle for
  `/medicines/compact`, `catalog-search`, `search-medicine`; `sessionStorage` byte size + quota verdict;
  Performance-trace cost per keystroke per input (indexed vs unindexed); `EXPLAIN QUERY PLAN` both SQLs.
  Fill §8 BEFORE any behavior edit.
- **Phase 1 — Kill the idle cliff.** A5 stale-while-revalidate (§6.4); ONE shared cache/prefix helper for
  A1/A2/A5 (§6.5); compact persist fix if Phase 0 confirms (§6.6).
- **Phase 2 — Unblock the keystroke thread.** A1/A2 deferred/debounced local scan + not-ready skip (§6.1);
  30-row early cap before rank; A3 gating (§6.2); chunked index build with not-ready handling (§6.7).
- **Phase 3 — Backend only if Phase 0 proves backend-side latency** (§6.8 + optional identical-`q` 5–10 s
  micro-cache on `catalog-search`, invalidated by existing mark-stale mappings).
- **Phase 4 — Verify & lock.** `npm run guardrails` exit 0; repeat §8 warm/cold/idle; truthfulness spot-check
  (no expired/zero-stock in POS, honest Purchases chips); `node scripts/quick-update.mjs`; one commit per phase.

Expected touch list (estimate): `frontend/src/pages/POS/index.tsx` (A1–A3), `frontend/src/pages/Purchases/index.tsx`
(A5), one shared util beside `utils/searchRanker.ts`, `frontend/src/services/api.ts` ONLY if quota/index proven,
`src/routes/sales.ts`/`inventory.ts` ONLY if backend proven. Everything else in §2 stays untouched.

Rollback: each phase independently revertible; no migrations, no new tables, no new dependencies.

---

## 8. Measurements (Phase 0 fills this BEFORE implementing — no defaults, no guessing)

| Metric | Cold boot | Warm | 6-min idle | After fix |
|---|---|---|---|---|
| `/medicines/compact` size / time | — | — | — | — |
| `catalog-search?q=<term>` p50 | — | — | — | — |
| `search-medicine?q=<term>` p50 | — | — | — | — |
| `sessionStorage` compact bytes / quota fail? | — | — | — | — |
| Keystroke→paint POS row (indexed / unindexed) | — | — | — | — |
| Keystroke→paint POS top | — | — | — | — |
| Keystroke→paint Purchases row | — | — | — | — |
| Shared helper TTLs (POS overlay / Purchases master) | — | — | — | — |

---

## 9. Owner decisions required with the "implement" order

1. Stale-serve vs shimmer after idle (recommended: instant stale + background correct).
2. TTL values for POS overlay vs Purchases master (recommended: shorter overlay, longer master + SSE invalidation).
3. Disposition of the shelved stash (apply-as-starting-point vs discard vs keep-shelved) — default: keep shelved,
   implement fresh from Phase 0.

---

## 10. Data-integrity note (Strict Legitimate Data Contract)

This plan introduces no dummy, placeholder, or invented business data. Missing stock/rate/batch stays missing in
every preview path; error paths retain the previous truthful list and surface via existing `searchSearching` /
toast states. No search path creates inventory or master rows. Real data → process; missing → ask; invalid → reject.
