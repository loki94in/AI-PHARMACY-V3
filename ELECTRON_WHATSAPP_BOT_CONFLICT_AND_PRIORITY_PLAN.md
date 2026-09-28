# Electron WhatsApp Bot Conflict Resolution & High Priority Implementation Plan

## Objective
Fix the WhatsApp Bot failure in the installed Electron desktop app by:
1. Preventing accidental client destruction during Settings save in `src/routes/settings.ts`.
2. Setting `cwd: exeDir` in `electron/main.ts` so paths resolve properly.
3. Granting the installed Electron app top PC priority over background/dev servers, ensuring automatic conflict resolution and exclusive WhatsApp session ownership.
4. Adding an auto-yield guard in development mode when the production Electron app is detected on port 5175.

---

## Tasks Checklist

- [x] **TASK 1 — Fix `src/routes/settings.ts` Client Destruction Bug**
  - Updated `src/routes/settings.ts` so `destroyClient()` is ONLY called if `whatsapp_enabled === 'false'` or `whatsapp_preferred_system === 'disabled'`.
  - Preserved WhatsApp connection when `whatsapp_enabled` is omitted from the settings save payload.

- [x] **TASK 2 — Update `electron/main.ts` with `cwd` & Production Priority Guard**
  - Added `cwd: exeDir` to `spawn()` options so relative media and database paths resolve correctly.
  - Added Windows process priority elevation (`PRIORITY_ABOVE_NORMAL`) to both the Electron main process and the backend child process.
  - Added boot-time session lock cleanup (clearing stale `devtoolsactiveport` and `SingletonLock` files).
  - Added auto-yield HTTP notification to any dev server on port 5174 upon Electron app launch.

- [x] **TASK 3 — Add Production Yield Guard in `src/whatsappClient.ts`**
  - Added `isProductionAppRunning()` helper that probes port 5175.
  - Added yield checks in `isWhatsAppAutoConnectAllowed` and `initClient` in dev mode (`!isPackagedApp()`).
  - Added `POST /api/messaging/yield` endpoint in `src/routes/messaging.ts` so dev server releases WhatsApp instantly when requested by the production Electron app.

- [x] **TASK 4 — Performance Guardrails, Compilation & Knowledge Graph Sync**
  - Ran `npm run guardrails` — PASS (0 violations, clean `tsc --noEmit`).
  - Recompiled `electron/main.ts` into `dist/electron/main.cjs` and `dist/resources/app/main.cjs`.
  - Bundled backend into `dist-pkg/server.cjs` and created `PharmacyBackend.exe` via Node SEA.
  - Created standalone installer: `dist\installer\AI-Pharmacy-OS-Portable-Setup-v0.1.17.exe`.
  - Staged fresh binaries (`PharmacyBackend.exe`, `server.cjs`, and `main.cjs`) directly into `G:\AI Pharmacy OS`.
  - Updated knowledge graph via `node scripts/quick-update.mjs` (1,096 nodes, 543 edges).

---

## Task Progress & Execution Log

- [x] **Task 1 Completed**: `src/routes/settings.ts` patched to prevent accidental `destroyClient()` on saving store settings.
- [x] **Task 2 Completed**: `electron/main.ts` enhanced with `cwd: exeDir`, Windows Above Normal priority class, boot lock cleanup, and yield dispatch to port 5174.
- [x] **Task 3 Completed**: `src/whatsappClient.ts` and `src/routes/messaging.ts` enhanced with production priority shield and `/yield` endpoint.
- [x] **Task 4 Completed**: Full guardrails verified, SEA bundle built, updated binaries staged to `G:\AI Pharmacy OS`, installer compiled, and knowledge graph synced.
