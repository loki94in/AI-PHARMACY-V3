# IMPLEMENTATION PLAN: POS Fast-Cashier Workflow Verification (Syrups vs Loose vs Checkout)

## Plan Name
`POS_ASCORIL_SYRUP_AND_LOOSE_SALE_FAST_CASHIER_VERIFICATION`

---

## 1. Problem Formulation & Scope
The cashier in POS needs a seamless, rapid keyboard workflow tailored to medicine form:
1. **Full-Pack / Syrups / Liquids (e.g., `ASCORIL LS + SYP`)**:
   - `packaging: "100 ML"`, `allow_loose_sale === 0`, or single unit.
   - When selected via Enter or click:
     - Sets default `qty = 1` and `looseQty = 0`.
     - Automatically routes focus directly to the Next Medicine Search row (`#row-med-input-${nextIdx}`).
     - Cashier can immediately type the next item without touching the mouse or keyboard arrows.
2. **Loose-Sale Enabled Medicines (e.g., `TORSID PLUS 20/50MG TAB 10'S`)**:
   - Multi-unit blister/strip with `allow_loose_sale === 1` and `pack_size > 1`.
   - When selected via Enter or click:
     - Focus routes directly into Loose Tablets Qty (`#row-loose-input-${curIdx}`).
     - Cashier types loose tablet count.
     - Pressing Enter in Loose Tablets Qty immediately advances focus to the Next Medicine Search row (`#row-med-input-${nextIdx}`).
3. **Empty Row Concludes Bill (Checkout)**:
   - When cashier reaches the trailing empty medicine row and presses Enter or Tab without entering a medicine:
     - Automatically transitions focus to Bill Checkout / Discount input (`#pos-bill-discount-input`), allowing one-touch billing completion.

---

## 2. Architecture & File Ownership
- Primary file: `frontend/src/pages/POS/index.tsx`
  - `resolveAllowLooseSale(item)`: determines if item can be sold loose (pack size > 1, not liquid/syrup/drops).
  - `addToCart` & `changeRowMedicine`: allocates batches with `incQty = isLoose ? 0 : 1`, sets focus routing timer to `#row-loose-input-${targetIndex}` or `#row-med-input-${targetIndex + 1}`.
  - Table row rendering: keydown handlers on `#row-loose-input-${curIdx}` and `#row-med-input-${curIdx}`.
- Test suite: `tests/pos-focus-and-enter.e2e.ts`
  - E2E tests validating Full Pack / Syrup auto-advance with default `qty = 1`, Loose-first routing, and Empty row checkout.

---

## 3. Implementation & Verification Steps
1. Run existing test suite `tests/pos-focus-and-enter.e2e.ts` to ensure 100% green pass.
2. Add explicit test coverage in `tests/pos-focus-and-enter.e2e.ts` for `ASCORIL LS + SYP` to verify exact database syrup behavior (packaging "100 ML", default qty 1, immediate hop to next row).
3. Verify guardrails (`npm run guardrails`) with zero violations.
4. Auto-knowledge graph synchronization (`node scripts/quick-update.mjs`).

---

## 4. Completed Tasks
- [x] Implemented `resolveAllowLooseSale` with pack size and liquid detection.
- [x] Fixed liquid/volume detection in `parsePackSizeFromPackaging` so volume measures (e.g. `100 ML`, `60 ML`, `15 ML`) are parsed as 1 bottle, preventing syrups from being misclassified as loose-sale items with pack size 100.
- [x] Updated `resolveAllowLooseSale` to enforce that syrups and liquids (`isLiquidOrSingleUnitForm`) always return 0 (cannot be sold loose).
- [x] Replaced all 38 instances of `cart.indexOf(item)` in table row JSX with true mapped `rowIdx`, eliminating negative index (-1) bugs and stale array references.
- [x] Fixed `changeRowMedicine` and `fetchDetailsAndChangeRowMedicine` to guard against negative indexes and guarantee full-pack items default to at least 1 unit (`Math.max(1, originalItem?.qty || 1)`).
- [x] Fixed `allocateMedicineBatches` to match active batches by normalized medicine name when catalog medicine ID differs from legacy inventory ID mapping.
- [x] Refined `Shift+Tab` backwards navigation from empty medicine rows to land on previous row's quantity input (`prevLoose` if enabled, else `prevQty`).
- [x] Implemented direct focus routing to `#row-loose-input-${targetIndex}` for loose-allowed medicines.
- [x] Implemented direct focus routing to `#row-med-input-${targetIndex + 1}` for full-pack/syrup items with default `qty = 1`.
- [x] Implemented empty row Enter -> `#pos-bill-discount-input` checkout transition.
- [x] Added explicit E2E test verification for `ASCORIL LS + SYP` in `tests/pos-focus-and-enter.e2e.ts`.
- [ ] Verify test suite completion for 6/6 tests.
- [ ] Guardrails verification.
