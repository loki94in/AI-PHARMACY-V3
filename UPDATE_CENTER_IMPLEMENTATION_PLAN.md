# UPDATE CENTER IMPLEMENTATION PLAN

**Status:** Approved plan — NOT yet implemented. No code has been changed by this document.
**Date created:** 2026-10-23
**Session:** Plan-mode analysis of "app shows nothing while updates download in the background"
**Author of plan:** AI agent (owner-confirmed scope decisions below)

---

## 1. Goal (owner's request, in plain words)

The desktop app silently downloads its own update package (~105 MB ZIP) in the background,
but **the app shows nothing while it downloads** — the staff cannot see whether a download is
running, what the latest version is, or whether yesterday's download failed. The owner wants:

1. The live download visible **inside the app itself** (always-on status in the Topbar ticker).
2. A proper **Update Center** in Settings: current version, latest version, live progress in real
   MB, last-check time, truthful failure reasons, and release notes.
3. A small **history list** of past versions + their release notes inside the app.
4. Install banner appears **only when the update is ready** (silent download, no toast spam).

---

## 2. Owner decisions (recorded in this plan's kickoff Q&A)

| Question | Decision |
|---|---|
| Scope | **All**: fix invisible-progress bug + always-visible status + Update Center + reliability |
| Always-visible placement | **Topbar header ticker** (same slot family as Backup / Catalog-sync / "Starting up") |
| Announce style on new version | **Silent download** — banner pops only when `readyToInstall` |
| Release history in app | **Yes** — small list of past versions + changelog (read-only, from GitHub releases) |
| Install UI | Unchanged flows (`Later`, `Install Now`, `POST /api/system/apply-update`) |

---

## 3. Root-cause diagnosis (verified against code, with receipts)

The backend side is already a complete auto-update pipeline. The bug is entirely in the
**delivery of progress to the UI**:

### Defect 1 — `update_progress` is never delivered to the frontend
- `src/services/autoUpdateService.ts` broadcasts `eventService.broadcast('update_progress', {...})`
  on every throttled chunk (~600 ms) during download — that part works.
- BUT `frontend/src/hooks/useGlobalSseInvalidation.ts` lines 90–92 only map:
  ```ts
  update_available: ['sse:update_available'],
  update_check_complete: ['sse:update_check_complete'],
  ```
  `update_progress` is **missing** from `SSE_CUSTOM_EVENTS`, so no DOM CustomEvent is ever
  dispatched for it. Both frontend listeners for `sse:update_progress`
  (`components/UpdateBanner.tsx` line 94, `pages/Settings/LicenseAndUpdatesTab.tsx` line 361)
  are **dead code**.

### Defect 2 — Payload field-name mismatch
- Backend emits: `{ latestVersion, downloadProgress (0–100), downloadedBytes, totalBytes }`
  (`autoUpdateService.ts` lines ~419–424) and broadcast `update_available` frames carry
  `{ downloading, downloadProgress, readyToInstall, ... }`.
- Frontend expects: `{ status: 'downloading', percent, downloaded, total }`
  — neither `status`, `percent`, `downloaded` nor `total` exist in the backend payload.
  Even adding the missing mapping would have shown a stuck 0 %.

### Defect 3 — The "download started" broadcast is ignored
- Boot auto-download fires `update_available { downloading: true, downloadProgress: 0 }`
  ~60 s after boot. `UpdateBanner`'s `updateHandler` only acts when `data.readyToInstall`
  — the initial `downloading: true` frame is swallowed. Net effect: **the 105 MB download is
  completely invisible**, exactly what the owner reported.

### Supporting facts (verified, not bugs)
- `src/routes/license.ts` (whole file) — endpoints: `/status`, `/version`, `/activate`,
  `/machine-id`, `/update-status`, `/start-download`, `/check-update`. The frontend Settings tab
  already calls several of them.
- `POST /api/system/apply-update` exists in `src/server.ts` line ~379 (spawn `Updater.bat`,
  console window shows install progress; rollback on failure handled by the updater).
- Update check cadence (`autoUpdateService.ts`): boot check at T+60 s, 2 h interval timer gated by
  `activityTracker.isIdle(30 min)` + a ≥1-day gate stored in the `update_checks` table
  (`check_interval_days` default 1). Works; not touched by this fix except truthful display.
