# Implementation Plan: Early Refill Visibility (Plan 1) & Refill Queue Order + WhatsApp Inquiry Visibility (Plan 2)

**Goal:**
1. **Plan 1 (Early Refill Visibility):** Ensure refills ordered early in CRM (`cart_store_name IS NOT NULL` or `status = 'ordered'`) remain visible in Quick Assist regardless of due date with an "Early · due in Nd" chip.
2. **Plan 2 (Queue Order & Inquiry Separation):**
   - **Part A:** Isolate unapproved WhatsApp Inquiries (`status = 'Inquiry'`) into dedicated "Inquiries (Needs Approval)" sections in both Quick Assist and CRM Special Orders (never mixed into active orders).
   - **Part B:** Re-order refill queues so patients whose cycles are handled/completed today sink to the bottom under "Completed today — awaiting POS" instead of blocking the top of the queue.

---

## Task Checklist & Execution Sequence

### Phase 1: Plan 1 — Early Refill Visibility in Quick Assist
- [x] Task 1.1: Backend `src/routes/refills.ts` (`GET /panel`): extended `upcoming_days` filter to also include early-ordered rows (`OR pr.cart_store_name IS NOT NULL OR pr.status = 'ordered'`).
- [x] Task 1.2: Frontend `frontend/src/components/QuickAssistSidebar.tsx`: updated `actionableRefills` filter to allow rows when `diffDays <= 7 || r.status === 'ordered' || Boolean(r.cart_store_name)`.
- [x] Task 1.3: Frontend `QuickAssistSidebar.tsx`: added `'Early'` timingCategory and rendered `"Early · due in Nd"` chip when `diffDays > 7` on ordered refill groups.
- [x] Task 1.4: Verified Phase 1 with `tsc --noEmit` and guardrails.

### Phase 2: Plan 2A — WhatsApp Inquiries Visibility & Isolation
- [x] Task 2.1: `frontend/src/pages/CRM/SpecialOrdersSection.tsx`:
  - In `statusFilter === 'All'`, excluded `status === 'Inquiry'`.
  - Added `Inquiries (N)` count to tab strip with amber highlight when `N > 0`.
  - Added informational review banner when inquiries exist while viewing 'All'.
  - Added URL parameter synchronization (`?filter=inquiries`) from Quick Assist.
- [x] Task 2.2: `frontend/src/components/QuickAssistSidebar.tsx`:
  - Excluded `s.status === 'Inquiry'` from `activeSpecialOrders`.
  - Created `inquirySpecialOrders` and `groupedInquiries`.
  - Rendered dedicated `Inquiries (Needs Approval) · N` section with Approve/POS/Dismiss actions.
  - Added separate `Inquiries: N` violet badge in collapsed view.
- [x] Task 2.3: `frontend/src/components/LiveCartAddModal.tsx`: verified unapproved `Inquiry` rows are excluded from order placement lists (`['Pending', 'Waiting'].includes(o.status)`).

### Phase 3: Plan 2B — Refill Queue Ordering (Completed Today Sinks to Bottom)
- [x] Task 3.1: `frontend/src/utils/refillSettled.ts`:
  - Added `isRefillHandledToday(m)` = `isRefillFulfilledToday(m) || m.status === 'completed' || m.status === 'fulfilled'`.
  - Exported `sortRefillGroups` and `compareRefillGroups`: handled-today groups sorted to the bottom, active groups sorted by `diffDays` ascending.
- [x] Task 3.2: `frontend/src/components/QuickAssistSidebar.tsx`:
  - Included `last_refill_date` in `groupedActionableRefills` medicine objects.
  - Marked completed-today groups `handled = true` and kept them in the list.
  - Sorted actionable refill groups using `sortRefillGroups`.
  - Rendered bottom group section `"Completed today — awaiting POS"` for handled rows with 1-click POS billing navigation.
  - Added bypass in `handleCompleteRefillGroup` for handled rows to open POS without cycle block or duplicate fulfillment.
