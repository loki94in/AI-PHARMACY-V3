# Implementation Plan: Market Closure Buffer Multi-Medicine Selection & Silent Cart Dispatch

**Created**: 2026-11-08  
**Plan File**: `MARKET_CLOSURE_BUFFER_MULTI_SELECT_CART_FIX_PLAN.md`  
**Target Subsystem**: Market Closure Stock Buffer Review Modal (`ClosureStockBufferModal.tsx`) & Reorder Hub Flow  

---

## 1. Problem Diagnosis & Architecture

### Symptoms
1. **Intrusive Nested Popup on Single Row Click**: In `ClosureStockBufferModal.tsx:495`, clicking `+ Live Cart ({qty})` invoked `startRefillCartJob` with default options, causing `options.openModal !== false` to open the full `RefillCartModal` as a floating popup on top of the already-open review modal.
2. **Abrupt Premature Modal Exit on Bulk Add**: In `handleAddToCart`, `onClose()` was called immediately after `api.addClosureBufferToCart(payload)` regardless of outcomes. If items failed or required distributor linking, the modal vanished, leaving only transient toasts and giving pharmacists no way to review or link the unlinked items in-place.
3. **Lack of Pre-Flight Transparency for Multiple Medicines**: Pharmacists selecting multiple buffer items were not shown an advance breakdown of how many selected medicines were linked to Pharmarack distributors versus unlinked (which divert to Special Orders).
4. **Disjointed Multi-Patient UX**: The row-level `+ Live Cart` button only dispatched a single item for that row's patient; pharmacists selecting multiple medicines across different patients had no clear, non-intrusive feedback when dispatching them.

---

## 2. Surgical Solution Architecture

### In `frontend/src/components/ClosureStockBufferModal.tsx`:
1. **Silent Background Execution on Row-Level Cart**:
   - Update line 495 to pass `{ openModal: false }` to `startRefillCartJob`:
     ```ts
     startRefillCartJob(item.patient_name || 'Patient Refill', [
       { refillId: item.refill_id, medicineId: item.medicine_id, medicineName: item.medicine_name, qty: qtyToOrder }
     ], { openModal: false });
     ```
   - Prevents duplicate nested modal popups over `ClosureStockBufferModal`.
2. **Pre-Flight Linking Awareness**:
   - Calculate `unlinkedCount` and `linkedCount` from currently selected items.
   - In the modal footer, display an informative badge if any selected medicines lack a distributor link (e.g. `⚠️ {unlinkedCount} unlinked (will stage in Special Orders)`), ensuring complete transparency before clicking.
3. **Smart Modal Retention on Partial / Needs-Link Outcomes**:
   - In `handleAddToCart`:
     - If all selected items successfully reached the live cart (`res.addedCount + res.inCartCount === selectedCount` with 0 needs_link/failed), notify and close cleanly via `onClose()`.
     - If any items needed linking (`res.needsLinkCount > 0`) or failed (`res.failedCount > 0`), do **NOT** close the modal. Keep it open, refresh the buffer checklist via `fetchBuffer()`, and allow the pharmacist to review which items remain and click `🔗 Link distributor` directly in the modal.
   - Add a clean "Close" button in the footer for explicit manual dismissal.
4. **Human-in-the-Loop Contract**:
   - The pharmacist retains complete manual control over quantity adjustments, distributor linking, and final order submission.
5. **DOX & Guardrails**:
   - Zero raw Tailwind colors, strict semantic tokens (`bg-bg`, `text-text`, `border-border`), no GPU rendering violations.

---

## 3. Execution Tasks

- [x] **Task 1**: Update `frontend/src/components/ClosureStockBufferModal.tsx` to pass `{ openModal: false }` to `startRefillCartJob`.
- [x] **Task 2**: Add pre-flight linking statistics (`unlinkedSelectedCount`) and smart post-submission modal retention in `ClosureStockBufferModal.tsx`.
- [x] **Task 3**: Add explicit "Close" button and pre-flight unlinked warning chip in modal footer.
- [x] **Task 4**: Verify TypeScript build (`tsc --noEmit`) and run `npm run guardrails` (Passed with 0 violations).
- [x] **Task 5**: Verify frontend production build (`npm run build --prefix frontend` built cleanly in 46.77s).
- [x] **Task 6**: Update knowledge graph via `node scripts/quick-update.mjs` (Synchronized across 1500 nodes).
- [x] **Task 7**: Produce Final Verification & Audit Summary.

---

## 4. Completed Work & Audit Record

1. **Non-Intrusive Row-Level Dispatch**:
   - In [`ClosureStockBufferModal.tsx:505`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/ClosureStockBufferModal.tsx#L505), updated `startRefillCartJob` to explicitly supply `{ openModal: false }`.
   - Clicking `+ Live Cart` on individual medicine shortfall rows now runs smoothly in the background without popping open an intrusive nested `RefillCartModal` on top of the review modal.
2. **Pre-Flight Transparency for Multiple Selected Medicines**:
   - Calculated `unlinkedSelectedCount` reactively from the selected items list.
   - When any selected medicines lack a distributor link (`linked_distributors_count === 0`), a clear badge is rendered in the action footer: `⚠️ {unlinkedSelectedCount} unlinked (stages in Special Orders)`.
   - Pharmacists are now fully informed before submitting what will go directly into the Live Cart versus what will be staged in Special Orders for manual distributor mapping.
3. **Smart Modal Retention on Partial Outcomes**:
   - In `handleAddToCart`, replaced the unconditional `onClose()` exit:
     - If all items succeeded into the live cart (`res.addedCount + res.inCartCount === selectedCount` with 0 unlinked or failed items), the modal closes cleanly.
     - If any items needed linking (`res.needsLinkCount > 0`) or failed stock check (`res.failedCount > 0`), the modal **remains open** and calls `fetchBuffer()` to refresh the checklist with latest cart states. The pharmacist can immediately click `🔗 Link distributor` on the unlinked medicines to map them with zero disruption.
   - Added an explicit `Close` button in the footer for graceful dismissal at any time.
4. **Verification**:
   - `npm run guardrails` passed with exit code 0 (`tsc --noEmit` clean, zero semantic color or GPU violations).
   - Production bundle built cleanly via `vite build` in 46.77s.
   - Knowledge graph updated via `node scripts/quick-update.mjs`.

