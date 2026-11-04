# SPECIAL_ORDER_LIVE_CART_WORKFLOW_AND_QA_SYNC_PLAN

## Objective
Unify Special Order ordering into the same high-performance "Add to Cart" pop-up workflow as the rest of the application. Enable automatic staging when a mapped distributor has >= 15 quantity in stock, allow seamless switching to alternative distributors if out of stock, enforce the first-two-alphanumeric-words search query rule (preventing Pharmarack search zero-match errors from dosage form/pack size suffix bleed), and propagate real-time event updates to Quick Assist (QA).

---

## Architecture & Workflow Strategy

### 1. Token Sanitizer (`frontend/src/utils/searchTokens.ts`)
- Extract only the first two alphanumeric tokens (letters and numbers only) from any medicine name or search query.
- Example: `"TELMA 40MG TABLET 10'S"` -> `"TELMA 40MG"`.
- Example: `"AUGMENTIN 625 DUO TAB"` -> `"AUGMENTIN 625"`.
- Prevents Pharmarack live search misses caused by trailing words like "TABLET", "STRIP", "10'S", etc.

### 2. Special Order "Cart" Action Integration (`frontend/src/pages/CRM/SpecialOrdersSection.tsx`)
- When the user clicks the "Cart" button on a special order card in CRM:
  - Do NOT blindly push unverified/out-of-stock data to the cart.
  - Open the Live Cart Add pop-up using `liveCartAddEvent.triggerOpen(getFirstTwoAlphanumericTokens(order.product), order.qty, order.id)`.
  - This lets the user see live distributor availability, PTR, schemes, and stock before committing.
  - In batch cart actions, dispatch `specialOrdersEvent.triggerUpdated()` and `'refresh-special-orders'`.

### 3. Min 15 Qty Auto-Staging & Distributor Selection (`LiveCartSearchSection.tsx` & `SpecialOrderAddModal.tsx`)
- Check stock levels: `stock >= 15` or `stock.toLowerCase() === 'high'`.
- If a mapped distributor has >= 15 stock available, automatically select/stage that candidate as the delivery-guaranteed choice.
- If out of stock (< 15 or nil), keep dropdown open with all distributor options, PTR, and stock chips so the user can easily switch to a different distributor.

### 4. Real-time Quick Assist (QA) Synchronization
- When an order is created or re-ordered in `SpecialOrderAddModal.tsx`:
  - Emit `specialOrdersEvent.triggerUpdated()` and dispatch `'refresh-special-orders'`.
- When an order is added to cart via `LiveCartAddModal.tsx`:
  - Status updates to `'Ordered'`, events fire, and `Layout.tsx` updates `specialOrdersList` immediately, updating Quick Assist in 0ms.

---

## Detailed Task Checklist

- [x] **Task 1**: Create `frontend/src/utils/searchTokens.ts` with `getFirstTwoAlphanumericTokens` and `hasMinStock15`.
- [x] **Task 2**: Update `frontend/src/components/SpecialOrderAddModal.tsx`:
  - Applied `getFirstTwoAlphanumericTokens` on live Pharmarack search.
  - Added auto-select / stage for candidate with stock >= 15.
  - Emitted `specialOrdersEvent.triggerUpdated()` and `'refresh-special-orders'` on save.
- [x] **Task 3**: Update `frontend/src/pages/CRM/SpecialOrdersSection.tsx`:
  - Single-item "Cart" button calls `liveCartAddEvent.triggerOpen(getFirstTwoAlphanumericTokens(order.product), order.qty, order.id)`.
  - Added event dispatches in `handleAddAllSpecialOrdersToCart` and `onOrderCreated`.
- [x] **Task 4**: Update `frontend/src/components/LiveCartSearchSection.tsx` & `LiveCartAddModal.tsx`:
  - Applied `getFirstTwoAlphanumericTokens` on external query transfers and product search.
  - Prioritized and auto-staged candidates with stock >= 15.
- [x] **Task 5**: Verify Performance Guardrails (`npm run guardrails`) and build tests.
- [ ] **Task 6**: Update auto-knowledge graph (`node scripts/quick-update.mjs`) and update documentation.

---

## Completed Tasks Log
- **Task 1**: Implemented `frontend/src/utils/searchTokens.ts` exporting `getFirstTwoAlphanumericTokens` and `hasMinStock15`.
- **Task 2**: Updated `SpecialOrderAddModal.tsx` to search using the first 2 alphanumeric tokens, automatically stage the top mapped candidate with >= 15 stock, and dispatch dual refresh events upon order registration.
- **Task 3**: Updated `SpecialOrdersSection.tsx` to open the Live Cart Add modal when clicking "Cart" with `sourceOrderId` and sanitized 2-word medicine name, and added event triggers on batch cart add and modal completion.
- **Task 4**: Updated `LiveCartSearchSection.tsx` and `LiveCartAddModal.tsx` with 2-word sanitization and stock >= 15 sorting priority.
- **Task 5**: Ran `npm run guardrails`, verifying TypeScript compilation (`tsc --noEmit`) passes cleanly with 0 violations.
