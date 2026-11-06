# IMPLEMENTATION PLAN: Pharmarack Live Cart Add False Failure & Truthful Verification

## Plan Name
`PHARMARACK_LIVE_CART_ADD_FALSE_FAILURE_AND_TRUTHFUL_VERIFICATION`

---

## 1. Problem Formulation & Root Cause Analysis

### Problem Description
When adding a medicine (e.g. `DUPHALAC 450 ML`) into the Pharmarack cart via the app, the UI displays a "Failed" error toast (`Live addition failed: ...`), yet when the pharmacist checks the official Pharmarack retailer website or mobile app, the medicine was actually successfully added to the distributor cart.

### Root Causes
1. **Narrow & Fragile Upstream Success Status Check (`isOk`)**:
   - In `src/routes/pharmarack.ts` (`addItemsToPharmarackCart`), `isOk` checked `resJson.StatusCode === 200` or `resJson.status === 'success'` or `resJson.Message.toLowerCase().includes('success')`.
   - In Pharmarack's ASP.NET Web API:
     - `StatusCode` is often `1` (1 = success, 0 = failure in ASP.NET).
     - Keys are PascalCase: `resJson.Status === "Success"` or `resJson.Status === 1`, while `resJson.status` is `undefined`.
     - `Message` can be `"Product Added in Cart"`, `"Product added to cart"`, or `"Item added to cart"`, which do not contain the literal word `"success"`.
   - Consequently, `isOk` returned `false` on successful additions, and the backend answered HTTP 503 with an error message containing the success response text from Pharmarack.

2. **Symmetrical Fallback Bypassed on HTTP 200**:
   - When calling `AddUserProductCartDetail`, if an item already exists in the cart, Pharmarack returns HTTP 200 with `{ StatusCode: 0, Message: "Product already in cart" }`.
   - The fallback to `UpdateUserProductCartDetail` was guarded strictly by `if (!res.ok)`. Because HTTP status was 200, `!res.ok` was false, bypassing the update fallback.

3. **Absence of Truthful Ground-Truth Verification**:
   - In `src/services/refillCartService.ts` and `src/services/pharmarackCheckoutService.ts`, ambiguous or failed cart operations execute a verification read (`loadLiveCartCore()`) to check whether the item is physically present in the live cart.
   - `addItemsToPharmarackCart` lacked this truthful check, reporting failures even when items had been written to the remote cart.

---

## 2. Technical Architecture & File Ownership

### Primary Files
- `src/routes/pharmarack.ts`
  - **Comprehensive Upstream Status Parsing**:
    - Update `isOk` to recognize all Pharmarack success patterns:
      - `StatusCode === 200 || StatusCode === 1 || StatusCode === 100 || String(StatusCode) === '200' || String(StatusCode) === '1'`
      - `Status === 'Success' || Status === 'success' || Status === 1 || Status === true`
      - `status === 200 || status === 'success' || status === 'OK' || status === 1 || status === true`
      - `Message` matching `/success|added|in\s*cart|updated|item.*cart|product.*cart/i`
  - **Smart Symmetrical Fallback**:
    - If `AddUserProductCartDetail` returns `{ StatusCode: 0 }` with message matching `/already|exist/i`, automatically trigger `UpdateUserProductCartDetail` or treat as existing.
  - **Truthful Live Cart Fallback Verification**:
    - If direct API response is ambiguous or reports failure/timeout, run a fast verified lookup with `loadLiveCartCore()` (or probe cache).
    - If the item (`storeId` + `productCode` / `productName`) is verified present in the remote distributor cart, treat the operation as `success: true`.
  - **Cache Invalidation & Real-time SSE**:
    - Invalidate probe & server cart cache on confirmed adds, broadcasting `pharmarack_cart_changed`.
- `frontend/src/components/LiveCartAddModal.tsx`
  - Ensure background add runner handles verified responses cleanly without flashing false error toasts.
- `frontend/src/pages/PharmarackCart/index.tsx`
  - Ensure quantity update debounce and add handlers synchronize smoothly with the refreshed cart state.
- `tests/pharmarackCartAddTruthful.test.ts`
  - Test suite covering:
    - PascalCase `Status: "Success"` and `StatusCode: 1`.
    - Message `"Product Added in Cart"` without the word `"success"`.
    - Truthful verification fallback when remote API returns ambiguous status but item is present in cart.
    - Symmetrical update fallback when product is already in cart.

---

## 3. Human-in-the-Loop Workflow Integration
- In compliance with Rule 6, the system automates cart addition and verification, while providing the pharmacist full transparency:
  - If a distributor imposes an MOQ, scheme limit, or rate change, the app surfaces an actionable prompt in the UI allowing the user to manually approve, adjust quantity, or dismiss.
  - Pharmacists retain a one-click "Sync with Live Cart" action to manually reconcile local and remote cart states at any time.

---

## 4. Implementation Steps

1. **Step 1: Standardize Upstream Success Criteria in `src/routes/pharmarack.ts`**
   - Enhance `isOk` to handle `StatusCode: 1 | 200 | 100`, `Status: 'Success' | 1 | true`, and regex-based message matching for `"added"`, `"in cart"`, and `"success"`.
2. **Step 2: Add Duplicate/Exists Symmetrical Fallback**
   - Check if response message indicates the item already exists in the cart, routing to `UpdateUserProductCartDetail` or treating as succeeded.
3. **Step 3: Implement Truthful Cart Verification Read**
   - When an add attempt fails or times out, perform a fast check of `loadLiveCartCore()`. If the item exists in the cart for that store, treat as `success: true`.
4. **Step 4: Unit & Integration Verification**
   - Write and execute `tests/pharmarackCartAddTruthful.test.ts`.
   - Run `npm run guardrails` to ensure zero performance or architecture violations.
5. **Step 5: Knowledge Graph Synchronization**
   - Run `node scripts/quick-update.mjs`.

---

## 5. Completed Tasks
- [x] Identified root cause in `src/routes/pharmarack.ts` (strict `isOk` check rejecting `StatusCode: 1`, PascalCase `Status: "Success"`, and `"Product Added in Cart"` messages).
- [x] Preserved previous POS implementation plan into `POS_LOOSE_MEDICINE_TRAILING_EMPTY_ROW_PLAN.md`.
- [x] Created dedicated implementation plan `PHARMARACK_LIVE_CART_ADD_FALSE_FAILURE_FIX_PLAN.md` and initialized `implementation.md`.
- [x] Implemented enhanced upstream status parsing `isPharmarackCartSuccess` in `src/routes/pharmarack.ts` handling `StatusCode: 1 | 200 | 100`, `Status: 'Success'`, and regex matching for `"added"`, `"in cart"`, and `"cart"`.
- [x] Implemented duplicate/already-in-cart fallback on HTTP 200 to `UpdateUserProductCartDetail`.
- [x] Implemented truthful live cart read verification fallback via `loadLiveCartCore()`.
- [x] Added unit tests in `tests/pharmarackCartAddTruthful.test.ts` (4/4 tests passed).
- [x] Verified `npm run guardrails` exit 0 (clean `tsc --noEmit`, 0 violations).
- [x] Logged `P2-109` in `SMALL_BUG_FIX_PLAN.md`.
- [x] Updated knowledge graph (`node scripts/quick-update.mjs`).

