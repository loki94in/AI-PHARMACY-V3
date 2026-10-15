# Release Build Speed — Implementation Plan (PLAN ONLY, NOT IMPLEMENTED)

- Status: PROPOSAL — nothing below has been coded. No repo file besides this doc is touched by this change.
- Date: 2026-10-15. Owner decision required before any phase starts.
- Goal: cut `npm run release` local build from 15–20 min to ~3–6 min on the same PC, without changing what ships or how PCs update.
- Non-goals: no change to app behavior, no change to update protocol, no GPU usage, no data-loss risk.

## 1. Measured evidence (this PC, 2026-10-15)

| Payload | Size | Files | Notes |
|---|---|---|---|
| `node_modules` (shipped whole into installer) | ~1,434 MB | ~49,339 | `installer.iss:110` — single biggest input |
| `data/app.db` (pre-seeded master DB) | ~400 MB | 1 | `installer.iss:119`, `nocompression` but still copied/hashed |
| `medicines.csv` | ~115 MB | 1 | `installer.iss:122`, `nocompression` |
| `frontend/dist` (built SPA) | ~4.4 MB | 91 | tiny — NOT the problem |
| `dist-pkg` (esbuild server bundle) | ~9.4 MB | 2 | tiny — NOT the problem |
| `dist/installer` right now | ~2,529 MB | 5 files | old versioned `Setup-v*.exe` + `Update-*.zip` accumulate, never cleaned |

Conclusion: ~95% of ISCC + AdmZip time is spent on `node_modules` + `app.db` + `medicines.csv` + the two ~80–150 MB EXEs, all under the slowest compressor.

## 2. OLD workflow (current, as-shipped)

Entry: `package.json:48` `"release": "node scripts/release.mjs"`.

1. `scripts/release.mjs:128-142` — auto-bumps patch version in `package.json`, writes file.
2. `scripts/release.mjs:158-159` — runs `npm run build:exe:nobump` (always full; only `--skip-build` avoids it):
   - `package.json:43` `build:all:clean`:
     - `package.json:41` `build:client:clean` — `rm -rf frontend/dist`, then `frontend/package.json:8` `tsc -b && vite build`. Full frontend typecheck + full Vite bundle from zero. `frontend/vite.config.ts:84-131` has `manualChunks` (good) but no build cache benefit because `dist` was just deleted and `tsc -b` re-checks everything.
     - `package.json:39` `tsc -p tsconfig.json` — full backend typecheck + emit to `dist/`. Note `tsconfig.json:15-16` already sets `incremental:true` with `dist/.tsbuildinfo`, but `build:all:clean` does not clean `dist/`, so this step IS incremental — the frontend step is the wasteful one.
   - `package.json:44` `build:bundle` → `scripts/buildBundle.cjs:29-42` — one `esbuild.buildSync` of `src/bootstrap.ts` → `dist-pkg/server.cjs` (`packages:'external'`, fast, seconds).
   - `package.json:46-47` → `scripts/buildSea.cjs`:
     - Step 1 (`buildSea.cjs:27-30`): `node --experimental-sea-config sea-config.json` → `dist-pkg/sea-prep.blob`.
     - Step 2 (`buildSea.cjs:32-34`): copy `node.exe` → `dist/PharmacyBackend.exe` (~80–100 MB copy).
     - Step 3 (`buildSea.cjs:39-41`): `npx --yes postject …` injects blob. `npx --yes` re-resolves/downloads instead of using the local install — network + AV scan on a 100 MB EXE.
     - Step 4 (`buildSea.cjs:47-54`): TWO `npx esbuild … electron/main.ts / preload.ts` calls (again via `npx`, not local `node_modules/.bin`).
     - Step 5 (`buildSea.cjs:57-76`): copy `electron.exe` → `dist/PharmacyOS.exe`, `rcedit.exe` branding.
     - Step 6 (`buildSea.cjs:126-131`): `ISCC.exe /DMyAppVersion=… installer.iss` — Inno Setup reads ~49k `node_modules` files + 400 MB db + 115 MB csv + both EXEs + Electron runtime and compresses with `Compression=lzma2/max` + `SolidCompression=yes` (`installer.iss:55-56`). This single step is the 10–15 min wall. `lzma2/max` solid is the slowest setting Inno offers.
3. `scripts/release.mjs:184` → `scripts/build-update-package.mjs:67-95` — `AdmZip` (single-threaded pure-JS) re-adds `PharmacyOS.exe` + every `frontend/dist` file one by one (`addLocalFile` in a loop), `writeZip`, then streams SHA-256. Slow on the 80–150 MB EXE; second full pass over bytes ISCC just processed.
4. Local exit (`release.mjs:203-215`) OR remote publish: `gh release upload` of both artifacts + `POST /api/updates?action=publish` + verify (`release.mjs:218-300`).

