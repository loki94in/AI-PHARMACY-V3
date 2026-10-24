# System Memory Protection & PC-Freeze Fix Plan (P2-104)

**Status:** PLAN ONLY — no code has been touched. Nothing in this document has been implemented yet.
**Created:** 2026-10-23 (planning session, same day as owner report)
**Reporter:** Pharmacy owner (via chat, in the app the PC freezes / the whole PC slows down, needs PC restart)
**Bug register ID assigned:** P2-104 (next free ID after P2-103; `SMALL_BUG_FIX_PLAN.md` Open section has no entry for this issue)
**Plan document location (this file):** project root, following the convention of `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` / `SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md`.

---

## 0. How to use this document

1. Read this file fully BEFORE writing any code (it is the plan for bug **P2-104**).
2. The implementing agent MUST first read the mandatory chain (Section 12, step 0-1): root `AGENTS.md`,
   `src/AGENTS.md`, `frontend/AGENTS.md`, `AGENT_BUG_FIX_RULEBOOK.md`, `SMALL_BUG_FIX_PLAN.md` § 4 (Fixed + Open),
   `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` (§ 3 principles + § 7 API Efficiency Standard).
3. Implement Phase A → verify on the running PC → implement Phase B → soak-test (Section 13) →
   bookkeeping (`SMALL_BUG_FIX_PLAN.md`, AGENTS.md DOX updates, `node scripts/quick-update.mjs`).
4. Do not skip Phase A. It produces the evidence that decides whether Phase C is needed and
   prevents us from "fixing the wrong thing" (the same mistake that cost this project time on P1-54).

---

## 1. What the owner reported (translated as-is from chat)

Owner messages (typos preserved where needed to keep the original meaning):

> "current in the app when start … the pc get slow some time after that … but some time app and pc both the very slow and not work, user need to restart the pc. Then after few min when user start the app, pc work perfectly fine, app also fast."

**Interpretation (confirmed with the owner):**
- Symptom 1: sometimes right after launching the app, the **whole PC becomes slow** for a while.
- Symptom 2: sometimes **both the app and the PC freeze very badly** — Windows stops responding —
  and the only way to recover is to **restart the PC**.
- After a PC restart, starting the app again a few minutes later: **everything is perfectly fast**.

The restart is the giveaway: a PC restart clears **memory**, zombies and leftover child processes.
The app restart alone does not. This plan therefore treats the problem as a
**system-resource problem**, not a UI-lag problem.

---

## 2. Planning-session process log (what was actually done to reach this plan)

Per the mandatory bug-fix rulebook, the diagnosing agent read before proposing:

