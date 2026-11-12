# UNLOCK REFILL MEDICINE SELECTION & LIVE CART ADDING IMPLEMENTATION PLAN

## Goal
Remove all artificial locks and disabled states in the UI and backend that prevent a user/pharmacist from manually selecting and adding a refill medicine to the Pharmarack live cart, even if that medicine was already completed, fulfilled earlier today, or marked ordered.

## Root Causes Identified
1. **Frontend Hard-Lock (`frontend/src/components/RefillOrderModal.tsx`)**:
   - `isCycleDuplicateLocked(m)` calls `isRefillActuallyFulfilled(m)`.
   - The checkbox is set to `disabled={isDuplicateLocked}` with `cursor-not-allowed`.
   - The card click handler guards with `!isDuplicateLocked && toggleSelect(med.id)`.
   - "Select All" ignores locked medicines (`activeMeds.filter(m => !isCycleDuplicateLocked(m))`).
2. **Backend Guard Failure (`src/services/refillCartService.ts`)**:
   - Line 327 blocks `completed`, `fulfilled`, or `is_active === 0` refills from adding to cart:
     `if (refill.is_active === 0 || ['completed', 'canceled', 'cancelled', 'paused'].includes(String(refill.status || '').toLowerCase())) return { status: 'failed', message: 'Refill is already completed or inactive.' };`
   - Prevents manual add-to-cart requests for fulfilled/completed cycle refills.
3. **CRM Refill Modal Filtering (`frontend/src/pages/CRM/RefillsSection.tsx`)**:
   - `handleOrderRefillShortages` and `handleConfirmRefillPatient` filter out medicines whose `status === 'completed'` or `status === 'canceled'`, preventing them from showing in the modal when the user wants to re-order.

## Tasks
- [x] **Task 1**: Update `frontend/src/components/RefillOrderModal.tsx`:
  - Always allow selecting any medicine: removed `isCycleDuplicateLocked` from disabling checkboxes, blocking row clicks, or restricting "Select All".
  - Retained informational status chips ("Fulfilled", "In Live Cart", "Shortage") for clarity, but the checkbox and card are always interactive and selectable.
- [x] **Task 2**: Update `src/services/refillCartService.ts`:
  - Removed artificial block on `completed` or `fulfilled` refills when the pharmacist manually requests adding them to the live cart.
- [x] **Task 3**: Update `frontend/src/pages/CRM/RefillsSection.tsx`:
  - Ensured patient medicines can be opened in `RefillOrderModal` for re-ordering or extra cycle needs without being blocked by prior fulfillment state.
- [x] **Task 4**: Verify and test:
  - Guardrails passed (`npm run guardrails` exit 0, `tsc --noEmit` OK).
  - Frontend production build succeeded (`npm run build:client` exit 0).
  - Ran `node scripts/quick-update.mjs` to keep knowledge graph up-to-date.
