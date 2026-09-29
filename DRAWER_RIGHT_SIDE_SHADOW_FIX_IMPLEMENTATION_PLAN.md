# Implementation Plan: Eliminate Right-Side Blurry Shadow Bleed Over Quick Assist

## Problem Description
A dark, blurry black shadow artifact was visible along the right edge of the screen directly over the Quick Assist area.
This artifact was caused by three sliding side drawers portaled directly to `document.body` (`Sells`, `Purchases`, and `Inventory`). When closed, these drawers applied `translate-x-full` but retained negative-X box shadows (`shadow-[-8px_0_30px_rgba(0,0,0,0.5)]` and `shadow-[-12px_0_48px_rgba(0,0,0,0.4)]`). Because CSS box-shadows project outside element boundaries, 38px to 60px of black blur projected into the viewport, directly rendering over Quick Assist due to high drawer z-index (`z-drawer` / 9000).

---

## Tasks & Status

- [x] **Task 1: Fix Sells sliding drawer shadow & pointer events**
  - File: `frontend/src/pages/Sells/index.tsx`
  - Action: Updated line 1459 so `shadow-[-8px_0_30px_rgba(0,0,0,0.5)]` and `pointer-events-auto` apply only when `panelOpen` is true; when false, apply `shadow-none pointer-events-none`.
  - Status: Completed & Verified

- [x] **Task 2: Fix Purchases sliding drawer shadow & pointer events**
  - File: `frontend/src/pages/Purchases/index.tsx`
  - Action: Updated line 4579 so `shadow-[-8px_0_30px_rgba(0,0,0,0.5)]` and `pointer-events-auto` apply only when `panelOpen` is true; when false, apply `shadow-none pointer-events-none`.
  - Status: Completed & Verified

- [x] **Task 3: Fix Inventory sliding drawer shadow & pointer events**
  - File: `frontend/src/pages/Inventory/index.tsx`
  - Action: Updated line 970 so `shadow-[-12px_0_48px_rgba(0,0,0,0.4)]` and `pointer-events-auto` apply only when `panelOpen` is true; when false, apply `shadow-none pointer-events-none`.
  - Status: Completed & Verified

- [x] **Task 4: Run Guardrails & Update Knowledge Graph**
  - Action: Ran `npm run guardrails` (TypeScript `tsc --noEmit` + architectural rules: PASS) and `node scripts/quick-update.mjs` (Graph updated in 3.6s).
  - Status: Completed & Verified

- [x] **Task 5: Final Verification & Hand-off**
  - Action: Verified all drawer components cleanly toggle their shadows and transitions without leaking into the viewport.
  - Status: Completed
