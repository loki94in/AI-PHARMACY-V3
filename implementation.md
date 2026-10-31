# Implementation Plan: Strict Patient Cart Line Attribution to Prevent Cross-Patient & Shelf-Stock False Triggers in Refills & QA Panel

## 1. Problem Statement & User Intent
In the pharmacy app, multiple patients may be prescribed the same medicine (e.g. *Telmisartan 40mg*), or the pharmacy may order medicines directly from the Live Cart for general store shelf stock (not associated with any CRM patient).
Previously:
- In `src/routes/refills.ts` (`GET /panel`), when mapping active live cart lines to patient refill rows:
  - If a patient refill row did not have an explicit `cart_product_code` or `cart_store_id`, it fell back to loose medicine name matching (`normName` / `words.every(...)`).
  - As a result:
    1. If the pharmacy ordered *Telmisartan 40mg* for shelf stock, any patient due within 7 days who takes *Telmisartan* would falsely show `In Live Cart: Distributor ×Qty` (Stage B: Ordered) instead of `[Add to Cart]` (Stage A: Needs ordering).
    2. If Patient A ordered *Telmisartan 40mg* via CRM, Patient B (who also takes *Telmisartan*) would match that same live cart line and falsely appear as "In Live Cart".
- The user requested strict isolation so that:
  - Adding a medicine for Patient A **only** affects Patient A.
  - Adding shelf stock directly in Live Cart never triggers or alters any patient's refill status.
  - If a patient takes multiple medicines (e.g. 30 days vs 100 days), ordering 1 medicine orders only that medicine, leaving distant ones dormant.

---

## 2. Implemented Architecture & Strict Attribution Contract

### A. Strict Attribution in `GET /panel` (`src/routes/refills.ts`)
- Replaced the un-attributed name-search fallback in lines 989–1011 of `src/routes/refills.ts`.
- A refill row now **only** resolves a `liveCartHit` if:
  1. `row.cart_product_code` is present and matches `c.productCode` (and `row.cart_store_id` matches `c.storeId`), OR
  2. `row.cart_product_name` and `row.cart_store_id` were explicitly recorded on this specific refill row and match the cart line.
- If neither is recorded on the patient's row, `liveCartHit` remains `undefined`, and `in_live_cart` remains `false`.

### B. Multi-Patient & Shelf-Stock Isolation Guaranteed
- **Shelf stock added from Live Cart**: No patient row possesses that `cart_product_code`. Zero patient refills are affected.
- **Patient A vs Patient B**: Patient A's row records `cart_product_code = 'XYZ'`. Patient B's row remains `NULL`. Patient A shows `In Live Cart`, Patient B shows `[Add to Cart]`.

---

## 3. Verification Plan & Results
1. **Unit Tests**:
   - Updated `tests/refillLiveCartQaPanelSync.test.ts`:
     - Verified `checkRefillCycleBooking` & `isRefillOrdered` helpers.
     - Verified backend SQL query filter: returns upcoming refills (<= 7 days) and distant refills added to live cart.
     - Verified strict cart isolation: Patient A gets `in_live_cart = true`, Patient B (same medicine, un-ordered) gets `in_live_cart = false`, and general shelf stock does not attach to patient refills.
     - Result: 5/5 tests passed (`npm test -- tests/refillLiveCartQaPanelSync.test.ts`).
2. **Performance Guardrails**:
   - Ran `npm run guardrails`:
     - Clean TypeScript compilation (`tsc --noEmit`).
     - 0 guardrail violations. Speed architecture intact.
3. **Knowledge Graph Update**:
   - Ran `node scripts/quick-update.mjs`:
     - Synchronized 1340 nodes, 877 edges.

---

## 4. Tasks Tracking
- [x] Create implementation plan
- [x] Update `src/routes/refills.ts` to strictly match by patient row attribution (`cart_product_code` / `cart_store_id`)
- [x] Update `tests/refillLiveCartQaPanelSync.test.ts` to verify multi-patient isolation and shelf-stock protection
- [x] Run test suite (5/5 passing) and `npm run guardrails` (0 violations)
- [x] Update knowledge graph via `node scripts/quick-update.mjs`
