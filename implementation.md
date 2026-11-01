# Implementation Plan: Fix SQLITE_ERROR no such column m.ptr in distributor-medicines Route
# Implementation Plan: Pure Medicine Name & Saved Quantity Reordering (Remove Rate/PTR/MRP Matching)

## Problem Statement
When fetching distributor medicines via `GET /api/pharmarack/distributor-medicines/:storeId`, the server threw:
```text
Error fetching distributor medicines: [Error: SQLITE_ERROR: no such column: m.ptr]
```
### Root Cause:
In [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts#L4842):
The query executed:
```sql
COALESCE(p.ptr, m.ptr, 0) AS ptr
```
However, the `medicines` table in SQLite does not possess a column named `ptr`. The corresponding price columns in `medicines` are `rate` and `last_purchase_ptr`. Additionally, `medicine_distributor_links` has `rate`.
In pharma distribution, PTR (purchase rate) and MRP are highly volatile and change frequently across batches, tax revisions, and distributor discount structures.
Previously, order matching (`orderFuzzyMatcher.ts`, `orderNameMatcher.ts`) and reorder paths evaluated PTR/MRP proximity as part of their matching criteria (allocating up to 20 points in matching score to PTR and MRP). When market rates fluctuated even slightly, match scores dropped below threshold (75), causing reorders and refill additions to fail or report mismatches.
Additionally, when a medicine is already linked to a distributor in the app, reordering should not perform unnecessary rate/MRP checks or complex guesswork; it should verify against the app's stock threshold requirement and add directly to the live cart using the saved product code, store ID, and requested quantity.

---

## Proposed Changes
## User Requirements & Architecture Decisions
1. **Zero Rate/PTR Matching**: Completely remove rate/PTR checks and score gates from medicine reordering and matching across Refills and Special Orders.
2. **Zero MRP Matching**: Completely remove MRP checks and score gates from medicine reordering and matching.
3. **Pure Medicine Name Matching**: Matching relies on normalized medicine name tokens and brand identity (75-90 pts) + distributor match (10-15 pts).
4. **Saved Quantity Direct Add**: Reorders use the exact saved/specified quantity.
5. **Live Cart Direct Dispatch for Linked Items**:
   - For linked medicines, use the saved link (`store_id`, `product_code`, `product_name`) directly.
   - Live distributor stock is checked against the configured minimum requirement (`min_distributor_stock_threshold`).
   - The current live market rate from Pharmarack is stored in the database for billing/records, but never used to match or gate reorders.

### 1. Fix SQL Query in `src/routes/pharmarack.ts`
- Replace `COALESCE(p.ptr, m.ptr, 0) AS ptr` with:
  ```sql
  COALESCE(p.ptr, l.rate, m.last_purchase_ptr, m.rate, 0) AS ptr
  ```
- Replace `COALESCE(p.mrp, m.mrp, 0) AS mrp` with:
  ```sql
  COALESCE(p.mrp, l.mrp, m.mrp, 0) AS mrp
  ```
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
1. **Live Query Verification**:
   - Query `GET /api/pharmarack/distributor-medicines/2940` (and other distributor IDs).
   - Verify it returns `200 OK` with items and zero SQLite errors in logs.
2. **Guardrails & Knowledge Graph**:
   - Run `npm run guardrails` (Clean TypeScript compilation `tsc --noEmit`, Database schema & integrity `OK`, 0 violations).
1. **Unit / Fuzzy Matcher Verification**:
   - Run tests verifying `scoreOrderNameMatch` and `orderFuzzyMatcher` produce high match scores for identical medicine names even when PTR and MRP are completely different or missing.
2. **Refill & Special Order Cart Verification**:
   - Verify `processRefillCartItem` adds medicine with changed market rate directly into the cart without rate-mismatch rejection.
3. **Guardrails & Knowledge Graph**:
   - Run `npm run guardrails` (`tsc --noEmit`, database checks, 0 violations).
   - Run `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracking

- [x] **Task 1: Fix SQL column reference in `src/routes/pharmarack.ts`**
  - Replaced invalid `m.ptr` with `COALESCE(p.ptr, l.rate, m.last_purchase_ptr, m.rate, 0) AS ptr` and `COALESCE(p.mrp, l.mrp, m.mrp, 0) AS mrp` in both the primary query and union query of `GET /api/pharmarack/distributor-medicines/:storeId`.
- [x] **Task 2: Test `GET /api/pharmarack/distributor-medicines/:storeId` live**
  - Tested `http://127.0.0.1:5174/api/pharmarack/distributor-medicines/2940` via live HTTP request. Received HTTP 200 with 75 mapped items and zero SQLite errors.
- [x] **Task 3: Run Guardrails & Auto-Update Knowledge Graph**
  - Ran `npm run guardrails` — clean TypeScript compilation (`tsc --noEmit`), DB schema integrity OK, PASS with 0 violations.
  - Ran `node scripts/quick-update.mjs` — knowledge graph synchronized successfully.