- [x] Task 3.3: `frontend/src/pages/CRM/RefillsSection.tsx`:
  - Applied `sortRefillGroups` to master refill list so completed-today patients sink to the bottom.

### Phase 4: Full Verification & Documentation
- [x] Task 4.1: Ran `npx tsc -p frontend/tsconfig.app.json --noEmit` (exit 0) and root `npx tsc --noEmit` (exit 0).
- [x] Task 4.2: Ran `npm test -- tests/whatsappDualRefillSpecialOrderFlow.test.ts` (5/5 passed).
- [x] Task 4.3: Ran `npm run guardrails` (exit 0, clean build, 0 violations).
- [x] Task 4.4: Updated `frontend/AGENTS.md` DOX contract.
- [x] Task 4.5: Updated `SMALL_BUG_FIX_PLAN.md` with Fixed entries `[Fixed] P2-102` and `[Fixed] P2-103`.
- [x] Task 4.6: Ran `node scripts/quick-update.mjs` to synchronize knowledge graph.

---

## Completed Work Log & Verification Results

1. **Backend Route Update (`src/routes/refills.ts`):**
   - Modified `GET /panel` query in line 711 so that queries requesting upcoming refills within `N` days (default 7) also retrieve early-ordered refills: `(pr.next_refill_date <= date('now', '+' || ? || ' days') OR pr.cart_store_name IS NOT NULL OR pr.status = 'ordered')`.

2. **Refill Settlement & Sorting Engine (`frontend/src/utils/refillSettled.ts`):**
   - Added `isRefillHandledToday(m)` and `isPatientHandledToday(meds)`.
   - Added `compareRefillGroups` and `sortRefillGroups` ensuring handled-today patients sink to the bottom, while active patients are strictly sorted by `diffDays` ascending.

3. **Quick Assist Sidebar (`frontend/src/components/QuickAssistSidebar.tsx`):**
   - Retained early-ordered and handled-today refills in `actionableRefills`.
   - Updated timing category to include `'Early'` and rendered `"Early · due in Nd"` chip with a sky left border when `diffDays > 7`.
   - Partitioned actionable refills: active refills render with standard stage buttons (`Stage A/B/C`), while handled-today refills appear in a dedicated bottom section (`Completed today — awaiting POS`) with a 1-click POS billing button.
   - Guarded `handleCompleteRefillGroup`: when clicking POS on a handled-today patient, directly navigates to POS prefilled with medicines without re-triggering fulfillment or hitting cycle blocks.
   - Isolated customer inquiries (`status === 'Inquiry'`) out of `activeSpecialOrders` into a dedicated `Inquiries (Needs Approval)` section with `Approve & Order`, `POS`, and `Dismiss` actions.
   - Added violet `inquiryOrdersCount` badge in collapsed sidebar mode.

4. **CRM Special Orders (`frontend/src/pages/CRM/SpecialOrdersSection.tsx`):**
   - Excluded `o.status === 'Inquiry'` when `statusFilter === 'All'`.
   - Added count badge on `Inquiries` tab button when unapproved inquiries exist.
   - Added top review banner on `All` tab: `"You have N customer inquiries awaiting approval." [Review Inquiries]`.
   - Added URL parameter listener to automatically activate the Inquiries tab when navigated with `?filter=inquiries`.

5. **CRM Refills (`frontend/src/pages/CRM/RefillsSection.tsx`):**
   - Applied `sortRefillGroups` to `filtered` patient list, ensuring patients whose refills were fulfilled today sink to the bottom of the list.

6. **Automated Verification:**
   - Frontend TypeScript check (`npx tsc -p frontend/tsconfig.app.json --noEmit`): exit 0.
   - Backend TypeScript check (`npx tsc --noEmit`): exit 0.
   - Test suite (`npm test -- tests/whatsappDualRefillSpecialOrderFlow.test.ts`): 5/5 passed.
   - Performance Guardrails (`npm run guardrails`): exit 0 (0 violations, clean speed architecture).
