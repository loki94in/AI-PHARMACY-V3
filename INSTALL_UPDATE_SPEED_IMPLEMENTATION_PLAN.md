# AI Pharmacy OS — Slow Install / Update Fix — Implementation Plan

> **PLAN DOCUMENT ONLY — NO CODE, CONFIG, OR RUNTIME MODULE WAS TOUCHED.**
> This file is a written implementation blueprint. Every edit listed here is to be
> executed **later** by the implementing agent under the mandatory contracts in
> root `AGENTS.md` (guardrails, knowledge-graph update, bug-fix rulebook).

| Field | Value |
|---|---|
| Document type | Implementation plan (documentation only) |
| Created | 2026-10-24 |
| Applies to | `package.json` v0.1.151 line |
| Problem reported by owner | Install / update of the app takes **10–15 min** on the customer PC |
| Target outcome | In-app updates ~1–2 min; fresh install restored to ~4–6 min; existing-install upgrades stop rewriting unchanged files entirely |

---

## 1. Summary of Actions Taken (this planning session)

1. **Measured the real payload** of the shipping installer and update package (evidence in Appendix A — read-only measurements, nothing modified).
2. **Traced both install flows end-to-end**: stub installer → full Setup EXE (`installer.iss`, Inno Setup) and the in-app small-ZIP update flow (`autoUpdateService.ts` → `Updater.bat`).
3. **Mapped the agent roles** across the release / install / update system (Section 5) — Ingestion & Validation, Core Processing Pipeline, Notification Broker — and verified each role's ownership and error behavior from the actual code paths.
4. **Outlined the blueprint structure**: architecture layers, execution phases, error boundaries, and rollback strategies (Sections 6–10).
5. **Zero-touch verified** (Section 2): no existing source file, configuration file, or runtime module was created, edited, deleted, or renamed. The only artifact added by this session is this plan document.

---

## 2. Zero-Touch Verification

| Claim | Detail |
|---|---|
| Source code | Not touched (`src/**`, `electron/**`, `frontend/**` — read-only inspection only) |
| Configuration | Not touched (`installer.iss`, `packaging/*`, `package.json` — read-only inspection only) |
| Runtime modules / scripts | Not touched (`scripts/*`, `stub-installer/*` — read-only inspection only) |
| Database | Not connected, not read, not modified (`app.db` untouched) |
| Files added by this session | `INSTALL_UPDATE_SPEED_IMPLEMENTATION_PLAN.md` (this file — root folder, documentation only) |
| Files renamed / deleted | None |

Contract note: this plan does **not** change any schema, table, endpoint, page ownership, or data-flow rule. `BACKEND SCHEMA SAFETY.md` (Section 24 report) is therefore **N/A** for this work — no database-backed feature is modified. The only post-implementation obligations are the standard `npm run guardrails` + `node scripts/quick-update.mjs` pass and a `SMALL_BUG_FIX_PLAN.md` Section 4 entry once the fix ships.

---

## 3. The Problem — Measured

### 3.1 What the customer PC receives and writes

| Artifact | Size | Files |
|---|---|---|
| `AI-Pharmacy-OS-Portable-Setup-v0.1.151.exe` (full Setup) | **984 MB** | 1 |
| Inno payload written to `%LOCALAPPDATA%\AI Pharmacy OS` | **~2 GB** | **~49,000** |
| `node_modules\*` (with `ignoreversion`) | ~1,434 MB | 49,344 |
| Electron runtime DLLs + locales + paks | ~250–367 MB | 73+ |
| `PharmacyOS.exe` (Electron SEA) | 235 MB | 1 |
| `PharmacyBackend.exe` (server SEA, `nocompression`) | 94 MB | 1 |
| Seeded `app.db` (first install only, `onlyifdoesntexist`) | 400 MB | 1 |
| `medicines.csv` → `reference_medicines.csv` (re-excluded on update) | 115 MB | 1 |
| `frontend\dist` (minified UI; product images excluded) | ~5 MB | 94 |
| `AI-Pharmacy-OS-Update-v0.1.151.zip` (fast in-app path) | **105 MB** | few |

