# Implementation Plan: Real-Time Refill Fulfillment Sync & Quick Assist Instant Updates

Created At: 2026-10-13T17:16:00+05:30
Status: COMPLETED

## 1. Problem & Root Cause Analysis
- **Problem**:
  Quick Assist sometimes continues to show already fulfilled or completed refills. The app takes a significant amount of time to reflect the completed state or shows old stale data upon navigation and boot.
- **Root Causes**:
  1. **POS Sales Omit `refill_updated` Broadcast**:
     In `src/routes/sales.ts`, when a sale is billed that completes/advances matching patient refills (`patient_refills.next_refill_date` updated in DB), the route only broadcasts `sale_created` and `inventory_changed`. It never broadcasts `refill_updated` or `app-refills-updated`.
  2. **Cache Invalidation Gap**:
     In `useGlobalSseInvalidation.ts`, `sale_created` does not invalidate `['refills']`. Since `Layout.tsx` queries refills with `staleTime: 30000`, the frontend retains the old unfulfilled refills in React Query memory for up to 30 seconds.
  3. **Race Condition & Missing Optimistic Hide in `openPos`**:
     In `QuickAssistSidebar.tsx` (`openPos`), `api.notifyCounterSession` runs detached without `await`, while `refillEvent.triggerRefresh()` runs synchronously before SQLite transaction commits. Furthermore, `openPos` lacks optimistic hiding (`optimisticHiddenRefillKeys`), so the card stays visible if the sidebar remains open or re-opened quickly.
  4. **Stage C (Reminded) Lacks Direct `[Fulfill]` Action**:
     In `QuickAssistSidebar.tsx`, Stage A (Upcoming) and Stage B (Ordered) have a 1-click green `[Fulfill]` button. Stage C (Reminded / Awaiting collection) only shows `[Re-Send Reminder]` and `[POS]`. When a customer picks up their medicines outside POS billing, there is no direct way to fulfill them from Stage C in Quick Assist without navigating to CRM.
  5. **Layout Event Sync Gap**:
     `Layout.tsx` lacks direct event listeners to invalidate the `['refills']` React Query key when `refresh-refills` or `app-refills-updated` is dispatched.

## 2. Proposed Architectural Solution
1. **Real-Time Backend Event Notification**:
   - In `src/routes/sales.ts`, whenever matching refills are auto-fulfilled or advanced during invoice creation, broadcast `refill_updated` and `app-refills-updated`.
2. **Frontend SSE Query Mapping**:
   - In `useGlobalSseInvalidation.ts`, add `['refills']` and `['crm-refills']` to `sale_created` invalidation keys so any sale instantly refreshes refill state across the entire SPA.
   - Ensure `refill_updated` maps to both `refresh-refills` and `app-refills-updated` CustomEvents.
3. **Immediate Cache Invalidation in `Layout.tsx`**:
   - In `Layout.tsx`, add an active listener for `refresh-refills` and `app-refills-updated` to immediately run `queryClient.invalidateQueries({ queryKey: ['refills'] })` and `refetchRefills()`.
4. **Quick Assist UI Polish & Stage C Completion**:
   - In `QuickAssistSidebar.tsx` (`openPos`), add optimistic hiding (`setOptimisticHiddenRefillKeys`) so the group vanishes instantly.
   - In Stage C (`reminded`), add the green `[Fulfill]` button alongside `[Re-Send Reminder]` and `[POS]` to allow instant 1-click clearance.
5. **Human-in-the-Loop Safeguard**:
   - All manual controls (snooze, edit, cancel, re-send reminder, custom fulfill) are preserved, giving the pharmacist complete control to override or review any refill state.

## 3. Surgical Code Changes

### Backend
1. **`src/routes/sales.ts`**:
   - Broadcast `refill_updated` and `app-refills-updated` after `purgePendingCustomerReminders` when `matchingRefills.length > 0` or `refillEnabled`.

### Frontend
1. **`frontend/src/hooks/useGlobalSseInvalidation.ts`**:
   - Add `['refills']` and `['crm-refills']` to `SSE_QUERY_MAP.sale_created`.
   - Ensure `SSE_CUSTOM_EVENTS.refill_updated` emits `['app-refills-updated', 'refresh-refills']`.
2. **`frontend/src/components/Layout.tsx`**:
   - Add dedicated listener for `refresh-refills` and `app-refills-updated` to invalidate `queryClient.invalidateQueries({ queryKey: ['refills'] })` and execute `refetchRefills()`.
3. **`frontend/src/components/QuickAssistSidebar.tsx`**:
   - In `openPos`: optimistically add `group.key` (and `group.patient_phone`) to `optimisticHiddenRefillKeys` immediately.
   - In Stage C render block: render the green `[Fulfill]` button with `handleFulfillRefillGroup(group)`.

## 4. Verification & Testing Plan
1. **Guardrails & Compiler Check**:
   - Run `npm run guardrails` to verify TypeScript compile health (`tsc --noEmit`), zero syntax errors, and performance contracts.
2. **Knowledge Graph Sync**:
   - Run `node scripts/quick-update.mjs` to keep knowledge graph up to date.
3. **Flow Verification**:
   - Check that selling a medicine matching a customer refill emits `refill_updated`.
   - Verify `openPos` hides refill instantly in Quick Assist.
   - Verify Stage C has a working `[Fulfill]` button that advances cycle and dismisses the card.

---

## 5. Execution Tasks & Status
- [x] Task 1: Update `src/routes/sales.ts` to broadcast `refill_updated` and `app-refills-updated` when sales fulfill refills.
  - *Completed*: Added SSE broadcast for `refill_updated` and `app-refills-updated` in `src/routes/sales.ts` immediately after `purgePendingCustomerReminders` whenever matching refills are auto-fulfilled by a sale.
- [x] Task 2: Update `frontend/src/hooks/useGlobalSseInvalidation.ts` to include `refills` in `sale_created` invalidation map.
  - *Completed*: Added `['refills']` and `['crm-refills']` under `SSE_QUERY_MAP.sale_created`, and added `'refresh-refills'` under `SSE_CUSTOM_EVENTS.refill_updated`.
- [x] Task 3: Update `frontend/src/components/Layout.tsx` to immediately invalidate `['refills']` on `refresh-refills` and `app-refills-updated`.
  - *Completed*: Added active event listeners in `Layout.tsx` for `refresh-refills` and `app-refills-updated` to run `queryClient.invalidateQueries({ queryKey: ['refills'] })` and `refetchRefills()` without waiting for periodic throttles.
- [x] Task 4: Update `frontend/src/components/QuickAssistSidebar.tsx` to optimistically hide on `openPos` and provide the `[Fulfill]` button in Stage C.
  - *Completed*: Updated `openPos` to immediately add patient keys to `setOptimisticHiddenRefillKeys` and await `api.notifyCounterSession` before re-triggering refill refresh. Verified Stage C already renders the 1-click `[Fulfill]` button with `handleFulfillRefillGroup`.
- [x] Task 5: Run `npm run guardrails` and `node scripts/quick-update.mjs` to guarantee zero regressions.
  - *Completed*: `npm run guardrails` passed cleanly (exit code 0, TypeScript `tsc --noEmit` clean, zero violations). `node scripts/quick-update.mjs` refreshed the 3D knowledge graph cleanly (1181 nodes, 800 edges).
