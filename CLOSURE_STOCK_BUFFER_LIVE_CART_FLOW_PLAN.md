# Implementation Plan: Market Closure Stock Buffer Review - One-Click Live Cart Flow

**Created**: 2026-11-08  
**Objective**: In the **Market Closure Stock Buffer Review** popup (`ClosureStockBufferModal.tsx`), replace the dead-end static `In Cart: Manual / Phone Order` badge with an always-active green `+ Live Cart ({qty})` button (matching `RefillsSection.tsx`), allowing pharmacists to adjust quantity and one-click add items to the Pharmarack live cart one by one.

---

## 1. Problem Diagnosis
- When a refill had a note or status `'Manual / Phone Order'`, `src/services/marketClosureService.ts` flags `is_in_cart: true` and `cart_store_name: 'Manual / Phone Order'`.
- In `ClosureStockBufferModal.tsx:457`, `item.is_in_cart` was evaluated conditionally to hide the green `+ Live Cart` button, displaying only a dead-end static pill: `<span ...>In Cart: Manual / Phone Order</span>`.
- Pharmacists were unable to dispatch those items to the live cart directly from the modal.

---

## 2. Surgical Solution Architecture
- In `frontend/src/components/ClosureStockBufferModal.tsx`:
  - Always render the green `+ Live Cart ({orderQtys[item.refill_id] || shortfall})` action button for every row.
  - Clicking calls `startRefillCartJob` with the medicine details and specified quantity.
  - If the item already belongs to an active Pharmarack live cart store (and is NOT `'Manual / Phone Order'`), display an informative secondary tag (`In Cart: <Store Name>`) underneath without disabling the primary action.
  - Strict compliance with DOX, Semantic Tailwind tokens, and guardrails.
  - Touch NO OTHER files in the app.

---

## 3. Execution Tasks
- [x] Task 1: Update `frontend/src/components/ClosureStockBufferModal.tsx` Live Cart column to always provide the green `+ Live Cart` button.
- [x] Task 2: Run `npm run guardrails` to guarantee 0 violations.
- [x] Task 3: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
- [x] Task 4: Complete human-in-the-loop verification report.

---

## 4. Completed Work & Audit Record
1. **Live Cart Button Availability**:
   - Replaced conditional hiding logic in `frontend/src/components/ClosureStockBufferModal.tsx:456-485`.
   - The green `+ Live Cart ({qty})` button is now always rendered and directly clickable for every medicine shortfall row.
   - For items with existing active Pharmarack live cart stores, an informative secondary badge `In Cart: <Store>` is rendered underneath while keeping the action button accessible.
   - Fixed the dead-end `In Cart: Manual / Phone Order` lock, allowing one-click dispatch to the live cart.
2. **Quality & Performance Guardrails**:
   - `npm run guardrails` passed with 0 violations (clean `tsc --noEmit`, semantic tokens preserved).
   - Knowledge graph synchronized via `quick-update.mjs`.