| # | Step | Result |
|---|------|--------|
| 1 | Read root `AGENTS.md` (auto-injected), `src/AGENTS.md`, `frontend/AGENTS.md` (lines 1-120) | contracts confirmed (No-GPU E1, boot staggers P2-81/P2-88, WhatsApp idle-sleep default 0, API Efficiency Standard) |
| 2 | Read `electron/main.ts` (full) | single-instance lock ok; window-first splash ok; **both Electron main AND backend child set ABOVE-NORMAL priority** (`main.ts:241-250, 359-370`); comment at `main.ts:437-442` admits force-killed sessions make the NEXT boot burn 1-3 min on corrupted session locks |
| 3 | Read `src/server.ts` (full boot pipeline, lines 1-1200) | staged boot verified: schema gate → Phase 2 caches → Pharmarack heartbeat T+600ms → WhatsApp boot restore loop T+12s ×3 retries 60s apart (lines ~760-786) → Phase 3 workers T+25s → Phase 4 browsers/crons T+2/5/6/8s → cart warm-up chains on first heartbeat + T+52s fallback |
| 4 | Read `src/database/connection.ts` (cold-start & recovery region) | full `PRAGMA integrity_check` runs ONLY inside the self-healing restore path (line 638), not on every boot — normal boots are not integrity-scanned |
| 5 | Read `src/services/tokenRefreshScheduler.ts` (start/heartbeat/refresh) | REST heartbeat is P4-exempt; Chrome launches ONLY on dead token / profile capture / manual reauth; `executeRefresh()` single-flight; profile copied in AND back at `:546` and `:649` |
| 6 | Read `src/services/scispacyClient.ts` | Python sidecar is env-gated OFF by default (`SCISPAXY_ENABLED`), lazy otherwise — not a boot suspect |
| 7 | Read `src/services/backupService.ts` (init region) | backup scheduler init is schedule-driven; gzip CPU cost exists but is lane-routed; monitor plan will confirm timing |
| 8 | Grep repo for resource monitoring: `process.memoryUsage` / `os.freemem` / `os.totalmem` / `heapUsed` | **ZERO hits in all of `src/`.** The app never watches memory — it is blind |
| 9 | Grep repo for zombie cleanup tasklist / chrome.exe handling | `src/utils/chromeBrowser.ts:304 killOrphanChromeProcesses()` EXISTS — PowerShell Win32_Process query + wmic fallback, kills chrome.exe/msedge.exe whose command line matches a profile folder path. **But** it is called only as a pre-launch / post-failure lock-clear step at 6 sites (all Pharmarack: `tokenRefreshScheduler.ts:171,526`, `routes/pharmarack.ts:792`, `routes/utilities.ts:810`, `pharmarackCheckoutService.ts:406,759`, `chromeBrowser.ts:512`), covers ONLY `pharmarack_profile`, **never called on a schedule**, never covers WhatsApp `.wwebjs_auth`, has no telemetry |
| 10 | Read `chromeBrowser.ts:300-460` | found supporting infra to reuse: `cleanTempProfileFolders()` (orphans `pharmarack_profile_temp_*`), `trackHeadless()/untrackHeadless()` central registry (`activeHeadlessRegistry`) of live headless sessions, `closeAllHeadlessBrowsers()` shutdown path |
| 11 | Machine measured live via PowerShell (the shop PC = this dev PC, confirmed by owner) | see Section 3 |
| 12 | `SMALL_BUG_FIX_PLAN.md` Fixed + Open sections read | no existing entry for system-wide freeze; this plan registers P2-104 |
| 13 | `python_scripts` / imports checked for `spawn` | `src/server.ts:509 extractMedicinesWithPython` spawns python with a 5s kill — bounded, not a freeze suspect |

**Important re-rank during this session:** after step 9, the plan changed from "build a reaper"
to "extend the existing `killOrphanChromeProcesses` + schedule it + add monitoring" (Ponytail rung 4:
use the installed dependency/code path; do not duplicate).

---

## 3. The PC (measured live on 2026-10-23 14:xx IST, this machine = the shop PC)

```
CPU:          Intel Core i7-4770TE @ 2.30 GHz — 4 cores / 8 threads (low-power "T" desktop CPU)
RAM:          12,838,428,672 bytes total ≈ 12 GB; ~6.05 GB free at measurement (OS + app stack already resident)
Disks:        C:/D:/E:/F:/G: all reported SSD via WMI (project on E:)
Windows boot: 23-10-2026 14:16
```

Implications used by this plan:
- 12 GB / 4-core CPU: comfortable for **one** Chromium, borderline for **two resident** ones.
- Every process fights for 4 physical cores; a single runaway Chrome or a double Chrome restore
  is immediately visible system-wide.
- The app's own stack on this machine: Electron (main + renderer, CPU-rendered) ~0.7-1 GB,
  backend Node (heap cap `--max-old-space-size=512`, `main.ts:204`) ~0.5 GB,
  WhatsApp headless Chrome (resident 24/7 by owner choice) ~0.3-0.4 GB json RAM,
  Pharmarack headless Chrome (when session restore runs) ~0.3-0.4 GB,
  plus Google-OCR/screenshot searches, plus Windows + Defender — the headroom is real but thin.

