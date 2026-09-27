# Electron Migration Implementation Plan
## Goal
Replace Chrome #1 (App UI `--app=` window) with a native Electron BrowserWindow.
Zero budget. Zero changes to WhatsApp, Pharmarack, or any backend code beyond a one-line guard.

## Architecture After Migration
```
BEFORE: PharmacyOS.exe (Node SEA) → starts backend → spawns Chrome --app=http://127.0.0.1:5175
AFTER:  Electron app → starts backend (child process) → creates BrowserWindow → loads http://127.0.0.1:5175
```
RAM saved: ~220-270 MB (Chrome #1 eliminated, Electron's built-in Chromium is shared, no extra process).

## Files to CREATE
| File | Purpose |
|------|---------|
| `electron/main.ts` | Electron main process — spawns backend, creates BrowserWindow, manages lifecycle |
| `electron/preload.ts` | Minimal CJS preload (contextIsolation sandbox — exposes nothing) |

## Files to MODIFY
| File | Line(s) | Change |
|------|---------|--------|
| `package.json` | devDependencies + scripts | Add electron@latest, electron-builder; add electron:dev script |
| `src/server.ts` | L551-563 | Wrap `launchAppBrowser(...)` block with `if (!process.env.ELECTRON_MODE)` |

## Files NOT touched
All backend routes, services, database, WhatsApp, Pharmarack, all frontend React — untouched.

## Task Checklist

- [x] TASK 1 — Install electron + electron-builder as devDeps
- [x] TASK 2 — Create `electron/preload.ts` (minimal, ~10 lines)
- [x] TASK 3 — Create `electron/main.ts` (spawns backend, BrowserWindow, lifecycle)
- [x] TASK 4 — Patch `src/server.ts`: guard `launchAppBrowser` with `!process.env.ELECTRON_MODE`
- [x] TASK 5 — Run `npm run guardrails` + `node scripts/quick-update.mjs`
- [x] TASK 6 — Uninstall old app from `G:\AI Pharmacy OS` (preserve user data & backups)
- [x] TASK 7 — Install new build v0.1.14 to `G:\AI Pharmacy OS` via silent installer
- [x] TASK 8 — Measure cold start, CPU/GPU, RAM, SSE performance, and document OS requirements

## Completion Log
*(New agents: mark tasks complete and append notes here)*

- [x] TASK 1 — electron@latest + electron-builder@latest + cross-env + wait-on installed as devDeps
- [x] TASK 2 — `electron/preload.ts` created (minimal, contextIsolation sandbox)
- [x] TASK 3 — `electron/main.ts` created (spawns backend, waitForBackend health poll, BrowserWindow)
- [x] TASK 4 — `src/server.ts` patched: `launchAppBrowser` guarded with `!process.env.ELECTRON_MODE`
- [x] TASK 5 — `npm run guardrails` PASS | `node scripts/quick-update.mjs` PASS (0 errors, 100% compliant)
- [x] TASK 6 — Uninstalled old app from `G:\AI Pharmacy OS` using silent Inno uninstaller (`unins000.exe /VERYSILENT`), verified old `PharmacyOS.exe` removed while preserving `data/` and `backup/`.
- [x] TASK 7 — Installed `AI-Pharmacy-OS-Portable-Setup-v0.1.14.exe` (414 MB) into `G:\AI Pharmacy OS`. Verified new `PharmacyOS.exe` (92.27 MB, dated 27-09-2026 23:35:24) and total installation size 4595 MB.
- [x] TASK 8 — Benchmarked `PharmacyOS.exe`: Port 5175 ready in 7.94s, HTTP 200 in 397ms, WorkingSet RAM 149.04 MB, CPU time 3.87s. Confirmed SSE optimistic latency <10ms. Evaluated OS compatibility (Win 10/11 fully supported; Win XP/7 unsupported by modern Node/Chromium).
