# Implementation Plan: Fix Reorder Hub Crash & Quick Assist Special Request Medicine Name Display

**Target:** Eliminate `Cannot read properties of undefined (reading 'toLowerCase')` in Reorder Hub (`frontend/src/pages/PharmarackCart/index.tsx`) and fix Special Orders showing generic `"Item"` instead of the medicine name in Quick Assist (`frontend/src/components/QuickAssistSidebar.tsx`).

## Root Cause
Schema unification in commit `67547e7c` dropped `special_orders.product` to standardize on `special_orders.medicine_name`. Backend `GET /api/orders` returned database rows with `medicine_name` only. Callers reading `order.product` evaluated `undefined`, causing:
1. `order.product.toLowerCase()` in Reorder Hub to throw a TypeError crash.
2. `order.product || 'Item'` in Quick Assist to render `"Item"`.

## Completed Changes
1. **Backend Route Parity (`src/routes/orders.ts`)**:
   - In `GET /`, mapped `medicine_name AS product` in SQL queries and ensured the response array maps `product: o.medicine_name || o.product || ''` and `medicine_name: o.medicine_name || o.product || ''`.
2. **Frontend Types (`frontend/src/types/api.ts`)**:
   - Updated `SpecialOrder` interface with both `medicine_name?: string` and `product: string`.
3. **Quick Assist Panel (`frontend/src/components/QuickAssistSidebar.tsx`)**:
   - Ensured `order.medicine_name || order.product || 'Medicine'` is used in `groupedSpecialOrders` items, header preview, and unfolded medicine lists.
4. **Reorder Hub View (`frontend/src/pages/PharmarackCart/index.tsx`)**:
   - Guarded against undefined medicine names when looking up pricing and filtering:
     `const orderMedName = (order.medicine_name || order.product || '').trim();`
     `const pricing = orderMedName ? reorderPricingLookup.byName.get(orderMedName.toLowerCase()) : undefined;`
   - Guarded `medicineNameMatches(order.medicine_name || order.product)` and related hooks.
5. **Human-in-the-Loop & Zero-Bugs Verification**:
   - `npm run guardrails` (`tsc --noEmit`) passed with 0 violations.
   - Frontend production build passed cleanly in 55.40s.
   - Updated `SMALL_BUG_FIX_PLAN.md` with P2-144.

## Tasks & Resume Log
- [x] **Task 1: Backend Route Parity in `src/routes/orders.ts`**
  - Completed: `GET /` queries `medicine_name AS product` and normalizes both `product` and `medicine_name` on all returned objects.
- [x] **Task 2: Frontend Types Parity in `frontend/src/types/api.ts`**
  - Completed: Added `medicine_name?: string` to `SpecialOrder` interface while retaining `product: string` for type safety.
- [x] **Task 3: Quick Assist Medicine Display in `frontend/src/components/QuickAssistSidebar.tsx`**
  - Completed: Mapped `order.medicine_name || order.product || 'Medicine'` so special requests display medicine names accurately.
- [x] **Task 4: Reorder Hub Crash Shielding in `frontend/src/pages/PharmarackCart/index.tsx`**
  - Completed: Guarded Special Requests cards with `orderMedName = (order.medicine_name || order.product || '').trim()` and safe pricing lookups across both All Items and Special Requests tabs.
- [x] **Task 5: Guardrails, Knowledge Graph Update & Verification**
  - Completed: `npm run guardrails` exit 0, `npm run build --prefix frontend` built in 55.40s with 0 errors.