- `update_checks` table (`src/database.ts` line ~4587): columns
  `last_checked_at, last_known_version, current_version, check_interval_days` — source for
  "last checked" truth (read once into memory, not per request).
- Update server: `website/api/updates.js` (Vercel) `?action=check` returns
  `latestVersion / downloadUrl / updatePackageUrl / sha256 / changelog / rolloutMode`
  with KV release + GitHub-resilience fallback and PILOT-vs-ALL license gating. **Not changed.**
- Releases/publish: `scripts/release.mjs` → GitHub repo `loki94in/AI-PHARMACY-V3`
  (`ghRepo` constant, line 71) + Vercel KV publish. **Not changed.**
- `LICENSE_SERVER` constant: `src/services/licenseService.ts` line ~19.
- Settings tab structure: `pages/Settings/LicenseAndUpdatesTab.tsx` exports
  `LicenseAndUpdatesTab` wrapper (renders `LicenseManagementCard` + `SoftwareUpdateCard`) — the
  rewrite targets `SoftwareUpdateCard` (lines ~250–560).
- Topbar ticker: `components/Layout.tsx` `activeHeaderItems` useMemo (line ~1990). Items have
  `{ id, type, title, subtitle, progress, badge, color, action, actionLabel, icon }`. Established
  insert order convention: cart-job 0 → startup 0.05 → send 0.1 → wa-waking 0.5 → queue 1 …

---

## 4. Target architecture

```
backend (source of truth)                      frontend (single store, many views)
────────────────────────────                   ────────────────────────────────────
autoUpdateService                              updateStatusStore.ts (module store, useSyncExternalStore)
  ├─ broadcasts update_available   ── SSE ──►    ├─ one initial GET /license/update-status
  ├─ broadcasts update_progress    ── SSE ──►    ├─ one internal listener per DOM event
  ├─ broadcasts update_check_comp ── SSE ──►    ├─ normalizes field names once, here
  ├─ GET /license/update-status    ◄────────    └─ consumers:
  ├─ POST /license/check-update    ◄─ click        • Topbar ticker item (Layout.tsx)
  ├─ POST /license/start-download  ◄─ click        • UpdateBanner (ready-only)
  └─ GET /license/update-history   ◄─ click/    • LicenseAndUpdatesTab → SoftwareUpdateCard (update center)
                lazy, on History expand
```

Key principles (from root `AGENTS.md`): **events not timers** (P1) — no new polling anywhere;
one store owns update-state; UI views subscribe via `useSyncExternalStore`.

---

## 5. Implementation steps (exact files, exact behavior)

### Phase A — Shared frontend store (new file)

**CREATE `frontend/src/services/updateStatusStore.ts`**
- Module-level store, same pattern as `services/refillCartJobs.ts` /
  `services/stagedQueueService.ts`: plain module state + subscribe/getSnapshot exported as
  `subscribeUpdateStatus` / `getUpdateStatus` and a React hook `useUpdateStatus()`
  (`useSyncExternalStore`, with a server snapshot).
- **Normalizer (single place where field names are fixed):**
  ```
  normalizeUpdateFrame(frame) → {
    version, state: 'idle'|'downloading'|'ready'|'error',
    percent, downloadedMB, totalMB,
    changelog, downloadUrl, lastCheckedAt, lastError
  }
  ```
  Mapping rules (backend field → store field):
  - `latestVersion → version`
  - `downloading && !readyToInstall → state 'downloading'`; `readyToInstall → 'ready'`;
    `error → 'error'`; nothing known → 'idle'
  - `downloadProgress → percent`; `downloadedBytes → downloadedMB` (÷ 1048576, 1 decimal);
    `totalBytes → totalMB`
  - `progress` frames may omit `readyToInstall` — keep existing phase until a frame says
    otherwise (do NOT flip a `ready` store back to `downloading` on a stale progress frame).
- **Initial fetch:** on first subscribe, single-flight `GET /license/update-status` (one fetch
  per app session — replaces the duplicate fetches UpdateBanner and the Settings tab do today).
