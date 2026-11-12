# Reorder Hub — Last Purchased Priority Naming

## Goal
Ensure Reorder Hub's **Past Purchase Bills** list always prioritizes the most recently purchased medicine name (`last_date DESC` / `lastOrderedDate DESC`, with `bill_count` as tie-breaker) rather than sorting by historical bill count first. When a distributor renames a product (e.g., `PLIX ROSEMARY HAIR SPRAY 100ML` → `PLIX ROSEMARY HAIR GROW SPRAY 100L`), the latest purchased name appears first so the pharmacist can add it directly to the live cart.

## Changes
1. **Backend (`src/routes/pharmarack.ts` — `GET /api/pharmarack/purchase-reorder-history`)**:
   - Updated `rank_in_dist` window partition ordering from `COUNT(DISTINCT p.id) DESC, MAX(p.date) DESC` to `MAX(p.date) DESC, COUNT(DISTINCT p.id) DESC`.
   - Updated outer `ORDER BY` from `a.bill_count DESC, a.last_date DESC` to `a.last_date DESC, a.bill_count DESC`.
2. **Frontend (`frontend/src/pages/PharmarackCart/index.tsx` — `filteredPurchaseHistoryItems`)**:
   - Added explicit sort by `lastOrderedDate` descending, falling back to `billCount` descending.

## Completed Tasks
- [x] Updated SQL ordering in `src/routes/pharmarack.ts` (`/purchase-reorder-history`) to prioritize `last_date DESC`.
- [x] Updated `filteredPurchaseHistoryItems` memo in `frontend/src/pages/PharmarackCart/index.tsx` to sort by `lastOrderedDate` descending.
- [x] Verified with `npm run guardrails` and `node scripts/quick-update.mjs`.