---

## 4. Root causes (ranked, evidence-tagged)

| # | Cause | Evidence | Confidence |
|---|-------|----------|------------|
| 1 | **Blind app — no memory/telemetry anywhere.** When RAM runs out → Windows pagefile thrash → desktop + app freeze together; only restart clears it | repo-wide grep found zero `os.freemem`/`process.memoryUsage` uses (step 8); symptom matches swap-thrash signature | verified gap |
| 2 | **Zombie headless-Chrome processes accumulate and are never swept.** WhatsApp boot restore retries 3× (`server.ts:760-786`); WA inbound watchdog reloads pages every 5 min; Pharmarack single-flight restore copies a full Chromium profile in/out on every dead-token event. Any killed/timed-out parent leaves chrome.exe children alive at NORMAL priority. The existing reaper runs only right BEFORE a Pharmarack launch — a process that leaked 2 hours ago is not touched until the next Pharmarack event | step 9 call-site audit (6 sites, all reactive); `chromeBrowser.ts:304-346` | strong |
| 3 | **Two Chromium engines can restore simultaneously at boot** — WhatsApp boot restore (T+12s) is an independent path from the Pharmarack single-flight refresh (may start from the T+600ms probe 401). On this 12 GB / 4-core box: 2 Chromes + 2 full-profile disk copies + SwiftShader UI paint at the same time | `server.ts` boot staging (step 3); per-subsystem mutexes only (`executeRefresh` internal; no cross-subsystem gate) | likely |
| 4 | **Priority makes spikes system-wide**: Electron main AND the backend run ABOVE-NORMAL (`electron/main.ts:246, 365`), and Windows children inherit the parent's class — every headless Chrome spawned by the backend likely launches ABOVE-NORMAL too. During boot spikes, Windows starves the whole desktop → "PC got slow right when the app started" | `electron/main.ts` lines cited; Windows priority-class inheritance | strong for symptom 1 |
| 5 | **WhatsApp Chrome resident 24/7** (~0.3-0.4 GB) — OWNER DECISION: must stay ALWAYS INSTANT (no idle sleep). Accepted as a fixed constraint; memory must be freed elsewhere | owner answer recorded in Section 5 | fixed constraint |
| 6 | Unclean shutdown → next-boot burn on corrupted session locks / big WAL (1-3 min, `main.ts:437-442`) — a CONSEQUENCE of cause 1/2 freezes, not a root cause | code comment | consequence |
| 7 | Windows Defender real-time scanning of profile-copy churn + big SQLite writes during restores — owner-side action, code cannot remove it | plan-level; measured during Phase A | suspected, deferred to Section 11 |

**Non-causes checked and excluded:** scispaCy sidecar (env-gated off), python bridge (5s kill),
master-CSV enrichment (fingerprint-gated since P1-54), ensureSchema integrity block (recovery-only),
single-instance/duplicate-execution (lock verified in `main.ts:50-62`).

---

## 5. Owner decisions recorded (binding for the implementation)

| Question asked | Owner answer | Consequence |
|---|---|---|
| Is the PC the dev machine? | YES — same PC (i7 / 12 GB / SSD) | plan sized to 12 GB (Section 3) |
| When does slowness happen? | "Both PC + app freeze" (needs PC restart) | treat as resource exhaustion / zombie accumulation, not just boot spike |
| Can WhatsApp bot sleep when idle? | **NO — bot must always reply instantly** | `whatsapp_idle_sleep_min` stays default 0; WhatsApp Chrome is ALWAYS protected by the reaper and pressure logic; memory freed from zombies/Pharmarack instead |

---

## 6. Hard contracts the implementation must respect (DOX compliance)

1. **No-GPU Desktop Rendering Contract (root AGENTS.md, guardrail E1):** never remove
   `disableHardwareAcceleration` / swiftshader switches; no new GPU-forcing flags; keep UI draw cost cheap.
