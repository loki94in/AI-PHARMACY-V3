# Implementation Plan: Fast Release Pipeline (`npm run release`)

## Goal
Optimize `npm run release` and `npm run release:pilot` so routine patch releases build and upload **only** the ~38 MB update ZIP (`AI-Pharmacy-OS-Update-vX.Y.Z.zip`) + ~1.7 MB Web Stub (`AI-Pharmacy-OS-WebSetup-vX.Y.Z.exe`) instead of rebuilding and uploading the 639 MB full Inno Setup `.exe` (`AI-Pharmacy-OS-Cloud-Setup-vX.Y.Z.exe`) every time. Full installer builds remain available via `--full` (`npm run release:full` / `npm run release:pilot:full`).

## Changes
1. **`scripts/buildSea.cjs`**
   - Support `SKIP_INSTALLER=1` / `--skip-installer` to skip `ISCC.exe` compilation of `installer.iss` while still stripping `frontend/dist/products` and building `PharmacyBackend.exe`, `PharmacyOS.exe`, and `dist/resources/app`.
2. **`scripts/release.mjs`**
   - Add `--full` (`--with-installer` / `--full-installer` / `FULL_INSTALLER=1`) flag. Default is fast update-only (`SKIP_INSTALLER=1`).
   - In fast mode, skip requiring the 639 MB setup `.exe` in Step 2, and omit the 639 MB setup `.exe` and 120 MB `pharmacy-mobile.apk` from GitHub asset uploads.
   - Parallelize GitHub asset uploads (both single-command `gh release upload` / `gh release create` and `Promise.all` async `curl.exe` / `axios` in the REST fallback).
   - In fast mode, preserve the last published full Setup EXE URL from `${vercelServer}/api/updates?action=check` as `downloadUrl` (falling back to `WebSetup` URL) so `downloadUrl` never points to a 404.
3. **`package.json`**
   - Add `release:full` and `release:pilot:full` scripts for convenience.

## Verification
- Run `node --check scripts/buildSea.cjs` and `node --check scripts/release.mjs`.
- Run `npm run guardrails` (mandatory per `AGENTS.md`).
- Run `node scripts/quick-update.mjs` (mandatory per `AGENTS.md`).

## Tasks
- [x] Update `scripts/buildSea.cjs` to support `SKIP_INSTALLER=1` / `--skip-installer` while still stripping `frontend/dist/products`.
- [x] Update `scripts/release.mjs` for fast update-only default (`SKIP_INSTALLER=1`), `--full` flag, `downloadUrl` preservation, and parallel GitHub uploads (`gh` multi-asset + `Promise.all` REST fallback).
- [x] Update `package.json` with `release:full` and `release:pilot:full`.
- [x] Run syntax checks (`node --check`), `npm run guardrails`, and `node scripts/quick-update.mjs`.