### 3.2 Why it takes 10–15 minutes

| # | Root cause | Where |
|---|---|---|
| RC1 | `SolidCompression=yes` + LZMA2 — the whole payload is ONE compressed stream; Inno decompresses it sequentially, single-threaded; cannot skip parts | `installer.iss` |
| RC2 | `ignoreversion` on `node_modules\*` — every Setup run re-copies ~49,000 files through Inno's temp-copy → backup → replace dance even when ~99% unchanged | `installer.iss` |
| RC3 | Windows Defender real-time scan per written file — 49k tiny JS/JSON files is Defender's worst case (often half the wall-clock on 4-core PCs) | environmental (installed PC) |
| RC4 | Updates executed via the full 984 MB Setup EXE although a working 105 MB ZIP fast path already exists | `autoUpdateService.ts` fallback logic |
| RC5 | Payload bloat — dev-only content (types, maps, docs, duplicate wasm/binaries) ships in `node_modules` | `installer.iss` excludes + build script |

---

## 4. The Fix — Four Moves (priority ordered)

> Every phase independently passes `npm run guardrails` and ends with
> `node scripts/quick-update.mjs`. No business logic, no IPC surface, no schema.

### Phase 1 — Lock updates to the small ZIP path *(removes ~10–13 min from the daily update)*
- **Files:** `src/services/autoUpdateService.ts`, `scripts/build-update-package.mjs`, `packaging/Updater.bat`
- **Edits:**
  1. `autoUpdateService` must **always** prefer the `updatePackageUrl` ZIP; the full Setup EXE becomes the *last-resort* fallback (ZIP missing → checksum fail twice → Setup).
  2. Extend `UPDATE_SOURCES` in `build-update-package.mjs` to start from a diff of changed files vs the previous release's manifest (versioned `update-manifest.json` records per-file list), so backend-only changes don't force a 235 MB EXE carry.
  3. `Updater.bat` gains a copy loop over the manifest's file list (already has staging, hash verify, backup, replace, restart).
- **Acceptance:** update vN→vN+1 on an existing PC downloads ≪ Setup size; `logs/updater.log` shows zero `node_modules` activity.

### Phase 2 — Installer stops rewriting unchanged files *(Setup pass: ~49k files → hundreds)*
- **Files:** `installer.iss`, (`scripts/buildSea.cjs` for stamp injection)
- **Edits:**
  1. Remove `SolidCompression=yes` (per-file compression restores parallelism for 49k small files; keep `lzma2/fast` — never `--max-compression` by default).
  2. Stamp file mechanism: write `{app}\node_modules\.<bom-base-hmac-stamp>` containing a short hash of the node_modules payload. `node_modules\*` becomes conditional (stamp-forcing flag) — existing install with a current stamp skips the entire tree; missing/stale stamp → full (re)install.
  3. Stamp is regenerated automatically whenever the script builds a Setup whose node_modules content hash changed.
- **Acceptance:** run Setup twice on same PC; second run (same base) writes only EXEs/frontend/Electron runtime — verified via Inno log count.

### Phase 3 — Base / App split (optional, after Phase 1–2 ship)
- Base package (node_modules + Electron runtime + DB seed) installed **once**;
  app updates ship only `PharmacyOS.exe` + `frontend\dist` + changed files.
- Reduces the normal update payload to tens of MB regardless of backend changes.

### Phase 4 — Payload prune
- One exclude-pass addition in `installer.iss`: `@types`, `*.map`, doc/test/example dirs, duplicate platform binaries — measured cut ≥ 30% of base payload.

---

## 5. Agent Verification — role map (verified against code, unchanged by plan)

### 5.1 Ingestion & Validation
| Component | Role (verified) | Status |
|---|---|---|
| `stub-installer/main.js` | License ID/key → POST `/api/license/activate` (machine fingerprint MAC+MachineGuid); resilient download — DNS filter for dead IPs, 3 attempts, redirect-following, local installer cache (>200 MB) | Existing, preserved |
| `packaging/Updater.bat` step [2/4] | SHA-256 of downloaded ZIP vs manifest — mismatch → delete ZIP, write failure, relaunch old app | Existing, preserved |
| `scripts/build-update-package.mjs` | Builds `AI-Pharmacy-OS-Update-*.zip` + `update-manifest.json` (sha256) consumed by release + updater | Existing; Phase 1 extends it |
| Rule | Zero manufactured values — all validation is checksum/DB-backed; no invented fallbacks | Contract upheld |

