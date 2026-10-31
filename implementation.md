# Implementation Plan — Fix Distributor Filter Dropdown Overlay, Transparency, and Restore Non-Mapped Pharmarack Distributors

## Context & Problem
1. **Overlaying Issue**: The distributor filter dropdown was previously sitting at normal stacking order relative to the sibling autocomplete search container (`LiveCartSearchSection`), causing DOM elements below it to overlap or bleed through the dropdown.
2. **Transparency Issue**: The popover used an invalid Tailwind width (`w-84`) and `bg-bg`, which lacked full solid opacity contrast over the underlying modal cards.
3. **Unable to See Non-Mapped Distributors**: In the previous change, `if (!isMapped) continue;` was added to `getAllConnectedPharmarackStores()`, which inadvertently stripped out all non-mapped distributors returned by Pharmarack's `user/api/v2/store-list`. Users need to be able to see and select both Mapped and Non-Mapped Pharmarack distributors (while still excluding external offline distributors from the local `distributors` table).

## Changes Made
1. **Backend (`src/routes/pharmarack.ts`)**:
   - In `getAllConnectedPharmarackStores()`: Removed `if (!isMapped) continue;` so both mapped and non-mapped Pharmarack distributors from `user/api/v2/store-list` are captured with their authentic `isMapped: checkIsMapped(s)` status.
   - In `/pharmarack/search`: Added auto-detection for `storeId` so that if `isMapped` is unspecified, it checks whether `storeId` is in `mappedStoreIds`, routing correctly to `StoreId` (mapped) or `NonMappedStoreId` (non-mapped) in Pharmarack's OpenSearch API.
2. **Frontend (`frontend/src/components/LiveCartAddModal.tsx`)**:
   - **Fixed Overlaying**: Elevated the filter bar container to `z-[70]` when open, ensuring the popover floats completely above `LiveCartSearchSection` (`z-50`).
   - **Fixed Transparency**: Switched the popover surface to solid `bg-bg2 border border-border shadow-[0_12px_40px_rgba(0,0,0,0.35)] z-[100] w-80 sm:w-96`, ensuring zero transparency bleed-through in both light and dark modes.
   - **Restored Non-Mapped Distributor Visibility**:
     - Added quick sub-tab filters inside the dropdown: **All**, **Mapped**, and **Non-Mapped** with live counts.
     - Added distinct status chips for each distributor row: `In Cart` (emerald), `Mapped` (sky), and `Non-Mapped` (amber).
     - Added a `Non-Mapped` indicator badge on the main filter button when a single non-mapped distributor is active.
3. **Verification**:
   - `npm run guardrails` passed with 0 violations (`tsc --noEmit` OK).
   - `node scripts/quick-update.mjs` synchronized the knowledge graph in 5.4s.

---

## Completed Tasks
- [x] Task 1: Restore non-mapped Pharmarack distributors in `src/routes/pharmarack.ts`
  - **Completed**: Captured both mapped and non-mapped Pharmarack stores from `user/api/v2/store-list` while keeping external offline `distributors` excluded. Added auto-detection of mapped vs non-mapped `storeId` in search payload builder.
- [x] Task 2: Resolve overlaying and transparency issues in `LiveCartAddModal.tsx`
  - **Completed**: Applied `z-[70]` to the dropdown parent when opened and `z-[100]` with solid `bg-bg2` background and shadow on the popover.
- [x] Task 3: Add Mapped / Non-Mapped tab filters and status badges in `LiveCartAddModal.tsx`
  - **Completed**: Added `All`, `Mapped`, and `Non-Mapped` filter tabs with item counts, search filtering within categories, and visual badges.
- [x] Task 4: Guardrail and knowledge graph verification
  - **Completed**: Verified `npm run guardrails` passes with clean TypeScript compilation, and updated knowledge graph.
