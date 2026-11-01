# Implementation Plan: Pure Medicine Name & Saved Quantity Reordering (Remove Rate/PTR/MRP Matching)

## Problem Statement
In pharma distribution, PTR (purchase rate) and MRP are highly volatile and change frequently across batches, tax revisions, and distributor discount structures.
Previously, order matching (`orderFuzzyMatcher.ts`, `orderNameMatcher.ts`) and reorder paths evaluated PTR/MRP proximity as part of their matching criteria (allocating up to 20 points in matching score to PTR and MRP). When market rates fluctuated even slightly, match scores dropped below threshold (75), causing reorders and refill additions to fail or report mismatches.
Additionally, when a medicine is already linked to a distributor in the app, reordering should not perform unnecessary rate/MRP checks or complex guesswork; it should verify against the app's stock threshold requirement and add directly to the live cart using the saved product code, store ID, and requested quantity.

---

## User Requirements & Architecture Decisions
1. **Zero Rate/PTR Matching**: Completely remove rate/PTR checks and score gates from medicine reordering and matching across Refills and Special Orders.
2. **Zero MRP Matching**: Completely remove MRP checks and score gates from medicine reordering and matching.
3. **Pure Medicine Name Matching**: Matching relies on normalized medicine name tokens and brand identity (75-90 pts) + distributor match (10-15 pts).
4. **Saved Quantity Direct Add**: Reorders use the exact saved/specified quantity.
5. **Live Cart Direct Dispatch for Linked Items**:
   - For linked medicines, use the saved link (`store_id`, `product_code`, `product_name`) directly.
   - Live distributor stock is checked against the configured minimum requirement (`min_distributor_stock_threshold`).
   - The current live market rate from Pharmarack is stored in the database for billing/records, but never used to match or gate reorders.

---

## Files to Modify

1. **`frontend/src/utils/orderFuzzyMatcher.ts`**:
   - Remove PTR proximity matching and scoring (+15 pts max).
   - Remove MRP proximity matching and scoring (+5 pts max).
   - Reallocate title match to 85 points and distributor match to 15 points (total = 100).
   - Keep reason logs clean without price dependency.

2. **`src/utils/orderNameMatcher.ts`**:
   - Remove `orderMrp` / `incomingMrp` proximity score (+5 pts).
   - Reallocate title score to 85 points and distributor match to 15 points (total = 100).

3. **`src/services/refillCartService.ts`**:
   - When searching, linking, or adding to cart: ensure no rate or MRP equality or proximity check is required.
   - For linked products: allow direct cart dispatch using the saved link (`product_code`, `store_id`, `product_name`) and `qty`, checking stock against `min_distributor_stock_threshold`.
   - Ensure current live rates are received and updated in DB records without gating the add.

4. **`frontend/src/components/SpecialOrderAddModal.tsx`**:
   - Ensure `handleReorderPastItem` focuses on medicine name and saved quantity, without restricting search/selection to outdated historical PTR/MRP.

---

## Verification Plan
1. **Unit / Fuzzy Matcher Verification**:
   - Run tests verifying `scoreOrderNameMatch` and `orderFuzzyMatcher` produce high match scores for identical medicine names even when PTR and MRP are completely different or missing.
2. **Refill & Special Order Cart Verification**:
   - Verify `processRefillCartItem` adds medicine with changed market rate directly into the cart without rate-mismatch rejection.
3. **Guardrails & Knowledge Graph**:
   - Run `npm run guardrails` (`tsc --noEmit`, database checks, 0 violations).
   - Run `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracking

- [x] **Task 1: Update Frontend Fuzzy Matcher (`frontend/src/utils/orderFuzzyMatcher.ts`)**
  - Removed volatile PTR (+15 pts) and MRP (+5 pts) scoring. Re-weighted pure medicine name title matching to 85 points and distributor match to 15 points.
- [x] **Task 2: Update Backend Name Matcher (`src/utils/orderNameMatcher.ts`)**
  - Removed MRP proximity check (+5 pts). Re-weighted title matching to 85 points and distributor match to 15 points.
- [x] **Task 3: Update Refill Cart Service (`src/services/refillCartService.ts`) for Linked Direct Add without Rate/MRP Gating**
  - In `linkedState`, resolved mapped link items directly so existing distributor links dispatch straight to the live cart using saved product code, store ID, and quantity, checking stock against `min_distributor_stock_threshold` without being blocked by search pagination or price differences.
- [x] **Task 4: Update Special Order Reorder Component (`frontend/src/components/SpecialOrderAddModal.tsx`)**
  - Verified `handleReorderPastItem` passes medicine name and quantity directly to live cart dispatch without restrictive price gating.
- [x] **Task 5: Run Verification Tests, Performance Guardrails, and Knowledge Graph Update**
  - Created and ran unit tests in `scratch/verify-name-matcher.mjs` and `scratch/verify-fuzzy-matcher.mjs`, scoring 100% match on identical medicine names even with drastic PTR/MRP market drift.
  - Passed `npm run guardrails` with 0 violations (clean `tsc --noEmit`).
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