### 5.2 Core Processing Pipeline
| Component | Role (verified) |
|---|---|
| `scripts/buildBundle.cjs` + `buildSea.cjs` | Produce `dist/PharmacyOS.exe`, `PharmacyBackend.exe`, inject `/DMyAppVersion` |
| `installer.iss` (Inno Setup 6) | 9-step unpack: stop processes (≤20×500 ms) → verified pre-upgrade DB backup (abort path on empty/missing backup) → decompress payload → `.env` normalization (`DATA_DIR` stripped, `LICENSE_SERVER_URL` re-pinned) |
| `packaging/Updater.bat` steps 1–9 | lock → wait/kill → SHA verify → backup 3 files → extract → verify EXE → `success.json`/`failure.json` → unlock → relaunch |
| Proposed | stamp-file writer + manifest-diff updater (Phase 1–2) — extends, never replaces, existing steps |

### 5.3 Notification Broker
| Component | Role (verified) |
|---|---|
| Vercel update server (`/api/updates?action=publish|check`) | Version manifest KV; `rolloutMode` PILOT/ALL via `x-admin-secret`; single source of truth |
| `src/services/autoUpdateService.ts` | Periodic check (server manifest, `AI-Pharmacy-OS-AutoUpdater` UA), decides ZIP vs Setup, spawns `Updater.bat` Detached **in a visible console window** (progress IS the notification) |
| Markers | `update.lock` (<30 min active, stale ≤30 min tolerated), `success.json`, `failure.json`, `logs/updater.log`, deduped post-update toasts |
| Retention | `release.mjs` keeps newest 2 setups + 2 update ZIPs, logs each prune |
| User-click boundary | update → restart requires explicit user click (owner's manual-first messaging contract unaffected) |

---

## 6. Error Boundaries (existing + to be preserved)

| Stage | Failure | Boundary |
|---|---|---|
| Download (stub) | HTTP ≠200 / timeout / dead IP | 3 attempts with 1.5 s backoff; DNS bypass of `185.199.109.*`; local-cache fallback |
| License | POST ≥400 / timeout 15 s | activation refuses — install proceeds only with valid key |
| ZIP verify (updater) | SHA mismatch | ZIP deleted, `failure.json`, **old app restarted** — no half-updated state |
| Stale lock | `update.lock` >30 min | removed automatically; younger lock → abort |
| Extraction | `PharmacyOS.exe` missing after extract | `failure.json` → restore office backup copies → relaunch old build |
| DB backup (Setup) | backup file missing/empty | **install aborted before any file is modified** (explicit message) |
| Port conflict | 5175 busy | user prompt (continue/abort) before touching files |
| Phase 1 additions | manifest-diff source file missing | build halts (`STOP BUILD` path already exists in `release.mjs`) |

---

## 7. Rollback Strategies

1. **In-app ZIP update:** `backup\preupdate-<ts>\` holds prior `PharmacyOS.exe`, `sea-entry.cjs`, `Updater.bat`; Upsdater restores them on any failed step, then relaunches the old build (verified present in `Updater.bat`).
2. **Setup upgrade:** `backup\app-preupgrade-<ts>.db` verified non-empty *before* any change; customer data (`data\`, `uploads\`, `backup\`, `.env`, license) strictly preserved — user data never in update artifacts.
3. **Release-level:** every published version remains on GitHub Releases; remote rollback = re-publish previous version manifest (`npm run release -- --skip-build` for the old tag) — pilot-side `--promote` flow already proves the manifest swap works both ways.
4. **Per-phase code rollback:** each phase is one or two files; `git revert` scope is small and independent (guardrails + graph update re-run after revert).

---

## 8. Test & Verification Plan (executed during implementation)

1. `npm run build:exe` → confirm installer size drop (goal ≤ ~700 MB after Phase 4, less after prune).
2. Fresh-install matrix: install → run Setup again **same base** → Inno log shows node_modules skipped (stamp hit) → run Setup whose base changed → node_modules rewritten once.
3. In-app update E2E: publish vN+1 → existing PC checks → ZIP path chosen → update in-field console shows steps 1/4..4/4 → post-update version + `success.json`.
4. Failure drills: corrupt the ZIP (SHA mismatch lane), kill the updater mid-extract (stale-lock + rollback lane), simulate DB-backup abort.
5. After **every** code edit: `npm run guardrails` (exit 0 strict) → `node scripts/quick-update.mjs`.
6. Measured wall-clock before/after table recorded in `SMALL_BUG_FIX_PLAN.md` Section 4 entry when the fix is marked fixed.
7. Update `SMALL_BUG_FIX_PLAN.md` (move this issue Open → Fixed) after implementation, per root contract.

---

## 9. Mandatory Contract Compliance (binding for the implementing agent)

- Read root `AGENTS.md` + `AGENT_BUG_FIX_RULEBOOK.md` + `SMALL_BUG_FIX_PLAN.md` before editing (bug/performance rulebook applies).
- `npm run guardrails` must exit 0 after each changed file; extend `ALLOW` only with written rationale.
- `node scripts/quick-update.mjs` after every add/edit/delete/rename.
- No schema change → `BACKEND SCHEMA SAFETY.md` Section 24 report: **N/A** (state it in the implementation summary anyway).
- No new patient messaging, no simulation/mock surfaces, no invented values — Phase edits touch packaging/updater only.
- No `refetchInterval`/`setInterval` additions; `autoUpdateService` keeps server-manifest mediation (no client timer to Vercel beyond existing).
- Seed the 8-point Audit Summary in the final implementation report (dummy/fallback checks: none introduced; data sources: installer artifacts only).

---

## 10. Impact Forecast

| Path | Today | After Phase 1 | After Phase 1+2 | + Phase 4 |
|---|---|---|---|---|
| In-app update (normal) | — | **1–2 min** | 1–2 min | <1 min |
| Update executed via full Setup (still possible) | 10–15 min | unchanged* | **~4–6 min** first time, ~1 min on stamp hit | ~3 min |
| Fresh install | 10–15 min | 10–15 min | **~5–7 min** | **~4–6 min** |
| Reinstall over existing (stamp hit) | 10–15 min | — | **~1–2 min** | ~1 min |

\* Phase 1 removes the need; the Setup path itself improves in Phase 2.

---

## Appendix A — Read-only evidence (2026-10-24)

```
dist\installer\AI-Pharmacy-OS-Portable-Setup-v0.1.151.exe   984 MB
dist\installer\AI-Pharmacy-OS-Update-v0.1.151.zip           105 MB
node_modules                       1,434 MB   49,344 files
node_modules\electron\dist           367 MB       73 files
frontend\dist (products excluded)     ~5 MB       94 files
dist\PharmacyOS.exe                  235 MB
dist\PharmacyBackend.exe              94 MB
data\app.db                          400 MB
medicines.csv                        115 MB
eng.traineddata                        5 MB
dist-pkg                              10 MB
```

## Appendix B — Exact edit targets (quoted, for the implementing agent)

`installer.iss`:

```ini
Compression={#Compression}      ; keep lzma2/fast default
SolidCompression=yes            ; Phase 2: REMOVE (per-file compression)
Source: "node_modules\*"; ... Flags: ignoreversion recursesubdirs ...
                                ; RC2 — Phase 2: gate behind stamp
```

`scripts/build-update-package.mjs`:

```js
const UPDATE_SOURCES = [
  { src: path.join(distDir, 'PharmacyOS.exe'), zipEntry: 'PharmacyOS.exe' },
  ...
];
// Phase 1: add manifest-diff of backend files vs previous release manifest
```

`src/services/autoUpdateService.ts`:

```
// Phase 1: choose updatePackageUrl ZIP first; Setup EXE only as final fallback
```

---

*End of plan — nothing here is executed yet. Implementing agent must switch tasks and follow Section 9 order.*
