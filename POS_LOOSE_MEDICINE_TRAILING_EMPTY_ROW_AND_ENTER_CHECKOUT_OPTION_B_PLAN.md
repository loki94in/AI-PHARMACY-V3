# IMPLEMENTATION PLAN: POS Loose Medicine Trailing Empty Row & Enter Checkout (Option B)

## Plan Name
`POS_LOOSE_MEDICINE_TRAILING_EMPTY_ROW_AND_ENTER_CHECKOUT_OPTION_B`

---

## 1. Problem Formulation & Scope

### Selected Workflow (Option B)
1. **Selection of Loose Medicine**:
   - Cashier searches and selects a loose-sale enabled medicine (e.g., `TORSID 20MG`).
   - Focus routes directly into **Loose Tablets Qty** (`#row-loose-input-${curIdx}`).
   - Cashier types the number of loose units (or leaves it as default).
2. **First Enter (Advance to Guaranteed Trailing Empty Row)**:
   - Cashier presses `Enter` on `#row-loose-input-${curIdx}`.
   - The app guarantees that a trailing empty row (`#row-med-input-${curIdx + 1}`) exists.
   - Cursor advances directly into the trailing empty row `#row-med-input-${curIdx + 1}`.
   - The empty row's search term is guaranteed clean (`""`), unblocking keyboard checkout.
3. **Second Enter (Conclude the Bill)**:
   - On the trailing empty row, when the search term is blank, pressing `Enter` immediately transitions focus to `#pos-bill-discount-input` (Bill Discount / Checkout), seamlessly concluding the bill.

---

## 2. Technical Architecture & File Ownership

### Primary Files
- `frontend/src/pages/POS/index.tsx`
  - **Guaranteed Trailing Empty Row Invariant**:
    - In `rebalanceCartMedicine`: Added `if (!newCart.some(r => r.isEmptyRow)) { newCart.push(makeEmptyCartRow()); }` ensuring that updating loose or strip quantities never leaves the cart without a trailing empty row.
    - In `cart` `useEffect`: Enhanced the auto-append check to ensure any non-empty last item in `cart` immediately triggers the addition of `makeEmptyCartRow()`.
  - **Focus & State Cleanliness**:
    - In `#row-med-input-${rowIdx}` `onFocus`: Unconditionally reset `activeRowSearchIndex` to `idx`, `rowSearchTerm` to `""`, and clear dropdown results whenever an empty row (`item.isEmptyRow`) is focused, preventing stale search term retention from blocking `Enter` checkout.
  - **Checkout Conclude Transition**:
    - In `#row-med-input-${rowIdx}` `onKeyDown`: When `item.isEmptyRow` and `e.key === 'Enter'`, checks `(!rowSearchTerm || rowSearchTerm.trim().length === 0 || !e.currentTarget.value.trim())`, routing focus directly to `#pos-bill-discount-input`.
  - **Enter Navigation from Loose Qty**:
    - In `#row-loose-input-${rowIdx}` `onKeyDown`: Pressing `Enter` runs `hopToNext` which targets `#row-med-input-${curIdx + 1}`.
- `tests/pos-focus-and-enter.e2e.ts`
  - Added step 6 to test 2 to verify that pressing `Enter` on the trailing empty row after a loose medicine selection concludes the bill into `#pos-bill-discount-input`.

---

## 3. Implementation Steps

1. **Step 1: Guarantee Empty Row Persistence in Cart Updates**
   - In `rebalanceCartMedicine`: Added invariant ensuring `makeEmptyCartRow()` is present.
   - In `cart` `useEffect`: Enhanced empty row auto-append with functional check `!prev[prev.length - 1].isEmptyRow`.
2. **Step 2: Clean Empty Row Focus and Search State**
   - In `row-med-input` `onFocus`: Ensured empty rows immediately clear `rowSearchTerm` to `""` and set `activeRowSearchIndex` to `rowIdx`.
   - In `row-med-input` `onKeyDown`: Guaranteed Enter transitions to `#pos-bill-discount-input`.
3. **Step 3: Verification with E2E Tests & Guardrails**
   - Updated `tests/pos-focus-and-enter.e2e.ts` test 2 to verify the complete loose medicine -> new empty row -> Enter checkout flow.
   - Verified with `npm run guardrails` (PASS, 0 violations, clean TypeScript compilation).
   - Verified production build with `npm run build:client` (built in 42.98s).
4. **Step 4: Knowledge Graph**
   - Updated auto-knowledge graph with `node scripts/quick-update.mjs`.

---

## 4. Completed Tasks
- [x] Defined Option B workflow requirements.
- [x] Implemented guaranteed empty row persistence in `rebalanceCartMedicine` and cart `useEffect`.
- [x] Cleaned `row-med-input` `onFocus` so empty rows always reset `rowSearchTerm` and dropdown state.
- [x] Enhanced `row-med-input` `onKeyDown` to ensure `Enter` on a blank empty row reliably focuses `#pos-bill-discount-input`.
- [x] Updated `tests/pos-focus-and-enter.e2e.ts` with explicit assertion for concluding the bill via Enter from the new empty row.
- [x] Passed performance guardrails (`npm run guardrails`) with zero violations.
- [x] Verified complete frontend production build (`npm run build --prefix frontend`).
- [x] Synchronized knowledge graph (`node scripts/quick-update.mjs`).