Why even a 1-line change costs 15–20 min: every stage is unconditional and uncached (`:clean` + `lzma2/max` + `npx` + `AdmZip`), and `--skip-build` / `--promote` (the escape hatches, `release.mjs:49-119`) are not used in the normal path.

## 3. NEW workflow (proposed — no behavior change)

Same entry points, same artifacts, same version/sha/manifest contract. Only HOW each stage runs changes:

```
npm run release
 ├─ 0. preflight: guardrails (unchanged, per .agents/rules/automated-release.md)
 ├─ 1. version bump (unchanged)
 ├─ 2. build (SMART, was BLIND-FULL):
 │    ├─ frontend: incremental — reuse .tsbuildinfo + Vite cache; :clean only with --clean
 │    ├─ backend:  incremental tsc (already incremental; keep)
 │    ├─ bundle:   esbuild via local bin (was npx), unchanged output
 │    └─ sea:      postject + esbuild via local bin; skip EXE copy if blob+node unchanged
 ├─ 3. installer (TIERED COMPRESSION, was always lzma2/max):
 │    ├─ dev/pilot default: lzma2/fast, node_modules excluded dev junk (maps, tests, .bin)
 │    └─ production final:  lzma2/max (only when user asks for smallest file)
 ├─ 4. update-zip (FAST ZIP, was AdmZip):
 │    └─ archiver/stream or 7zip -mx=1 for the EXE; sha-256 streamed during write
 ├─ 5. housekeeping (NEW): keep last N installers in dist/installer, prune older
 └─ 6. publish/verify (unchanged)
```

`--skip-build` and `--promote` keep working exactly as today and become the documented fast paths (re-publish / pilot→ALL with zero rebuild).

## 4. Work items (phased, smallest-first)

### P0 — zero-risk, no output change (~30–60% expected saving)

- P0-1. Use local binaries in `scripts/buildSea.cjs:38-54`: replace `npx --yes postject` → `node_modules/.bin/postject` (fallback: `npx --no-install`), and both `npx esbuild` → local `esbuild` Node API or `node_modules/.bin/esbuild`. Kills per-release network resolve.
- P0-2. Prune `dist/installer` retention in `scripts/release.mjs` (after Step 3): keep newest 2 `Setup-*.exe` + newest 2 `Update-*.zip` + `update-manifest.json`, delete older. Today 5 files / 2.5 GB sit there; every future build also pays AV/disk costs for a full disk.
- P0-3. Document fast paths where the user already looks: `release.mjs:211-212` hint + `.agents/rules/automated-release.md` — add `--skip-build` (re-publish same bits) and `--promote` (pilot→ALL, no rebuild) examples. Docs only.
- P0-4. Time-stamp each stage: wrap the 6 `release.mjs` steps with `console.time/console.timeEnd` (or `performance.now`) so the next slow build prints exactly which stage ate the minutes. Needed to verify every later phase.

### P1 — build caching + compression tiers (~another 30–50% expected)

- P1-1. Stop unconditional frontend clean: split scripts — `build:all` (incremental, default) vs `build:all:clean` (only for ` --clean` or CI). Frontend `tsconfig.app.json:3` already writes `tsBuildInfoFile` to `node_modules/.tmp/` so `tsc -b` can be incremental IF `frontend/dist` isn't wiped AND `tsconfig.node.json`/`tsconfig.json` refs stay intact. Verify `frontend/tsconfig.json` references are project-references (`tsc -b` semantics) before relying on it.
- P1-2. Tiered Inno compression in `installer.iss:55-56`: read an env set by `buildSea.cjs` (e.g. `ISCC_COMPRESSION`, default `lzma2/fast`) instead of hard-coded `lzma2/max`; `release.mjs` passes `--max-compression` through only for the final production build. `SolidCompression` stays `yes` (smaller file) under both tiers.
- P1-3. Exclude build-dev junk from the shipped `node_modules` payload (`installer.iss:109-110` area): add `Excludes:` for `*.map,*.ts,*.md,LICENSE*,test,tests,__tests__,example,examples,.bin` and per-package heavy folders that are never `require()`d at runtime (concrete list to be confirmed by a runtime `require` scan in P2-1; initial candidates from size: `electron/dist` handled separately, `@playwright`, `jest`, `typescript`, `tsx`, `esbuild` platform binaries not matching win32-x64). Every 100 MB excluded saves ~1–2 min under `max`, ~30–60 s under `fast`.
- P1-4. Faster update-zip: replace `AdmZip` loop in `scripts/build-update-package.mjs:67-95` with a streaming writer (`archiver` package, already-adjacent ecosystem) or shell to `7z a -mx=1` when available, with `AdmZip` kept as fallback. Compute SHA-256 in the same stream pass (`build-update-package.mjs:116-124` already streams — fuse hash-while-writing instead of hash-after-write).

