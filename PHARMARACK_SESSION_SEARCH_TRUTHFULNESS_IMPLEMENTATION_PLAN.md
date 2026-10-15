# Pharmarack Session + Search Truthfulness Implementation Plan (PLAN ONLY — no code changed)

> Reported symptoms (installed app): cold boot search shows medicine results; later search shows nothing, Pharmarack shows not-connected/OFFLINE; Pharmarack Cart takes too much time; CRM page stuck on loading; screens show empty though cached cart items exist — frontend/backend connection state mismatched.
> Binding contracts: root `AGENTS.md` (Pharmarack session persistence, SPA deferred-SSE, No-GPU), `frontend/AGENTS.md` (single global SSE, autocomplete gating, dropdown-scroll), `src/AGENTS.md` (hot-path queries, transaction guard, boot lazy loading), `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` (P1–P4), `AGENT_DATA_FLOW_TREE.md` (one writer per fact; missing stays missing).

## 1. Frontend vs backend connection check (as found)

### Backend truth sources (`src/routes/pharmarack.ts`)

* `GET /session-status` (`pharmarack.ts:3329`): `healthy=true` only when shared probe `probeUserCartDetails(6000)` returns `ok`. `401/403` → `EXPIRED`; other status → `SERVER_ERROR`; thrown timeout → `NETWORK_ERROR`. Also returns `isRefreshing` from scheduler mutex state. No-token → `NO_TOKEN`.
* `GET /auto-verify` (`pharmarack.ts:3282`): same probe at 6s; `NO_TOKEN` / `EXPIRED` / `SERVER_ERROR` / `NETWORK_ERROR`.
* `GET /search` (`pharmarack.ts:531`): stale-or-fresh disk cache first (`searchCache.lookup`, <1ms); else `performPharmarackSearch` (warm 8s / cold 12s, retry leg 5s). Answers: `200` items, `200 []`, `401 NEED_LOGIN (+isRefreshing)`, `503 CONNECTION_ERROR`.
* `GET /live-cart-summary` (`pharmarack.ts:3064`): 20s probe + full cart reshape + per-distributor phone enrichment loop (`pharmarack.ts:3243` awaits `resolveDistributorContact` per unmapped distributor) + `special_orders` + mappings queries. Heavy: called by Layout on boot (`Layout.tsx:1086`) and cart modal open.
* `GET /cart` serves `serverCartCache` when fresh (<30s, `pharmarack.ts:2960`); shared probe micro-cache 10s (`pharmarack.ts:931`) collapses summary + session-status + cart into one upstream call.
* Heartbeat (`tokenRefreshScheduler.ts:344`): 12s probe; `ok` → `active`; `401/403` → marks `expired`, stands by for manual re-auth (no auto browser restore on that path); offline network → silent skip. `executeRefresh()` mutex is single-flight for 401-retry/catalog callers.

### Frontend decisions (as found)

* `LiveCartAddModal.tsx:942 checkSession`: `healthy` → `active`; `isRefreshing` → `restoring`; anything else (EXPIRED/NO_TOKEN/SERVER_ERROR/NETWORK_ERROR/throw) → `disconnected` → red `OFFLINE` chip (`LiveCartAddModal.tsx:2107`). Same pattern in `QuickOrderModal.tsx:1027`.
* `LiveCartSearchSection.tsx:249`: `NEED_LOGIN + isRefreshing` → “Restoring …” row; other failures render a `⚠️ message` pseudo-row (`LiveCartSearchSection.tsx:383`) — must never look like a real medicine.
* `PharmarackCart/index.tsx:3274 fetchCart`: spinner only on cold module cache; then `GET /pharmarack/cart`, then `fetchPriceHistories` + `fetchLatestSentMap` fan-out. Slow cart = slow `/cart` or slow follow-ups, not render.
* `CRM/index.tsx:37` shell is light; wait lives in tab sections (`RefillsSection` → `GET /refills/panel` two-pass; `SpecialOrdersSection` → `GET /orders`) when they queue behind the SQLite writer or a long cart/summary probe. `CRM/index.tsx:44` prewarms WhatsApp only (10-min visible); it never blocks paint.

### Mismatch table (why “empty + OFFLINE + cached items” co-exist)

| Frontend shows | Backend state | Cause |
|---|---|---|
| `OFFLINE`, search empty | `EXPIRED` (real 401/403) | Session dead; manual Reconnect required by current code |
| `OFFLINE`, search empty | `NETWORK_ERROR`/`SERVER_ERROR` | Internet flap or slow probe; collapsed to same `disconnected` chip |
| `OFFLINE`, cart preview HAS items | cached `serverCartCache`/module cache | Preview is stale cache, correctly kept; label missing |
| Cart Loading long | `/cart` or summary probe slow (up to 20s) + price-history fan-out | First paint blocked on network instead of cache |
| CRM Loading long | `/refills/panel` or `/orders` waiting on writer lock | Same contention window as cart probe |
| Strange extra row in search | `⚠️/🔄` fallback pseudo-row or look-alike variant | Must be visually distinct / filtered (see §3) |

