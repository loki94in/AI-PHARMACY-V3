# Implementation Plan: Show Refill Patients in QA Panel When Added to Live Cart from CRM (Regardless of Due Date)

## 1. Problem Statement & User Intent
When a pharmacist adds any medicine to the Pharmarack Live Cart from the CRM Refill page (either via "+ Live Cart" on an individual medicine, "Order to Cart" for the patient, or "Confirm Refill & Add to Live Cart"):
- The medicine is successfully added into the live Pharmarack cart.
- However, that patient **did not appear in the Quick Assist (QA) panel** under the Refills tab if the patient's scheduled refill due date was not yet due (e.g. `diffDays > 7` days away or in the future).
- The user's requirement:
  > *"When user add the medicine from the Add to Live Cart from the CRM page any time (if the selected refill patient refill due is not due or come still app need to show that patient in the refill section we have absolute idea when user click the add to live from the CRM so he can see in the QA panel in the app)."*

---

## 2. Root Cause Analysis
1. **Backend Query SQL Gate (`src/routes/refills.ts`)**:
   - `GET /api/refills/panel?upcoming_days=7` (used by `Layout.tsx` for Quick Assist) strictly filtered with:
     ```sql
     WHERE pr.is_active = 1
       AND (pr.last_refill_date IS NULL OR DATE(pr.next_refill_date) > DATE(pr.last_refill_date))
       AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+' || ? || ' days')
     ```
   - When a patient has a refill due > 7 days away (e.g., in 15 or 30 days), this SQL condition completely excluded the record, even if the medicine has been ordered or added into the live cart (`cart_store_name IS NOT NULL`).
2. **Frontend Filter Gate in Quick Assist (`frontend/src/components/QuickAssistSidebar.tsx`)**:
   - `actionableRefills` checked `checkRefillCycleBooking(r).alreadyDispensed` and `return diffDays <= 7;`.
   - `checkRefillCycleBooking(r)` in `frontend/src/utils/refillSettled.ts` considered any refill `> 7 days` away as "dormant" and set `alreadyDispensed: true`.
   - Consequently, even if the row reached the client, it was discarded from `actionableRefills`.
3. **Refill Cart Update State (`src/services/refillCartService.ts`)**:
   - `processRefillCartItem` recorded `cart_store_id`, `cart_store_name`, `cart_product_code`, etc., but did not explicitly update `status` from `'pending'` to `'ordered'`.

---

## 3. Implemented Solution & Architecture

### A. Backend Route Update (`src/routes/refills.ts`)
- In `GET /panel`:
  - When `upcoming_days` is passed (Quick Assist mode), updated the WHERE condition so that records with `cart_store_name IS NOT NULL`, `cart_product_code IS NOT NULL`, `status = 'ordered'`, `is_ready = 1`, or belonging to a patient who has an active ordered/cart-added refill are included regardless of `next_refill_date`.

### B. Refill Cart Service Update (`src/services/refillCartService.ts`)
- In `processRefillCartItem`:
  - Updated `status = CASE WHEN status = 'pending' THEN 'ordered' ELSE status END` when the cart line is confirmed/added in both existing lines and new candidate additions.

### C. Refill Settled & Cycle Booking Helper (`frontend/src/utils/refillSettled.ts`)
- In `checkRefillCycleBooking`:
  - Detects `isOrderedOrInCart`: if an item is already ordered or in the live cart, it is active and actionable (not dormant): `canBook: true`, `isEarly: diffDays > 0`, `daysEarly: Math.max(0, diffDays)`, and `alreadyDispensed: false`.

### D. Quick Assist Sidebar Filtering (`frontend/src/components/QuickAssistSidebar.tsx`)
- In `actionableRefills`:
  - Allows items where `isOrderedOrInCart` is true, bypassing the strict `diffDays <= 7` cutoff.
- In `timingCategory`:
  - Supports `'Upcoming'` category for `diffDays > 7` so that labels like `15d` or `25d` are displayed cleanly.

### E. Human-in-the-Loop Integration
- Once visible in QA panel:
  - The pharmacist sees the patient in Stage B (`ordered`) with `[Mark Ready] [POS] [Complete] [Edit]`.
  - The pharmacist retains complete control to mark it ready upon delivery, bill it early at POS with a confirmation dialog, or mark it complete.

---

## 4. Verification Plan & Results
1. **Unit Tests**:
   - Created `tests/refillLiveCartQaPanelSync.test.ts`:
     - Verified `checkRefillCycleBooking` and `isRefillOrdered` treat distant ordered/in-cart refills as actionable and bookable.
     - Verified SQLite query behavior: returns upcoming refills (<= 7 days) AND distant refills added to live cart or ordered.
     - Result: 4/4 tests passed (`npm test -- tests/refillLiveCartQaPanelSync.test.ts`).
2. **Performance Guardrails**:
   - Ran `npm run guardrails`:
     - Clean TypeScript compilation (`tsc --noEmit`).
     - Database schema & integrity checks passed.
     - 0 guardrail violations. Speed architecture intact.
3. **Knowledge Graph Update**:
   - Ran `node scripts/quick-update.mjs`:
     - Updated knowledge graph (1340 nodes, 877 edges).

---

## 5. Tasks Tracking
- [x] Update `src/routes/refills.ts` GET /panel SQL WHERE clause
  - Included items with active cart lines, `status = 'ordered'`, `is_ready = 1`, or companion medicines for active cart patients.
- [x] Update `src/services/refillCartService.ts` status update on live cart addition
  - Ensured `status = CASE WHEN status = 'pending' THEN 'ordered' ELSE status END` on line updates.
- [x] Update `frontend/src/utils/refillSettled.ts` to recognize ordered/in-cart refills as actionable
  - Extended `isRefillOrdered` to check `cart_product_code` and `in_live_cart`.
  - Updated `checkRefillCycleBooking` to return `alreadyDispensed: false` and `canBook: true` when ordered/in-cart.
- [x] Update `frontend/src/components/QuickAssistSidebar.tsx` actionableRefills and timingCategory
  - Allowed `diffDays <= 7 || isOrderedOrInCart`.
  - Added `'Upcoming'` timing category for `diffDays > 7`.
- [x] Add unit test suite `tests/refillLiveCartQaPanelSync.test.ts`
  - 4 comprehensive tests verifying both frontend helpers and SQLite query logic.
- [x] Verify `npm run guardrails` and run `node scripts/quick-update.mjs`
  - Guardrails passed with 0 violations; knowledge graph updated.