### P2 — structural (only if P0+P1 insufficient; needs care)

- P2-1. Runtime `require()` scan → minimal `node_modules` allowlist for the installer (SEA backend uses `packages:'external'` + `createRequire` from `sea-entry.cjs`, so the full tree ships today "to be safe"). Generate the used-package list from `dist-pkg/server.cjs` + `dist/electron/*.cjs` imports and ship only those. Biggest possible win (could halve payload) but MUST be validated by installing the produced setup on a clean VM and booting + selling + purchasing before calling it done.
- P2-2. Move the 400 MB `data/app.db` + 115 MB `medicines.csv` out of the per-version full installer: ship a version-independent `reference-data` package downloaded once and cached by version-hash, OR mark them `nocompression` + `external` Inno disks. Changes first-install UX — owner decision required, do NOT start without explicit approval.
- P2-3. Parallelize independent stages: frontend build + backend `tsc` are independent — run concurrently (as `dev` already does with `concurrently`). Small win, some log interleaving.

## 5. File-by-file change map (for the implementing agent)

| File | Change | Phase |
|---|---|---|
| `scripts/buildSea.cjs:38-54` | local `postject`/`esbuild`, `ISCC_COMPRESSION` env passthrough | P0-1, P1-2 |
| `scripts/release.mjs:156-162, 203-215` | stage timers, `--clean`/`--max-compression` flags, installer retention prune | P0-2, P0-4, P1-1, P1-2 |
| `installer.iss:55-56, 109-110` | env-driven `Compression`, `Excludes:` for dev junk | P1-2, P1-3 |
| `scripts/build-update-package.mjs:67-124` | streaming zip + fused sha-256 | P1-4 |
| `package.json:41-47` | split `build:all` (incremental default) vs `:clean` variants | P1-1 |
| `.agents/rules/automated-release.md:15-28` | document `--skip-build` / `--promote` / `--clean` / `--max-compression` | P0-3 |
| `frontend/tsconfig.json`, `tsconfig.node.json` | verify project-references for `tsc -b` incremental (read-only check first) | P1-1 pre-req |

## 6. Acceptance criteria

- Same `npm run release` invocation produces: versioned `AI-Pharmacy-OS-Portable-Setup-vX.Y.Z.exe`, `AI-Pharmacy-OS-Update-vX.Y.Z.zip`, `update-manifest.json` with matching `sha256`.
- Clean-VM install test: install → launch → POS sale → purchase save → auto-update check detects version. (P2-1/P2-2 only.)
- Wall-clock on THIS PC, same repo state: full local release ≤ 6 min (P0+P1 target 3–6 min); each stage prints its own time (P0-4) so regressions are visible.
- `npm run guardrails` passes; `node scripts/quick-update.mjs` run after every file change.
- Contracts that MUST NOT break: `package.json` single version source (`installer.iss:27-31`, `buildSea.cjs:19`); no-GPU Electron flags (`electron/main.ts`); portable per-user install + customer data preservation (`installer.iss:190-196`, `PrepareToInstall` backup); update-manifest/sha contract (`release.mjs:180-200`); `lzma2/max` final-production option retained.

## 7. Risks

- Excluding too much from `node_modules` breaks the installed app (native addons `better-sqlite3`, `canvas`, `onnxruntime-node` MUST always ship with correct win32-x64 binaries). Mitigation: P1-3 allowlist is conservative; P2-1 requires clean-VM boot + sale + purchase test.
- Incremental builds shipping stale code. Mitigation: `--clean` escape hatch + CI always builds clean; version string is injected at build time (`buildBundle.cjs:39`, `buildSea.cjs:127-130`) so a stale `dist` can't silently ship the old version number (release.mjs Step 2 already aborts on version mismatch).
- Faster compression = bigger installer upload. `fast` vs `max` delta to be recorded in P1-2 results; owner picks the default.

## 8. Suggested execution order

1. P0-1 + P0-4 (timers prove the rest). 2. P0-2 + P0-3. 3. Measure. 4. P1-1 + P1-2. 5. Measure. 6. P1-3 + P1-4. 7. Measure against §6. 8. Decide on P2 with owner.