- **Internal listeners:** attach once (module-level, on first subscribe) to
  `window` events `sse-update-available`, `sse-update-progress`, `sse-update-check-complete`
  (dash style, dispatched by the global SSE hook with the full parsed frame in `detail` —
  consumers read `detail?.payload ?? detail`).
- **No Component-body impurity:** all `Date.now()`/fetch work stays in module scope
  (react-compiler purity rule, `frontend/AGENTS.md`).
- Types: named exported interfaces, **zero `any`** (lint Phase-2 rollout contract).

### Phase B — SSE wiring fix

**EDIT `frontend/src/hooks/useGlobalSseInvalidation.ts`** (lines 90–92):
```ts
update_available:      ['sse-update-available'],
update_progress:       ['sse-update-progress'],   // ← the missing line (root cause of Defect 1)
update_check_complete: ['sse-update-check-complete'],
```
- Grep confirms the only consumers of the old colon-style names are `UpdateBanner.tsx` and
  `LicenseAndUpdatesTab.tsx`, both rewritten below — safe rename, no orphans.

### Phase C — Backend truthfulness & reliability

**EDIT `src/services/autoUpdateService.ts`**
1. Extend the in-memory `lastResult` shape with `lastError?: string` and add a private
   `lastCheckedAt?: string`.
2. Set `lastCheckedAt` inside `runCheck()` (write the same value that already goes to
   `update_checks.last_checked_at`) and seed it from the DB row once in `start()`'s existing
   boot async block. `/license/update-status` then answers it without a per-request DB read.
3. Set truthful `lastError` at every failure branch:
   - `downloadUpdateSilently` catch → `lastError = 'Download failed: ' + err.message`
   - checksum mismatch → `'Checksum mismatch — package discarded, retry scheduled'`
   - `runCheck` offline/error branch → `'Update server unreachable'`
   - clear it (`lastError = undefined`) on verified-ready and on successful check.
4. **Bounded retry (single, no recursion):** on download failure schedule ONE retry
   (module-level `setTimeout` handle, 15 min, `reason:'auto-retry'`) guarded by
   `isDownloading`, target-still-newer check, and cancelled on success/`stop()`. The retry leg
   may NOT schedule a further retry — after one retry the next scheduled check owns it.
5. **Download stall guard:** in `downloadFile` set `req.setTimeout(120_000)` so a dead socket
   fails the promise after 120 s of no data (existing `req.on('error')` already cleans the
   `.tmp` file and broadcasts the failure). This is the only change to the download helper.

**EDIT `src/routes/license.ts`**
- `GET /update-status` response adds `lastCheckedAt` and `lastError` (from
  `autoUpdateService.getLastResult()` — no new queries).
- **CREATE route** `GET /api/license/update-history` (registered in the same router):
  returns `{ installed: APP_VERSION, releases: [...], offline?: true }`.

