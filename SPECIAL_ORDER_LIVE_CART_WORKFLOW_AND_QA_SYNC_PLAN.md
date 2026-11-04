# SPECIAL_ORDER_LIVE_CART_WORKFLOW_AND_QA_SYNC_PLAN

## Overview
Unifies Special Order ordering into the same high-performance "Add to Cart" pop-up workflow as the rest of the application. Enables automatic staging when a mapped distributor has >= 15 quantity in stock, allows seamless switching to alternative distributors if out of stock, enforces the first-two-alphanumeric-words search query rule (preventing Pharmarack search zero-match errors from dosage form/pack size suffix bleed), and propagates real-time event updates to Quick Assist (QA).

## Architecture Plan
1. Helper: `frontend/src/utils/searchTokens.ts`
   - `getFirstTwoAlphanumericTokens(name: string): string`
2. `SpecialOrderAddModal.tsx`:
   - Search uses `getFirstTwoAlphanumericTokens`.
   - Auto-selects candidate with `stock >= 15`.
   - Fires `specialOrdersEvent.triggerUpdated()` and `'refresh-special-orders'`.
3. `SpecialOrdersSection.tsx`:
   - "Cart" button calls `liveCartAddEvent.triggerOpen(getFirstTwoAlphanumericTokens(order.product), order.qty, order.id)`.
   - Dual event dispatch on `handleAddAllSpecialOrdersToCart` and `onOrderCreated`.
4. `LiveCartSearchSection.tsx` & `LiveCartAddModal.tsx`:
   - Clean query transfer with `getFirstTwoAlphanumericTokens`.
   - Auto-select candidate with `stock >= 15`.
5. Guardrails & Knowledge Graph update.