## 2. OLD behavior (current)

1. Cold boot works: fresh token + warm disk search cache → instant results.
2. After expiry/flap: every failure shape collapses to `disconnected`/OFFLINE; search returns `[]`-equivalent empty with no distinction between “no such medicine”, “session expired”, “restoring”, “no internet”.
3. Cart first paint waits on live network; CRM tabs wait on uncached-or-locked queries; user perceives “not opening”.
4. Search ranking (`scoreProductName`, mapped-first) can surface same-name different-pack/strength variants (e.g. base vs Plus/DS, other cane/pack) — user reads these as fake data.

## 3. NEW behavior (target — the no-fake-data rule is binding)

1. Four visible connection states, never collapsed: `Connected` (verified), `Restoring…` (transient, single-flight refresh running), `Session expired — Reconnect` (proven 401/403), `Connection issue — retry` (timeout/offline). Cached cart preview stays visible but labeled “cached”.
2. Search answers exactly one of: verified results / genuine empty (“No match found anywhere”) / restoring / connection issue / session expired. Empty never substitutes for error and vice versa.
3. **No-fake-data rule:** a search for medicine X returns ONLY rows whose core medicine tokens equal X (`orderNameMatcher.getCoreMedicineTokens` / `sameProductName`). Forbidden: substring/`LIKE %name%` match, first-hit auto-pick, name-only add (`productId:0/storeId:0`), cross-distributor product-code pairing, strength/pack-variant substitution (base vs Plus/DS/H/other cane), offline/local rows presented as live orderable, `⚠️/🔄` fallback rows styled as medicines. Unmatched stays empty; linking stays explicit via `MedicineLinkModal` (user click); cart-add id resolution stays store-scoped (store link → store history → store-scoped live search).
4. Cart paints from module/`serverCartCache` instantly; live revalidation runs silent after paint. CRM tabs paint from cache; `PageQueryTracker` refetches own stale keys only.
5. Same locks, shorter holds: no “unlock forever”; speed from async fs, TTL caches + write-interceptor invalidation, chunked (≤500) indexed queries, `runHeavyJob` lane, short transactions with `ROLLBACK` on early returns.

## 4. Work list (implementation order — NOT done here)

1. Status plumbing: surface backend `reason` (`EXPIRED`/`NO_TOKEN`/`SERVER_ERROR`/`NETWORK_ERROR`) + `isRefreshing` through `checkPharmarackSession` into distinct header chips in `LiveCartAddModal`, `QuickOrderModal`, `PharmarackCart`; label cached preview as cached.
2. Heartbeat 401/403: resume single-flight `executeRefresh()` per session-persistence contract (keep manual Reconnect fallback); keep offline-skip silent; keep `pharmarack_session_refreshed` broadcast.
3. Search core: run live + turbo-fallback + offline sets through the core-token equality filter before rank/cache; never cache filtered rows; keep `NEED_LOGIN`/`CONNECTION_ERROR` codes and timeouts unchanged.
4. Cart open path: cache-first paint; move `fetchPriceHistories`/`fetchLatestSentMap`/phone enrichment off the critical paint (lazy/silent); cap `live-cart-summary` probe cost for the header use.
5. CRM tabs: verify `SSE_QUERY_MAP` keys, cache seeds, and `usePageActive` gating for refills/special-orders lists; no new `EventSource`, no eager cross-page refetch.
6. Verify (§5), update `SMALL_BUG_FIX_PLAN.md` entries actually fixed, regenerate docs.

## 5. Acceptance

* [ ] Forced 401 → `Restoring…` → auto-active or truthful `Session expired`; one Chrome only.
* [ ] Airplane mode → `Connection issue`, cached cart labeled, zero fake rows.
* [ ] `TELMA 40` never returns `TELMA 40 H`/Plus/DS/other pack as the match; unknown name returns genuine empty.
* [ ] Cart + CRM tabs paint from cache <1s warm; idle 10 min ≈0 UI calls.
* [ ] `npm run guardrails` exit 0; graph updated.

## 6. Forbidden

Preload-all-pages at boot; removing SQLite/transaction/lane locks; silent `catch → []`; auto master/inventory creation; worker-driven patient WhatsApp; second `EventSource`; `alert()/confirm()`; UTC bill dates (B4); GPU switches (E1); invented fallbacks (`B-*`, estimated rates/MRP).

*Plan only. No source files were changed to produce this document.*
