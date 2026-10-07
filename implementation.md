# Implementation Plan: Fix False Minimum Order Requirement Warnings in Pharmarack Cart

**Target**: Permanently fix false minimum order requirement warnings (e.g. `Minimum Order amount is set Rs. 100 for SUCCESS SURGICALS LLP store (short by ₹100)`) in the Pharmarack Cart page and backend API so that:
1. Real order amounts (including enriched catalog/history PTR amounts) are evaluated accurately instead of assuming raw `0`.
2. Stores that already satisfy the minimum order requirement (e.g. ₹356.38 ≥ ₹100) never display false shortfall warnings.
3. Completely unpriced inquiry stores (where items have no live PTR or local price, like Pharmarack web portal displays with `PTR: -` and `₹0.00`) never trigger false monetary minimum amount warnings, matching Pharmarack's official website behavior.
4. Official minimum product count requirements (`minItemLimit` / number of distinct items) remain active and enforced for distributors that require them.

---

## 1. Problem Statement & Root Cause

### Symptoms
In the Pharmarack Cart interface, the distributor card for `SUCCESS SURGICALS LLP` displayed:
- Card Header: `₹356.38 • 4/4 to send`
- Red Banner: `Minimum Order amount is set Rs. 100 for the SUCCESS SURGICALS LLP store (short by ₹100)`
- On the official Pharmarack website (`retailers.pharmarack.com/cart`), no minimum amount warning was shown at all.

### Root Cause
1. **Raw `0` evaluation in frontend**:
   - Upstream Pharmarack API returned `store.lineTotal: 0` for `SUCCESS SURGICALS LLP` because this distributor's items had `PTR: 0` on the upstream server.
   - The frontend enriched the items with catalog/historical prices, correctly calculating `checkedTotal = ₹356.38`.
   - However, `getOrderLimitIssues(dist)` in `frontend/src/pages/PharmarackCart/index.tsx` was reading `dist.lineTotal || 0`. In unmapped lists or raw incoming distributors, `dist.lineTotal` remained `0`.
   - Evaluating `0 < 100` resulted in `shortfall = 100 - 0 = ₹100`, triggering the false warning even though the real cart value was ₹356.38 (which satisfies the ₹100 minimum).
2. **Unpriced items discrepancy**:
   - On Pharmarack's official website, when items have no live PTR (`PTR: -` / total ₹0.00), Pharmarack suppresses `MinAmountLimit` checks because unpriced orders are processed as inquiry/unpriced orders.
   - The app was extracting `MinAmountLimit: 100` from the database line item attributes and enforcing it on ₹0 totals without checking if the order is priced.

---

## 2. Proposed Changes

### File 1: `frontend/src/pages/PharmarackCart/index.tsx`
- **Helper `getDistributorEffectiveTotal(dist)`**:
  Calculate effective distributor total as `Math.max(dist.lineTotal || 0, (dist.items || []).reduce((sum, item) => sum + getCartItemAmount(item), 0))`.
- **Update `getOrderLimitIssues(dist)`**:
  - Use `getDistributorEffectiveTotal(dist)` for `total`.
  - Check `const hasPricedItems = (dist.items || []).some(i => (i.ptr || 0) > 0 || (i.amount || 0) > 0)`.
  - Only enforce `minAmt > 0 && hasPricedItems && total < minAmt`.
  - Preserve `minItemLimit` and other item count limits unconditionally.
- **Update `getMinAmountFillers(dist, recent)`**:
  - Use `getDistributorEffectiveTotal(dist)` so filler medicines are not recommended for stores that already satisfy the threshold.
- **Normalize `dist.lineTotal` across all sub-tab filters**:
  - In `unmappedDistributors`, `failedDistributors`, and `distributors`, ensure `lineTotal` reflects the effective item total.

### File 2: `src/routes/pharmarack.ts`
- In `loadLiveCartCore()`:
  - When calculating `lineTotal` for each distributor, calculate the sum of items `rawItemsSum`.
  - Set `lineTotal: Math.max(storeLineTotal, rawItemsSum)` so the backend API never returns a dead `0` when items have positive quantities and PTR/amounts.
  - In `extractStoreOrderLimits(rawItems)`:
    - If `rawItems` has limits, ensure `minAmountLimit` is properly extracted, but if all items are completely unpriced (`PTR: 0` and `ProductWiseAmount: 0`), set `isUnpricedStore: true` so consumers can distinguish unpriced inquiry stores.

### File 3: `scripts/check-cart-minimums.mjs`
- Update analysis script to calculate `Math.max(lineTotal, computedItemsSum)` and reflect the same logic.

---

## 3. Verification Plan
1. **Automated Verification**:
   - Run `npx tsc --noEmit` to ensure zero type errors.
   - Run `npm run guardrails` to verify no performance guardrail violations.
2. **Logic & Data Verification**:
   - Test with live `SUCCESS SURGICALS LLP` cart: verify `getOrderLimitIssues` returns 0 issues because ₹356.38 ≥ ₹100.
   - Test with a mock store below minimum (e.g. ₹50 cart with ₹100 minimum): verify the warning still displays truthfully.
   - Test with an unpriced store (all items PTR 0, amount 0): verify monetary shortfall is ignored matching the website.
3. **Knowledge Graph & Bug Register**:
   - Update `SMALL_BUG_FIX_PLAN.md` with entry.
   - Run `node scripts/quick-update.mjs`.

---

## 4. Tasks & Completed Log

- [x] Task 1: Update `frontend/src/pages/PharmarackCart/index.tsx` to compute effective item totals and suppress false minimum amount warnings.
  - *Completed*: Added `getDistributorEffectiveTotal(dist)`, updated `getOrderLimitIssues` and `getMinAmountFillers` to evaluate `Math.max(dist.lineTotal || 0, computedItemsSum)`, added `hasPricedItems` guard so unpriced inquiry orders never trigger false monetary shortfalls, updated `failedDistributors`, `unmappedDistributors`, and `applyCartDiff` to maintain accurate `lineTotal` values.
- [x] Task 2: Update `src/routes/pharmarack.ts` in `loadLiveCartCore` to compute effective line totals from items.
  - *Completed*: In `loadLiveCartCore`, set `lineTotal: Math.max(rawStoreTotal, rawItemsSum)` so positive item amounts are never masked by upstream `0` store total. Updated `extractStoreOrderLimits` to detect and expose `isUnpricedStore`.
- [x] Task 3: Update `scripts/check-cart-minimums.mjs` to keep verification tooling in sync.
  - *Completed*: Updated check script to compute effective item sums and respect the unpriced order exemption.
- [x] Task 4: Verify with TypeScript compiler, guardrails, and unit/behavior test script.
  - *Completed*: Fixed orphaned `suggestions` reference in `LiveCartAddModal.tsx` via `topSuggestionRef`. Ran `npm run guardrails` (passed clean exit 0); ran `npm run build:client` (built in 46.11s with 0 errors); ran behavioral assertion test suite validating 4 critical scenarios (Success Surgicals with ₹356.38, genuine shortfall, unpriced inquiry store, item count limits).
- [x] Task 5: Update `SMALL_BUG_FIX_PLAN.md` and run `node scripts/quick-update.mjs`.
  - *Completed*: Documented bug P2-84 in `SMALL_BUG_FIX_PLAN.md`. Running knowledge graph auto-update.
