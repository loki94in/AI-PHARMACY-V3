# FAST SMOOTH QA LIVE CART IMPLEMENTATION PLAN

## Objective
Make adding medicines to the Pharmarack Live Cart from the Quick Assist (QA) panel faster, smoother, and direct, with **zero new buttons** introduced in the app or QA panel.

## Key Directives & Constraints
1. **Zero New Buttons**: No new buttons or layout changes in the QA sidebar or modal.
2. **Instant Open**: Avoid blocking/heavy full-database queries on modal trigger (`handleOrderRefillGroupToCart`).
3. **Instant Modal Dismiss**: When the pharmacist clicks "Add to Cart" in the existing popup, the modal closes immediately, letting the user continue without waiting for the network requests to finish.
4. **Smooth Background Execution**: The live cart job queue executes sequentially in the background (`startRefillCartJob`), and UI updates are batched without duplicate refetches or UI flicker.
5. **Zero Intermediate Staging**: Bypasses any lingering "In QA" status — direct transition to Live Cart with green `In Cart` badge.
6. **Guardrails**: Must pass `npm run guardrails` cleanly with exit code 0.

---

## Architectural Changes

### 1. `frontend/src/components/QuickAssistSidebar.tsx`
- In `handleOrderRefillGroupToCart`:
  - Instantly set `setRefillOrderModalGroup(group)` using the in-memory `group.medicines`.
  - Remove the un-throttled, unneeded full-panel fetch `api.getRefillsPanel({})` that ran on every click.
  - Smooth modal opening with zero lag.

### 2. `frontend/src/components/RefillOrderModal.tsx`
- In `handleUpdateCart`:
  - Instant dismissal: Immediately call `onClose()` and trigger toast feedback.
  - Dispatch `startRefillCartJob` with selected items and quantities.
  - Clean up any legacy staging text in tooltips/badges so items smoothly indicate "In Live Cart".

### 3. `frontend/src/services/refillCartJobs.ts`
- Consolidate and debounce cache invalidation in `runRow` and `sendSummaryIfDone`:
  - Prevent duplicate rapid-fire calls to `queryClient.invalidateQueries` and `refillEvent.triggerRefresh()` after every single row.
  - Smooth SSE and event propagation.

---

## Task Progress Tracker

- [x] Task 1: Optimize `handleOrderRefillGroupToCart` in `frontend/src/components/QuickAssistSidebar.tsx` for instant opening.
  - *Completed*: Prevented redundant unconditioned full-database CRM panel refetch on modal open. In-memory patient group medicines render instantly with zero lag or mid-interaction re-renders.
- [x] Task 2: Streamline `handleUpdateCart` in `frontend/src/components/RefillOrderModal.tsx` for instant modal close and direct cart submission.
  - *Completed*: Immediate `onClose()` dismisses the popup instantly without waiting on network queries; background job handles live cart addition smoothly and asynchronously. Removed confusing "waiting for approval" tooltips.
- [x] Task 3: Consolidate event triggers and query invalidations in `frontend/src/services/refillCartJobs.ts`.
  - *Completed*: Eliminated redundant duplicate `invalidateQueries` calls on intermediate rows. Batched the final query refresh once all rows in a job finish, preventing eager refetch storms and UI jitter.
- [x] Task 4: Run verification tests and `npm run guardrails`.
  - *Completed*: `tsc --noEmit` and performance guardrails passed with exit code 0.
- [x] Task 5: Auto-update knowledge graph (`node scripts/quick-update.mjs`).
  - *Completed*: Knowledge graph updated (1610 nodes, 913 edges).

---
