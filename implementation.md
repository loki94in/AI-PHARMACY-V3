# Implementation Plan: System-Wide Pharmarack Search Parity & Cleanup

## 1. Problem Statement & User Intent
The user asked to check whether CRM and all other search boxes in the app also had search tampering or artificial re-sorting, and to remove any such tampering across the entire app ASAP so that every search box consistently matches the official Pharmarack website.

---

## 2. Investigation & Audit Findings
1. **CRM Page (`SpecialOrdersSection.tsx` & `RefillsSection.tsx`)**:
   - Special orders in CRM use `SpecialOrderAddModal.tsx`.
   - Medicine linking in CRM Refills uses `MedicineLinkModal.tsx`.
   - Both components directly consume `api.searchPharmarack(q)` and render whatever the backend sends.
   - Because we fixed `src/routes/pharmarack.ts` (raw query preservation + 84 mapped store scoping + no prefix hijacking + native rank preservation), **CRM is already benefiting from the clean backend search**.
2. **Quick Order Popup (`QuickOrderModal.tsx` — Alt+Q)**:
   - Found residual frontend re-sorting logic in `QuickOrderModal.tsx` (lines 730–748) that still performed `In Active Live Cart` boosting.
   - This must be cleaned up to match `LiveCartSearchSection.tsx` so Quick Order also preserves Pharmarack's native rank without distortion.
3. **Switch Supplier / Shortage Pickers in `PharmarackCart/index.tsx`**:
   - Uses `api.searchPharmarack(query)` directly, already clean and faithful.

---

## 3. Implementation Steps

### Task 1: Audit & Clean Frontend Sorting in `QuickOrderModal.tsx`
- Remove the `In Active Live Cart` and stock-tier sorting overrides in `QuickOrderModal.tsx`.
- Preserve mapped-first and exact title prefix matching, then preserve Pharmarack's native upstream ranking.

### Task 2: Verification Across All Modals & Guardrails
- Verify TypeScript compilation (`npm run build`).
- Verify frontend client build (`npm run build:client`).
- Run `npm run guardrails` (exit code 0).
- Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.

---

## 4. Completed Tasks Log
- [x] Task 1: Audit & Clean Frontend Sorting in `QuickOrderModal.tsx` & `LiveCartSearchSection.tsx`
  - Removed `In Active Live Cart` and stock-tier sorting overrides.
  - Native Pharmarack ranking preserved 1:1.
- [x] Task 2: Purge Legacy Disk Cache `data/search-cache.json` & In-Memory Prefix Match
  - Wiped 137 KB stale cache containing old truncated/stripped queries.
  - Removed dead `findPrefixMatch` in `searchCache.ts` to prevent prefix hijacking.
  - Integrated `searchCache.clear()` and `search-cache.json` reset into `POST /api/utilities/clear-cache`.
- [x] Task 3: Fix Switch Supplier & Live Cart Search Queries
  - Fixed `LiveCartSearchSection.tsx` to stop stripping parenthetical query tokens.
  - Fixed `PharmarackCart/index.tsx` `handleOpenSwitchModal` & `handleSearchSwitchCatalog` to parse direct array responses from `api.searchPharmarack`.
  - Cleaned up `sanitizePharmarackQuery` in `src/services/intentKeywords.ts` to prevent word truncation, token stripping, or early break limits.
- [x] Task 4: Complete System Verification & Guardrails
  - `npm run build:client`: Passed (0 errors).
  - `npx tsc --noEmit`: Passed (0 errors).
  - `npm run guardrails`: Passed (0 violations, speed architecture intact).
  - `node scripts/quick-update.mjs`: Synchronized knowledge graph (1325 nodes, 847 edges).
