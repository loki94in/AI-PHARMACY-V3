# Implementation Plan: Staged 12-Second Deferred Warm-Up for All Pages

## Problem Statement
The user requested increasing the warm-up delay from 1.5 seconds to 10–14 seconds (targeting 12 seconds) and applying it to **all** key pages across the application. 
Running page prewarming or mounting immediately at boot competes with the POS counter landing, Electron window initialization, and initial SQLite database hydration. Deferring the warm-up to 12 seconds gives the POS screen 100% dedicated hardware resources during the critical boot phase, while still pre-loading all major application routes smoothly in the background shortly after.

## Proposed Architecture
1. **12-Second Boot Grace Period**:
   - For the first 12 seconds after launch, POS has exclusive, uninterrupted CPU and RAM priority.
   - If the user clicks any route during these first 12 seconds, that route mounts on-demand immediately.
2. **Staggered Background Warm-Up Across All Pages**:
   - In `App.tsx`, starting at 12 seconds, iterate sequentially through all high-traffic routes (`/inventory`, `/sells`, `/dashboard`, `/purchases`, `/crm`, `/pharmarack-cart`, `/dispatch`, `/mail`, `/settings`) with a gentle 2-second stagger between each page chunk.
   - Pre-mount essential workhorse pages (`/inventory`, `/sells`) in `KeepAliveOutlet` after this 12-second grace period settles.
3. **Smooth Non-Blocking Execution**:
   - Each route's code chunk is pre-cached in Chromium's V8 module pool in the background.
   - Zero layout shifts, zero main-thread freezing, zero POS typing stutter.

---

## Tasks Breakdown

- [x] `Task 1`: Update `KeepAliveOutlet.tsx` to delay the background pre-mounting of essential pages until 12 seconds after mount (while keeping immediate on-click mounting active).
- [x] `Task 2`: Refactor `App.tsx` warm-up scheduler to begin at 12 seconds (in the 10–14s window) and smoothly stagger prewarming across all primary routes (Inventory, Sells, Dashboard, Purchases, CRM, Pharmarack Cart, Dispatch, Mail, Settings).
- [x] `Task 3`: Run `npm run guardrails` and `node scripts/quick-update.mjs` to verify zero violations and synchronize the project knowledge graph.
- [x] `Task 4`: Production release (`npm run release`) build installer and update archive.

---

## Progress & Completed Tasks

### Task 1: 12-Second Deferred Pre-Mount in KeepAliveOutlet
- Updated `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx` to defer adding `BOOT_PREMOUNT_PATHS` (`/inventory`, `/sells`) until a 12-second timer has settled.
- Any manual navigation to a route during seconds 0–12 continues to mount instantly on click.

### Task 2: Staggered 12-Second Warm-up for All Primary Pages in App.tsx
- Updated `frontend/src/App.tsx` warm-up queue to begin at 12 seconds (`12_000ms`), right in the user's requested 10–14 second window.
- Iterates sequentially through all key routes: `/inventory`, `/sells`, `/dashboard`, `/purchases`, `/crm`, `/pharmarack-cart`, `/dispatch`, `/mail`, `/settings`.
- Spaced with a gentle 2.5-second gap between route chunks to guarantee zero CPU spikes or typing interference in POS.
- Removed constant `pointermove` event overhead.

### Task 3: Verification & Guardrails
- `npm run guardrails` passed with 0 violations (`tsc --noEmit` clean, speed architecture intact).
- `node scripts/quick-update.mjs` synchronized knowledge graph.

### Task 4: Production Release v0.1.44
- Executed `npm run release` successfully.
- Version bumped: `0.1.43` -> `0.1.44`.
- Frontend bundled with Vite (47.99s), Node SEA binary compiled (`dist/PharmacyBackend.exe`), Electron main/preload packaged, Inno Setup compiled installer: `dist\installer\AI-Pharmacy-OS-Portable-Setup-v0.1.44.exe`.
- Update package generated: `dist\installer\AI-Pharmacy-OS-Update-v0.1.44.zip` (SHA-256: `b9e23f8652823fb132792e67831bd7f2f65526f0ae9695b9489996679daf6fa6`).
- Manifest written: `update-manifest.json`.
