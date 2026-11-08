# Implementation Plan: Market Closure Buffer On-Screen Background Progress Card

**Created**: 2026-11-08  
**Plan File**: `MARKET_CLOSURE_BUFFER_ON_SCREEN_PROGRESS_CARD_PLAN.md`  
**Target Subsystem**: Market Closure Stock Buffer Review Modal (`ClosureStockBufferModal.tsx`) & Floating Card Host (`RefillCartJobHost` / `refillCartJobs.ts`)  

---

## 1. Problem Diagnosis & Architecture

### Symptoms
- When the pharmacist clicks "Add Selected ({N}) to Cart" in the **Market Closure Stock Buffer Review** modal, the modal closes, but **no background process card appears on the screen**.
- The pharmacist is left wondering whether the items are actually being processed or if the action was dropped.

### Root Cause
- The bulk "Add Selected to Cart" button was previously calling a raw backend API endpoint (`api.addClosureBufferToCart`), which executed invisibly inside Node.js.
- Because it bypassed the app's frontend job store (`refillCartJobs`), the screen's floating card manager (`RefillCartJobHost` in `RefillCartModal.tsx`) was never notified of the job and had nothing to render.

### Solution Architecture
- Connect the bulk "Add Selected to Cart" button directly to the app's established `startRefillCartJob('Market Closure Buffer', selectedItems, { openModal: false })`.
- This immediately registers the multi-medicine job in `refillCartJobs`, causing `RefillCartJobHost` to mount the floating progress card at `fixed top-16 right-6`.
- The pharmacist sees the live step-by-step progress on their screen:
  1. Card appears: `[Spinner] Adding refill to cart — Market Closure Buffer (0/N)`
  2. Live updates per item: `Checking stock...` ➔ `✓ Added to [Distributor] × [Qty]`
  3. Real-time counter: `1/N`, `2/N`, `N/N`
  4. Final summary checkmarks and in-app completion toast
- Modal closes with 0ms waiting time; full on-screen visibility is guaranteed.

---

## 2. Execution Tasks

- [x] **Task 1**: Update `frontend/src/components/ClosureStockBufferModal.tsx` to dispatch bulk buffer items via `startRefillCartJob('Market Closure Buffer', selectedRefillInputs, { openModal: false })`.
- [x] **Task 2**: Verify TypeScript compilation (`tsc --noEmit`) and run `npm run guardrails` (Passed with 0 violations).
- [x] **Task 3**: Verify frontend production build (`npm run build --prefix frontend` built cleanly in 56.59s).
- [x] **Task 4**: Synchronize knowledge graph via `node scripts/quick-update.mjs` (Synchronized across 1502 nodes).
- [x] **Task 5**: Produce Final Verification & Audit Summary.

---

## 3. Completed Work & Audit Record

1. **Integrated with On-Screen Progress Card (`RefillCartJobHost`)**:
   - In [`ClosureStockBufferModal.tsx:177-205`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/ClosureStockBufferModal.tsx#L177-L205), connected `handleAddToCart` directly to `startRefillCartJob('Market Closure Buffer', selectedRefillInputs, { openModal: false })`.
   - Bypassing the raw invisible backend endpoint ensures the job is registered directly with `refillCartJobs` store.
2. **Visible Live Feedback on Screen**:
   - Clicking **"Add Selected ({N}) to Cart"** instantly mounts the floating progress card at `fixed top-16 right-6`.
   - The pharmacist sees the live counter (`Adding refill to cart — Market Closure Buffer (0/N)`) and watches each medicine progress step-by-step (`Waiting...` ➔ `Checking stock...` ➔ `✓ Added to [Distributor] × [Qty]`).
   - Modal closes with 0ms delay while progress remains 100% visible on screen.
3. **Verification**:
   - `npm run guardrails` exit 0 (clean `tsc --noEmit`, speed architecture preserved).
   - Frontend bundle built cleanly via `vite build` in 56.59s with 0 errors.
   - Knowledge graph updated across 1502 nodes via `node scripts/quick-update.mjs`.