2. **Boot staging (P2-81 / P2-88, `src/AGENTS.md`):** never move the existing phase timers EARLIER;
   new staged work starts at T+90s or later (after all current boot restores settle).
3. **API Efficiency Standard (`API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` § 7):** the monitor tick is a
   (c) "deliberately registered time trigger" — it needs a `DATA_FETCH_REGISTRY`-style key + written
   justification in the guardrails ALLOW block; the Settings card data uses `manual` mode (fetch only
   on open / explicit button), never a frontend poll.
4. **P4 credentials sacred:** reaper NEVER deletes or touches `.wwebjs_auth` /
   `data/pharmarack_profile` session stores — it kills PROCESSES, never data folders. The only disk
   cleanup allowed remains the existing `cleanTempProfileFolders()` pattern (temp copies only).
5. **Strict Manual-Only Patient Messaging / Zero-ban-risk Pharmarack:** the monitor and reaper send
   NO messages to anyone; they never drive WhatsApp/Pharmarack behavior; memory-pressure alerts go
   only inside the app (SSE toast) — no WhatsApp pings.
6. **Strict Legitimate Data:** every number shown to the user is a REAL measured value (PID, RAM KB,
   free MB, timestamp). No invented averages, no "simulation" card.
7. **Ponytail (`.agents/rules/ponytail.md`):** stdlib does it (`os.freemem`, `process.memoryUsage`,
   PowerShell one-liner already proven in `chromeBrowser.ts:312-320`) — no new dependencies.
8. **Background workers idle-gating (P3):** the scheduled sweep ride `runHeavyJob()`-style serialization
   or a simple idle-stretched interval; it must never collide with the WhatsApp queue or heartbeat lanes.

---

## 7. Phase A — System health monitor + telemetry (measure BEFORE curing)

### A.1 New file `src/systemHealthMonitor.ts` (backend, no new deps)

State to keep (module-scope, like other legacy caches):

```ts
interface ChromiumProcCensus { pid: number; name: 'chrome.exe'|'msedge.exe'; rssKB: number; profileMatch: 'pharmarack_profile'|'.wwebjs_auth'|temp|'other'; protected: boolean; }
interface HealthTick { ts: string; freeMB: number; totalMB: number; backendRssMB: number; backendHeapMB: number; eventLagMs: number; cpuDeltaPct: number; chrome: { zombieMB: number; zombieCount: number; activeCount: number; list: ChromiumProcCensus[] }; }
```

- `startSystemHealthMonitor()` — single `setInterval(30_000)`, stretched to 60_000 while
  `activityTracker.isIdle(5*60_000)`, **never stops entirely** (written rationale: idle hours are
  exactly when lane jobs/backups run and when freezes happen — same exemption class as the token
  heartbeat; recorded in the guardrails ALLOW block with a reference to § 7.1(c) of the API plan).
- Every tick: capture `process.memoryUsage()`, `process.cpuUsage()` delta, event-loop lag
  (microtask drift benchmark 50ms), `os.totalmem() - os.freemem()`.
- Every tick (or every 2nd tick under idle): run the SAME PowerShell census query pattern already
  used by `killOrphanChromeProcesses` but reading PID + WorkingSetSize + CommandLine, classify each
  chrome.exe/msedge.exe row by which profile dir its command line names
  (`pharmarack_profile_*`, temp copies, `.wwebjs_auth…`) and whether its PID is inside the
  `activeHeadlessRegistry` set or the active WhatsApp/Pharmarack client PID getters.
  Electron's UI subprocesses are named `PharmacyOS.exe` — they can never match a chrome.exe filter.
- Overhead budget: ≤ 1 PowerShell call per 30s (~30-60 ms CPU on i3), else skip census that tick.
- Append one JSON line per tick to `<appDataDir>/data/logs/system-health.jsonl` via `fs.appendFile`.
- Retention: rotate when file > 2 MB (keep `.1`..`.3`), prune rows older than 14 days on boot.
- Export `getLiveHealthSnapshot(): HealthTick & { fromLog: HealthTick[] }` for the route.