**CREATE `src/services/updateHistoryService.ts`**
- Fetches `https://api.github.com/repos/loki94in/AI-PHARMACY-V3/releases?per_page=8`
  (repo lives as `ghRepo` in `scripts/release.mjs`; keep the URL in ONE constant here,
  don't hardcode it in two places).
- Headers: same `User-Agent: 'AI-Pharmacy-Vercel-Updater/1.0'` as `website/api/updates.js`;
  `Accept: application/vnd.github.v3+json`; 4 s timeout. GitHub unauthenticated limit is
  60 req/h per IP — one app + a 10-minute module TTL cache keeps this safely inside.
- Map each release → `{ version (tag minus leading 'v'), name, publishedAt, changelog: body }`,
  plus `isNewerThanInstalled` using the existing exported `compareVersions()`
  (import from `autoUpdateService.ts` — do not fork version math).
- Offline/errors → `{ installed, releases: [], offline: true }` — truthful, never fabricated rows
  (Strict Legitimate Data contract).

### Phase D — UI

**EDIT `frontend/src/components/UpdateBanner.tsx` (rewrite)**
- Subscribe to the store via `useUpdateStatus()`; delete all local SSE listeners and the local
  `update-status` fetch (store owns both).
- **Ready-only banner** (owner decision): render only when `state === 'ready'` and
  `sessionStorage.getItem('update_later_' + version) !== 'true'`. Keep:
  changelog "What's new" toggle, `Later` (writes `update_later_<v>`, hides until restart),
  `Install Now` → `POST /api/system/apply-update` + the existing fullscreen
  "Launching Update Installer..." overlay. Semantics of the code path unchanged.
- Delete the downloading-state banner entirely (the ticker owns download progress now).
- Keep `bg-primary` fill + `text-white` labels (sanctioned accent-fill exception, bug P2-05),
  semantic tokens for everything else, no `backdrop-filter`, no endless animations
  (No-GPU contract).
- Keep the element id `update-action-btn` on Install Now (external tooling may target it).

**EDIT `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx` (`SoftwareUpdateCard`)**
- Replace local SSE/fetch logic with `useUpdateStatus()`.
- Header text truth fix: replace "auto-checks every 15 days" — the real cadence is
  "checks on every boot, then daily in the background (only while idle)". Show
  `lastCheckedAt` from the store as `Last checked <HH:MM>` once known.
- Live state card:
  - `downloading`: progress bar + `{downloadedMB} MB / {totalMB} MB ({percent}%)`,
    real values from the store, plus the existing "you can keep working" line.
  - `ready`: verified-ready strip + `Install & Restart Now` + `Later` (existing behavior).
  - `error`: red strip with the truthful `lastError` + a `Download Update (105 MB)` retry button
    (`POST /license/start-download`, existing route) shown when a newer version exists but is
    neither downloading nor ready.
  - `idle` + no update: existing "You're up to date" strip.
- `Check Now` keeps calling `POST /license/check-update` and ALSO seeds the store directly
  from the response (covers a missed SSE frame; still no timers).
- **History list (owner decision):** new collapsible "Recent releases" section, rendered at the
  bottom of `SoftwareUpdateCard`. Fetched ONCE on first expand (module-level cache +
  ≤10-min TTL + a `Refresh` button) from `GET /license/update-history`.
  Rows: `v{version} · {publishedAt date}` + notes (`whitespace-pre-line`), the row matching the
  installed version gets an `Installed` chip; genuinely newer rows get a `Newer` chip.
  Offline endpoint response → single row "Release history unavailable while offline."
  No dummy data ever displayed.
- Lint hygiene (this file currently has `catch (err: any)` patterns — keep only where they
  already exist; all NEW code uses `unknown` + named interfaces per `frontend/AGENTS.md`).

**EDIT `frontend/src/components/Layout.tsx` (Topbar ticker item)**
- Add `const updateStatus = useUpdateStatus();` beside the existing store subscriptions.
- Inside `activeHeaderItems` insert ONE item between startup (0.05) and send (0.1) as id
  `'app-update'` (priority 0.07):
  | store state | item |
  |---|---|
  | `downloading` | title `⏬ Update v{version} — {percent}%`, subtitle `{downloadedMB} of {totalMB} MB downloading in background`, `progress: percent`, badge `'Downloading'`, color `'sky'` |
  | `ready` | title `✅ Update v{version} ready`, subtitle `'Downloaded & verified — install anytime'`, badge `'Install'`, color `'emerald'` |
  | `error` | title `⚠️ Update check failed`, subtitle truthful `lastError`, color `'amber'` |
  | `idle` + checked known | title `✅ App up to date (v{current})`, subtitle `Checked {HH:MM from lastCheckedAt}`, color `'emerald'` |
  | nothing known yet | **no item** (silent until first status arrives) |
- `action: () => navigate('/settings?tab=license')` with `actionLabel: 'Updates'` (uses the
  existing navigate already available in Layout; stable callback per chrome-memoization rules).
- The item derives purely from the store — **zero new timers**; the ticker re-renders only on
  store changes (throttled ~600 ms by the backend's progress reporting design).
- Colors are the four existing allowed item colors; icon pattern follows the existing items
  (12 px lucide + `shrink-0`).

### Phase E — Wrap-up animations & message copy
- `animate-bounce` on the downloading icon is fine (capped at 3 cycles by `index.css`).
- All copy states real values; no "simulated", no placeholders (No Simulated/Mock rule).

---

## 6. What is explicitly NOT changed (guardrails against regression)

- `website/api/updates.js` (update server) — untouched.
- `scripts/release.mjs` / build pipeline — untouched; version auto-bump behavior unchanged.
- `POST /api/system/apply-update` handler in `src/server.ts` — untouched.
- `Upader.bat`/packaging — untouched.
- Update check cadence logic (`BOOT_DELAY_MS`, interval gating, daily gate in DB) — untouched.
- No new EventSource anywhere (Single Global SSE Connection rule).
- No new `setInterval`/`refetchInterval` (Data Fetch Control + guardrail rules) — the one new
  `setTimeout` lives backend-side as a single bounded retry, sanctioned above with rationale.
- No WhatsApp/patient/distributor messaging involvement (Manual-Only Patient Messaging intact).
- No business-data writes; the only DB write remains the existing `update_checks` row update.

---

## 7. Files touched (full list)

| # | File | Action |
|---|---|---|
| 1 | `frontend/src/services/updateStatusStore.ts` | **CREATE** — store + normalizer + hook |
| 2 | `frontend/src/hooks/useGlobalSseInvalidation.ts` | EDIT — 3-line event map fix (lines 90–92) |
| 3 | `src/services/autoUpdateService.ts` | EDIT — lastError/lastCheckedAt, single bounded retry, stall timeout |
| 4 | `src/routes/license.ts` | EDIT — extend `/update-status`, ADD `/update-history` |
| 5 | `src/services/updateHistoryService.ts` | **CREATE** — GitHub releases, TTL cache |
| 6 | `frontend/src/components/UpdateBanner.tsx` | REWRITE — store-driven, ready-only |
| 7 | `frontend/src/pages/Settings/LicenseAndUpdatesTab.tsx` | EDIT — `SoftwareUpdateCard` store-driven + history section |
| 8 | `frontend/src/components/Layout.tsx` | EDIT — one new ticker item |
| 9 | `docs` (below) | EDIT after implementation |

Not touched: everything else.

---

## 8. Mandatory DOX / AGENTS.md contract compliance checklist (verify the agents)

Per root `AGENTS.md` (DOX), before editing the implementing agent MUST read the full chain:
root `AGENTS.md` → `frontend/AGENTS.md` + `src/AGENTS.md` → plus, because this is officially a
**bug fix + feature**: `AGENT_BUG_FIX_RULEBOOK.md` (root), `SMALL_BUG_FIX_PLAN.md` (root),
and `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` §7 (API Efficiency Standard — no new timers).
File-per-file compliance:

- [x] Plan verified against: `front-end AGENTS.md` (UI tokens/z-index/lint rules),
      `src/AGENTS.md` (boot-path hygiene, transactions untouched here),
      `useGlobalSseInvalidation.ts` (SSE checklist: emit event → add mapping line),
      `UpdateBanner.tsx` + `LicenseAndUpdatesTab.tsx` (full reads),
      `Layout.tsx` ticker internals, `license.ts`, `autoUpdateService.ts` (full read),
      `website/api/updates.js`, `scripts/release.mjs` (repo constant), `database.ts`
      (`update_checks` schema).
- [ ] Implementation keeps **zero `any`** in every NEW file (named interfaces, `unknown` + cast).
- [ ] React Compiler purity: no impure calls inside component bodies; constants hoisted to
      module scope.
- [ ] Semantic Tailwind tokens only (`bg-bg/bg2/bg3`, `text-text/muted`, `border-border`);
      `text-white` reserved for `bg-primary` accent fills (P2-05 exception).
- [ ] No `backdrop-filter`, no hover-lift, no new endless animations (No-GPU contract).
- [ ] No native `alert()`/`confirm()` — toasts via `toastEvent.trigger` only (Settings banner).
- [ ] No polling/timers added on the frontend; backend gains exactly ONE bounded one-shot retry
      timer with the rationale recorded HERE (root AGENTS.md "sanctioned exceptions" spirit;
      guardrail rule handles must double-check `--all` advisory if flagged).
- [ ] `npm run guardrails` passes before commit (blocking).
- [ ] `node scripts/quick-update.mjs` after every backend/frontend file change (knowledge graph).
- [ ] DOX update pass after implementation:
      - `frontend/AGENTS.md`: add a short **"Update Center & Update Status"** contract section —
        `services/updateStatusStore.ts` is the single owner of update state (no second
        EventSource, no duplicate `/update-status` fetch); ticker item sleeps unless the store
        has state; banner is ready-only; SSE mapping lines for `update_*` must not be removed.
      - `src/AGENTS.md`: short bullet — `autoUpdateService` carries truthful `lastError`/
        `lastCheckedAt`, one bounded download retry (15 min, single-shot), stall timeout in
        `downloadFile`, and `GET /license/update-history` is the only GitHub-releases reader.
      - `SMALL_BUG_FIX_PLAN.md`: record the defect as **[Fixed] P2-104 — In-app update
        download invisible (missing `update_progress` SSE mapping + field-name mismatch +
        banner drops downloading broadcast)** under "Fixed".
- [ ] 8-point Data Integrity Audit Summary in the final implementation report
      (expected results: no dummy data found/introduced; no auto-created records; data sources =
      GitHub releases + local `update_checks`; missing data renders "unavailable", never fabricated).

---

## 9. Verification matrix (post-implementation)

| # | Test | Expected | How |
|---|---|---|---|
| 1 | `npm run guardrails` | PASS | Blocking gate |
| 2 | `npx tsc --noEmit` (root + frontend) | PASS | Clean compile |
| 3 | SSE frame wiring | Ticker + settings show live % and MB within ~1 s of a real broadcast | In dev, run from a scratch REPL/service call: `eventService.broadcast('update_progress', { latestVersion: '0.1.999', downloadProgress: 42, downloadedBytes: 43433164, totalBytes: 103409495 })` then `update_available` with `readyToInstall: true` → banner appears with "What's new" |
| 4 | Banner ready/hidden | `Later` hides it for the session (`update_later_<v>`); banner returns only on restart or a different version | Click test |
| 5 | `GET /api/license/update-history` | `{ installed: <running version>, releases: [ ≤8 rows, real GitHub data ] }`; with Wi-Fi off → `{ releases: [], offline: true }`, UI shows "unavailable while offline" | curl + offline test |
| 6 | Truthful failure | Kill network mid-download → after 120 s stall timeout the error state shows the real reason in ticker (⚠️) + settings card; ONE retry 15 min later; a second failure does NOT schedule another retry | Observe `updater.log`-adjacent server console + UI |
| 7 | Real end-to-end | Publish a `--pilot` release while an older installed build runs → boot check at T+60 s → ticker shows download %, then Ready; Install Now → `Updater.bat` console window → app restarts at the new version | Real pilot release (owner-approved timing) |
| 8 | No regressions | `node scripts/quick-update.mjs` runs; no other page/list behavior changed (Update UI owns no shared query keys added to `SSE_QUERY_MAP`) | Diff review |
| 9 | Doc pass | `frontend/AGENTS.md`, `src/AGENTS.md`, `SMALL_BUG_FIX_PLAN.md` updated as in §8 | Review |

---

## 10. Risks & mitigations

| Risk | Mitigation in plan |
|---|---|
| Progress SSE floods the ticker | Backend already throttles progress emits to ~1 per 600 ms; store updates are O(1); ticker re-render cost is the same as existing live items (WhatsApp queue) |
| GitHub rate limits on history endpoint | 10-min TTL cache, ≤8 releases, single reader service |
| Stale `ready` overwritten by late progress frame | Normalizer rule: progress frames never demote a `ready` store |
| Retry storm | Exactly ONE scheduled retry; recurrence forbidden; cron/interval cadence unchanged |
| `/settings?tab=license` route param mismatch | Verified the Settings hub renders `LicenseAndUpdatesTab` on tab `'license'` (`Settings/index.tsx` line ~188); navigate uses the same param |
| Old colon-style event listeners elsewhere | Grep confirmed none outside the two rewritten files |

---

## 11. Rollback

Each phase lands independently revertible:
- Phase B mapping + store (A) can revert by deleting the map lines + the new file
  (no persistent state; banner falls back to its old behavior only if its rewrite is also reverted).
- Backend additions are additive fields/endpoints — no schema migration, no destructive change,
  no DB version bump (immune to the fast-boot/ensureSchema dual-path contract).

---

*End of plan — implementation must follow this document; deviations must be recorded in
`SMALL_BUG_FIX_PLAN.md` alongside the fix entry.*
