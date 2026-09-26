# POS Backward Navigation Fix Implementation Plan

**Tracking File:** `POS_BACKWARD_NAVIGATION_FIX_IMPLEMENTATION_PLAN.md`  
**Status:** Completed ✅  
**Objective:** Fix keyboard field backward navigation (`Shift + Tab` and `ArrowLeft` column navigation) in the POS billing table and enable seamless manual browser & in-app backward navigation (`window.history.back()`, Topbar navigation buttons, and "Cancel Edit & Return to Sells").

---

## Identified Issues & Root Causes

1. **Table Input Backward Navigation Bug:**
   - In `frontend/src/pages/POS/index.tsx`, when on `row-qty-input-${curIdx}` and pressing `Shift + Tab`:
     - If `curIdx === 0`, it jumped out of the table into `doctor-name-input`, skipping `cart-medicine-input-0`.
     - If `curIdx > 0`, it jumped to `row-qty-input-${curIdx - 1}`, completely skipping the current row's own `cart-medicine-input-${curIdx}`.
   - In `cart-medicine-input-${idx}`, pressing `Shift + Tab` jumped straight to `row-qty-input-${idx - 1}`, skipping previous row's discount/MRP.
   - No horizontal arrow key navigation across table cells.

2. **Browser & App Backward Navigation Limitation:**
   - App redirect (`/` -> `/pos` with `replace: true`) leaves history length at 1 on initial load, causing browser back button to be disabled.
   - Fullscreen / PWA / POS counter mode lacks physical/browser chrome back buttons.
   - In "Editing Bill #..." mode, "Cancel Edit" cleared the form but left user stranded in POS instead of navigating back to `/sells`.

---

## Tasks Checklist

- [x] **Task 1**: Fix POS Cart Table `Shift + Tab` & Horizontal Arrow Navigation in `frontend/src/pages/POS/index.tsx`
  - [x] Connect `row-qty-input` backward tab to `cart-medicine-input-${curIdx}`.
  - [x] Connect `cart-medicine-input-${idx}` backward tab to previous row's tail field (`row-disc-input` / `row-mrp-input`).
  - [x] Add horizontal `ArrowLeft` / `ArrowRight` stepping between row columns when caret is at boundary in `handlePosRowInputKeyDown`.
  - [x] Hook `ArrowLeft` / `ArrowRight` keydowns in `row-qty-input`, `row-loose-input`, `row-disc-input`, and `row-mrp-input`.
- [x] **Task 2**: Add Cancel & Return Navigation to Sells Page in `frontend/src/pages/POS/index.tsx`
  - [x] Enhance "Editing Bill" banner with "Cancel & Return to Sells" navigating back to `/sells` with `ArrowLeft` icon.
- [x] **Task 3**: Add Navigation Controls to Topbar in `frontend/src/components/Layout.tsx`
  - [x] Add compact, sleek Back and Forward buttons with tooltips in Topbar header.
  - [x] Connect to `navigate(-1)` and `navigate(1)` with safe fallback to `/dashboard`.
  - [x] Styled with 100% semantic tokens (`bg-bg2/80`, `border-border/70`, `text-muted`, `hover:text-text`, `hover:bg-bg3`).
- [x] **Task 4**: Verify TypeScript Compilation & Run Guardrails
  - [x] Built frontend bundle with `tsc -b && vite build` (Exit code 0).
  - [x] Ran `npm run guardrails` (PASS — no guardrail violations).
  - [x] Ran `node scripts/quick-update.mjs` (Knowledge graph synchronized).

---

## Task Progress Log
- **Task 1 completed**: `Shift + Tab` now steps backward sequentially: `row-mrp` -> `row-disc` -> `row-loose` -> `row-qty` -> `cart-medicine-input` -> previous row's last field. Boundary `ArrowLeft` and `ArrowRight` smoothly move between columns.
- **Task 2 completed**: "Cancel Edit" in the bill editing banner now returns to `/sells` with confirmation toast.
- **Task 3 completed**: Topbar now includes Back and Forward buttons for touch/kiosk/fullscreen app navigation.
- **Task 4 completed**: All TypeScript builds, guardrails, and knowledge graph updates passed with zero errors.
