# Implementation Plan: Fixed Size Popups & Manual Add Options

## Status: COMPLETED
Created: 2026-09-27
Completed: 2026-09-27

---

## 1. Overview
The user provided feedback on `/purchases` requesting:
1. **Manual Add Option** in `UniversalMedicineEditModal`:
   - Item Type / Dosage Form (`#item_type_55`): Add manual add option alongside the standard dropdown.
   - Form Suffix Type (`#field_56_57`): Add manual add option alongside standard suffix list, compiling into medicine name.
   - Category (`#category_58`): Add manual add option alongside standard category list.
2. **Fixed Modal Size for "Register New Medicine to Master Database"** (and Universal Medicine Editor):
   - Fixed the modal container dimensions to a rock-solid, fixed geometry (`w-[96vw] max-w-5xl h-[88vh] min-h-[600px] max-h-[900px] flex flex-col`) with `flex-1 min-h-0 overflow-y-auto` for the body.
3. **Prevent Other Popups From Changing Size Dynamically**:
   - Standardized modal sizing across other popups in Purchases (`SaveBillSpecialPriceModal`, `PurchaseSaveVerificationModal`) so they do not collapse or jump depending on content length or screen resolution.

---

## 2. Tasks

### Task 1: Complete Manual Add Options in UniversalMedicineEditModal
- [x] Ensure `STANDARD_CATEGORIES` includes common pharmacy categories: Allopathy, Ayurvedic, Homeopathy, General Health, Surgical, Nutraceuticals, Cosmetics, OTC, Veterinary, Baby Care.
- [x] Verify `isCustomItemType`, `isCustomSuffix`, `isCustomCategory` state hooks:
  - Correctly auto-detect non-standard values on mount (`initialData`, `ocrData`, and `masterRecord`).
  - Correctly switch between `<select>` dropdown and `<input type="text">` with unique element IDs (`#item_type_55`, `#field_56_57`, `#category_58`).
  - Provide both `+ Manual Entry` / `← Standard List` toggle button and `➕ Add Custom / Manual...` select option for maximum discoverability.
  - Reactive name re-compilation when custom suffix or base name is changed.
  - Reset to Master DB safely restores both values and custom state flags.

### Task 2: Lock Modal Geometry to Fixed Stable Size (No Jumping / Resizing)
- [x] In `UniversalMedicineEditModal.tsx`:
  - Changed container classes from `max-h-[92vh]` to `w-[96vw] max-w-5xl h-[88vh] min-h-[600px] max-h-[900px] flex flex-col`.
  - Header, live preview banner, tab navigation bar, and footer buttons have `shrink-0`.
  - Body container has `flex-1 min-h-0 overflow-y-auto`.
  - Loading state (`loading ? ...`) is vertically centered inside `flex-1 min-h-0 h-full min-h-[350px]` so the modal maintains its full fixed height even during initial hydration.
- [x] In `SaveBillSpecialPriceModal.tsx`:
  - Changed container classes to `w-[95vw] max-w-4xl h-[85vh] min-h-[540px] max-h-[820px] flex flex-col`.
  - Header, action bar, and footer have `shrink-0`, and table container has `flex-1 min-h-0 overflow-y-auto`.
- [x] In `PurchaseSaveVerificationModal.tsx`:
  - Changed container classes to `w-[95vw] max-w-lg h-[80vh] min-h-[520px] max-h-[720px] flex flex-col`.
  - Header and footer have `shrink-0`, and body has `flex-1 min-h-0 overflow-y-auto`.

### Task 3: Verification & Performance Guardrails
- [x] Run `npx tsc --noEmit` to verify type safety (passed with 0 errors).
- [x] Run `npm run guardrails` to verify no performance or architectural regressions (PASS — 0 violations).
- [x] Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized (completed in 1.7s).
