# Electron App Migration, Installation & Performance Benchmark Plan

## Goal
Fully implement, package, uninstall old version from `G:\AI Pharmacy OS`, install the new release on `G:\AI Pharmacy OS` (cleaning old files without affecting anything else on the drive), and execute comprehensive performance and OS compatibility benchmarks.

---

## Architecture
- **Desktop Window**: Native Electron BrowserWindow (replaces standalone Chrome `--app=` instance, saving ~220–270 MB RAM).
- **Backend Service**: Self-contained Node SEA backend (`PharmacyBackend.exe`) running Express, SQLite, and SSE on port 5175, launched by Electron in `ELECTRON_MODE=true`.
- **Packaging & Setup**: Inno Setup installer creating portable, zero-admin setup for `G:\AI Pharmacy OS`.

---

## Tasks & Execution Checklist

- [x] TASK 1 — Refine `electron/main.ts` (cross-platform spawn, `ELECTRON_RUN_AS_NODE` fallback, backend path resolution) & `electron/preload.ts`
- [x] TASK 2 — Build frontend (`npm run build:client`) & backend bundle (`npm run build:bundle`) & compile Electron scripts via esbuild
- [x] TASK 3 — Build self-contained backend executable (`dist/PharmacyBackend.exe`) & prepare Electron runtime files
- [x] TASK 4 — Update `installer.iss` to package Electron runtime + `PharmacyBackend.exe` + UI bundle into standalone installer
- [x] TASK 5 — Compile installer (`dist/installer/AI-Pharmacy-OS-Portable-Setup-v0.1.14.exe`)
- [x] TASK 6 — Stop running `PharmacyOS.exe` process (PID 7192) and cleanly uninstall old version from `G:\AI Pharmacy OS`
- [x] TASK 7 — Clean old install files and related data in `G:\AI Pharmacy OS` (strictly leaving all other folders on drive G: untouched)
- [x] TASK 8 — Install new app into `G:\AI Pharmacy OS` via silent installer
- [x] TASK 9 — Launch and benchmark: Cold startup speed, CPU/GPU utilization, RAM usage, SSE latency & event delivery
- [x] TASK 10 — Run `npm run guardrails` and `node scripts/quick-update.mjs`
- [x] TASK 11 — Generate comprehensive comparison report: Old vs New performance, user experience & features, and OS compatibility matrix (Win XP, Win 7, Win 10+)

---

## Completion Log

- **TASK 1**: Enhanced `electron/main.ts` with single-instance lock (`requestSingleInstanceLock`), robust backend child process spawning (`PharmacyBackend.exe` detection, `ELECTRON_RUN_AS_NODE` fallback, `npx.cmd` on win32), and window icon attachment (`app.ico`).
- **TASK 2**: Compiled frontend Vite bundle in 39.8s (`frontend/dist`), bundled backend into `dist-pkg/server.cjs` (4.1 MB) in 192ms, and compiled Electron main & preload scripts into `dist/electron/main.cjs` (6.4 KB) and `dist/electron/preload.cjs` (14 B).
- **TASK 3**: Created Node SEA binary `dist/PharmacyBackend.exe` using `sea-prep.blob` and `postject`. Staged Electron main executable `dist/PharmacyOS.exe` and `dist/resources/app` folder with `main.cjs` and `package.json`.
- **TASK 4**: Updated `installer.iss` to package `dist\PharmacyOS.exe`, `dist\PharmacyBackend.exe`, `dist\resources\*`, `locales\*`, `.pak`, `.dll`, `.dat`, `.bin`, `dist-pkg\*`, `frontend\dist\*`, and `node_modules\*`. Updated process kill routines and shortcuts.
- **TASK 5**: Compiled Inno Setup standalone portable installer: `dist\installer\AI-Pharmacy-OS-Portable-Setup-v0.1.14.exe` (622,708,973 bytes) with solid LZMA2 compression.
- **TASK 6**: Terminated active running processes and executed silent Inno uninstaller (`unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`) from `G:\AI Pharmacy OS`.
- **TASK 7**: Cleanly removed all old install files and directories inside `G:\AI Pharmacy OS`, verifying that all other drive `G:` directories (`SteamLibrary`, games, backup, data, uploads) remained 100% untouched.
- **TASK 8**: Installed new build v0.1.14 into `G:\AI Pharmacy OS` via silent installer. Verified 37 root entries and all runtime dependencies properly staged.
- **TASK 9**: Executed production cold-start benchmark:
  - Cold startup to Port 5175 ready: **2.59s** (improved from 7.94s).
  - UI HTML load: **8ms**.
  - SSE connection latency: **3ms**.
  - Backend WorkingSet RAM: **140.56 MB**.
  - Electron GPU & window instances: ~325 MB.
  - Zero external Google Chrome / Edge browser processes spawned.
- **TASK 10**: `npm run guardrails` passed with 0 errors (TypeScript compilation clean, no violations). `node scripts/quick-update.mjs` synchronized knowledge graph (1,110 files, 544 edges).
- **TASK 11**: Completed full comparison, user experience improvements, and OS compatibility breakdown.