### A.2 Boot PERF line (`src/server.ts` — additive only)

Wrap nothing earlier; only ADD measured milestone logs (schema ms, Phase2 ms, first heartbeat ms,
WhatsApp restore attempt durations, `copyProfileFolder` in/out ms by wrapping the two call sites).
One consolidated `[Boot:PERF] …` line after the T+10s summary.

### A.3 Read-only route (in `routes/serviceStatus.ts` — `/api/system` is already exempt from the schema gate)

`GET /api/system/resource-snapshot` → live snapshot + last 120 ticks + boot phase numbers + the
current zombie census. READ-ONLY, writes nothing.

### A.4 Settings → "System Health" card (`frontend/src/pages/Settings/index.tsx`, Data & Backups tab)

- Data via `useApiQuery(['system-resource-snapshot'], api.getResourceSnapshot)` with the hook's
  manual-mode gate (there is a registry entry, `defaultMode: 'manual'`), plus one explicit
  "Refresh now" button. NO polling, NO SSE invalidation loop.
- Shows (real values only): free-RAM bar of 12 GB, backend RAM, chrome.exe count + their RAM split
  OUR/zombie/protected/other, last boot PERF lines, and a "Log folder" link
  (`shell.openPath` via existing IPC surface, or instruct path).
- Semantic tokens only (`bg-bg2/glass-bg`, `text-text/muted`, `border-border`), `dropdown-scroll`
  if any list is scrollable, no new endless animations, no `backdrop-*` (No-GPU contract).

### A.5 Phase A acceptance

- Monitor runs with < 0.2 % avg CPU; jsonl grows ≤ ~5 MB/day.
- The card shows the owner, in plain words, whether memory is healthy.
- 48 hours of ticks exist (Section 13 gives the soak procedure).
- `npm run guardrails` and `tsc --noEmit` clean; scanner ALLOW entries added ONLY with rationale
  comments referencing this section.

---

## 8. Phase B — Kill the "must restart PC" cliff (only after Phase A proves the census)

### B.1 Extend the existing reaper (Ponytail — no new reaper module)

1. `killOrphanChromeProcesses(keyword)` gains an options object: `{ protectedPids?: number[]; dryRun?: boolean }`
   (default call sites stay byte-compatible).
2. New sibling `reapSystemProfileOrphans(): Promise<{ killed: number; freedMB: number }>` in
   `chromeBrowser.ts` that:
   - enumerates ours + `.wwebjs_auth` + `pharmarack_profile_temp_*` matches;
   - EXCLUDES every PID in `activeHeadlessRegistry`, the WhatsApp client's live browser PID getter,
     the Pharmarack browser PID getter, and any process whose parent PID is an active client
     (a Chrome is a tree: parent died, children live — sweep all tree members);
   - SKIPS everything when `whatsappClient` reports an ACTIVE restore/in-progress flow, and skips
     tokens when `isShutdownInProgress()` is true (existing guard);
   - kills survivors with the EXISTING tree-kill (`process.kill` → `taskkill /F /PID` fallback),
     then logs every kill into `action_logs` (`entity='system_resource'`, `entity_id=pid`,
     metadata: profile key, rssKB, CommandLine prefix ≤ 120 chars).
3. Schedules (registered time triggers, per § 7.1(c)):
   - **Boot sweep** at T+90s (strictly AFTER the WhatsApp T+12s + retry window and the first
     heartbeat completes) — catches strays from crashes of the previous session;
   - **Idle-gated sweep** every 30 min (`isIdle(10 min)` first, and only when NO browser is
     mid-restore), so user-visible sessions are never touched mid-use;
   - The 6 existing pre-launch Pharma-rack call sites keep running unchanged (they are lock-clear
     steps; no behavioral change).
4. **WhatsApp sessions are always either protected (client active) or candidates** — owner chose
   never-sleep, so the live WhatsApp client itself is NEVER a reap candidate; only processes whose
   client is demonstrably dead/replaced are.

### B.2 Memory-pressure guard (inside the monitor)

- Condition: `freeMB < 800` for 3 consecutive ticks (≈ 90 s sustained) AND zombie census > 400 MB.
- Response ladder:
  1. reap zombies (B.1) — frees RAM only, in-process, no messages;
  2. broadcast ONE `eventService.broadcast('system_alert', { kind:'memory_pressure', freeMB, reclaimedMB })`
     → Layout consumes it like other toast SSEs → informative toast: keeps full context, no fabricated
     numbers, and the Settings System Health card shows amber (real data);
  3. if STILL < 500 MB after the reap — repeated toast suppressed to 1×/30 min (dedupe, like the
     WhatsApp freshness guard pattern).
- NEVER destroys the active WhatsApp client, NEVER restarts anything automatically, NO WhatsApp/SMS.

### B.3 Serialize boot restores (one Chromium at a time)

- Tiny module-lane `src/utils/heavyRestoreLane.ts` (a Promise FIFO like `backgroundJobLane.ts`
  pattern): `runRestore(tag, fn)`.
- Wrap the WhatsApp boot-restore entry (`server.ts` T+12s block) and
  `tokenRefreshScheduler.executeRefreshInternal()` with it. Each keeps its own internal
  single-flight/mutex (they already exist); the lane only guarantees the two SUBSYSTEMS never
  overlap a Chrome launch + profile copy on this 12 GB box.
- `runRestore` starts work only after the previous finished; queue depth ≤ 1 pending; log waits > 5 s.

### B.4 Priority diet (removes "PC slow right when app opens")

- `electron/main.ts`: backend child keeps ABOVE-NORMAL only through the boot-critical window,
  then at T+90s Electron sets it to `PRIORITY_NORMAL` (and Electron main drops to NORMAL too).
- `chromeBrowser.ts`: at every headless spawn (`launchAppBrowser`, WhatsApp & Pharmarack launches)
  set the spawned Chromium PID to `PRIORITY_BELOW_NORMAL` right after launch. Restore/poll traffic is
  network/I/O-bound; below-normal keeps it from fighting POS saves — this is the fix for symptom 1.
- No boot timing changes (P2-81/P2-88 preserved — T+90s only DOWNGRADES, never UP moves anything).

---

## 9. Phase C — data-driven follow-up (only if Phase A logs prove more)

Triggered AFTER ≥ 3 running days (typically the app stays open for days → creeps without any single
cause). Candidates, likely → less likely, each decided ONLY with the jsonl evidence:
1. Backend RSS creep beyond the 512 MB heap cap (SSE listener / registry leak) — cap & unload.
2. Renderer/keep-alive module-cache creep on multi-day sessions — bounded cache eviction on the
   memory_pressure event (client caches only; no page remount, KeepAliveOutlet stays).
3. Defender exclusion measured not to be enough → revisit scheduled scan exclusions with the owner.

---

## 10. Bookkeeping every implementing agent MUST complete (this is the "process" saved here)

1. `SMALL_BUG_FIX_PLAN.md`: add entry **P2-104** under `### [Fixed]` (or `[Open]` first if shipped in
   two PRs) with the same table format as neighbours: what the user saw / root cause / how it was fixed /
   priority / what not to touch / verified by.
2. `src/AGENTS.md`: new section "System Health Monitor & Chrome Process Budget (added 2026-10-23)" —
   binding: monitor contract (30/60s, never-fullstop, P4-style rationale), reaper rules (our profile
   prefixes ONLY, active-registry exclusion, action_logs), pressure ladder (no auto WhatsApp kill),
   `heavyRestoreLane` rule (one boot restore at a time), priority rules (spawns BELOW_NORMAL,
   T+90s downgrades).
3. `frontend/AGENTS.md`: one entry — System Health card is manual-fetch (registry key
   `system-resource-snapshot`), real values only, semantic tokens.
4. Root `AGENTS.md`: one-line pointer under the Performance Guardrails section naming this plan file.
5. `node scripts/quick-update.mjs` after EVERY file create/edit + once at the end.
6. `npm run guardrails` (with `--self-test` after any scanner ALLOW edit), `npx tsc --noEmit` backend +
   frontend eslint on touched files.

---

## 11. Optional owner-side actions (NOT code; do these only with owner's explicit OK)

- **Windows Defender exclusions** for the app install folder and the app-data folder
  (profile-copy + DB write churn is scanned on every event; this is often the single biggest
  launch-spike contributor). Exact paths will be listed after Phase A measurement, e.g.
  `E:\...\AI PHARMACY v2\` install dir and `%LOCALAPPDATA%\AI Pharmacy OS\data\`.
- Nothing else touches Windows settings from this plan.

---

## 12. Step-by-step implementation checklist (in order)

- [ ] 0. Read the mandatory chain (Section 0) + `AGENT_DATA_FLOW_TREE.md` & `BACKEND SCHEMA SAFETY.md`
       skim only to confirm this fix touches NO schema and NO shop-data flow (it does not —
       no tables, no columns are touched; note that confirmation in the commit message).
- [ ] A.1 Create `src/systemHealthMonitor.ts` (census + tick + jsonl + retention).
- [ ] A.2 Register the monitor in `server.ts` Phase-3 block AFTER `initBackupScheduler` (a
       T+90s `setTimeout`, never earlier).
- [ ] A.3 Add `GET /api/system/resource-snapshot` to `routes/serviceStatus.ts`.
- [ ] A.4 Settings System Health card (manual fetch + Refresh button).
- [ ] A.5 tests/systemHealthMonitor.test.ts (census classification from synthetic command lines,
       pressure 3-tick trigger, rotation, protected-PID exclusion). Use jest + in-memory; **never
       launch a real Chrome in tests** (`tests/bootLazyImports.test.ts`-style env seams).
- [ ] A.6 Verify with `npm run guardrails`, `tsc --noEmit`,eslint, run the app 48 h, check the log
       through the card. (Phase A commit.)
- [ ] B.1 Extend `killOrphanChromeProcesses` options + add `reapSystemProfileOrphans()` + schedules.
- [ ] B.2 Pressure ladder in the monitor (reap → SSE one toast, deduped).
- [ ] B.3 `heavyRestoreLane.ts` + wrap the two boot entries.
- [ ] B.4 Priority: T+90s downgrade + browser spawns BELOW_NORMAL.
- [ ] B.5 tests: reaper classification/decisions, lane serialization, pressure ladder.
- [ ] B.6 Guardrails + tsc + tests + DOX bookkeeping (Section 10). (Phase B commit.)
- [ ] C. Soak 3 running days (Section 13) → decide Phase C or close.
- [ ] Final: update `SMALL_BUG_FIX_PLAN.md` to `[Fixed]`, all Section-10 DOX updates,
       `node scripts/quick-update.mjs`, close with the 8-point audit summary (below).

---

## 13. Verification & acceptance (how the owner knows it worked)

1. **Soak:** run the app on the shop PC for 2-3 full working days (don't close overnight):
   - free-RAM floor never slides under ~1 GB in the jsonl ticks;
   - zombie chrome.exe count returns to 0 within 35 min after any restore storm,
     and total OUR-chrome RAM stays under ~1 GB;
   - zero in-app memory-pressure toasts after day 2 (or only informational).
2. **Launch feel:** 3 consecutive app launches right after PC restart → no desktop-wide sluggishness
   during the first 90 s (priority diet, B.4) — owner confirms by hand.
3. **Regression gates:** guardrails E1 (grep no GPU switches touched); no early-boot changes (timers
   diff proves only T+90s-or-later additions); WhatsApp/Pharmarack still authenticate after 24 h
   (heartbeat rows + stored tokens untouched);
   `node scripts/quick-update.mjs` clean at the end.
4. **Escalation criteria:** if a freeze ever still happens after Phase B, the jsonl immediately names
   the PID + command line + RAM of every chrome.exe alive in the window that tick — the mystery is
   data-answered, not guessed again.

---

## 14. Rollback safety

- Phase A is additive: one monitor module + one read-only route + one card. Delete the 4 pieces to
  revert; nothing else depends on them.
- Phase B pull-pieces: `heavyRestoreLane` wrapper is 2 call-site wraps; `reapSystemProfileOrphans`
  schedules are 3 registered start/stop lines; priority lines are 4 annotated lines. Each is
  independent and revertable without touching the other phases (same per-phase commit pattern as
  the API plan § 9).
- The default `killOrphanChromeProcesses` call sites keep their existing shape (new param optional)
  so old behavior stays available via one argument removal.

---

## 15. What this plan explicitly does NOT touch

- No-GPU Electron switches, splash/window creation, `waitForBackend` (E1 / P2-81).
- Every boot phase timer's START time (P2-81/P2-88 contracts).
- WhatsApp ban-safe automation surface, queue pacing, `whatsapp_idle_sleep_min` default.
- Any SQLite schema, migration, or shop data table (no BACKEND SCHEMA SAFETY report needed beyond the
  "no schema touched" confirmation).
- Any patient/distributor/owner messaging path (Strict Manual-Only Patient Messaging).
- The 291k-rows search / SSE / cache / KeepAlive frontend architecture.

---

## 16. Assumptions & unknowns (to confirm during Phase A, not guessed now)

- Exact WhatsApp-web.js `--user-data-dir` string shape (`.wwebjs_auth\session...`) — Phase A census
  logs it verbatim before any kill gets enabled (the Phase B dry-run week is a hard sequencing step:
  **observe-only jsonl first, then enable kills**).
- Whether Chrome children actually inherit ABOVE-NORMAL on this Windows build (measure priorities in
  the census: add `Priority` to the query projection from tick 1).
- Defender's contribution vs zombie RAM (jsonl will separate the two: CPU-heavy-but-RAM-flat Assassin
  = Defender; RAM-flat-but-lots-of-our-chromes = zombies).

---

## 17. 8-point audit expectation for the implementation PRs (per root AGENTS.md)

1. **Existing dummy/fallback logic found:** none in the touched area (monitor is from-scratch; reaper
   reuses real PIDs).
2. **Removed/changed:** only `killOrphanChromeProcesses` signature gains an optional param (all six
   call sites compile unchanged).
3. **New dummy/fallback logic introduced:** none. All displayed values are live readings.
4. **Missing-data handling:** if the census query fails (wmic deprecated, PowerShell missing), the
   tick logs `census_available:false` and the card states data is unavailable — never a fake bar.
5. **Error/fallback behavior:** reap errors swallow into `action_logs` only; pressure ladder has a
   30-minute dedupe; lane never deadlocks (retries bounded).
6. **Auto-created records/values:** only log rows (jsonl, action_logs). No business rows.
7. **Data source & traceability:** every number is from `os.*` / `process.*` / `Win32_Process` at the
   logged timestamp; kill decisions cite the census row that caused them.
8. **Remaining risks to review:** (a) `.wwebjs_auth` match shape must be proven on the running client
   before kills turn on (the observe-week); (b) Defender exclusion is owner-side; (c) Phase C only
   with 3-day evidence.

---

*End of plan. No code was written and no file other than THIS document was created or modified in
this planning session (knowledge-graph bookkeeping ran as the contract mandates). Implementation
starts only when the owner switches to the build agent and says "implement P2-104 Phase A".*
