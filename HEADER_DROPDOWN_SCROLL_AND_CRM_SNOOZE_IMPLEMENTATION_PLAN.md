# Implementation Plan: Header Dropdown Scroll Standard & CRM Snooze Engine

> **Master Plan Reference**: [HEADER_DROPDOWN_SCROLL_AND_CRM_SNOOZE_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/HEADER_DROPDOWN_SCROLL_AND_CRM_SNOOZE_PLAN.md)
> **Execution Status**: Completed (Verified & Guardrails Passed)

---

## 1. Objectives & Quality Contracts
1. **Fix CRM Snooze Engine**:
   - Prevent background refill worker `checkAllRefills()` from immediately re-staging snoozed notifications.
   - Record `snoozed_until` timestamp and advance `next_refill_date` when snoozed.
   - Add explicit multi-day Snooze (+1d, +3d, +7d, pick date) actions to CRM Refills patient rows and medicine items.
2. **Standardize All 21 Dropdown Scroll Containers**:
   - Pinned `shrink-0` header outside the scrollable body with solid `bg-bg3`/`bg-bg2` (no scroll bleed, no CPU-stalling backdrop blur).
   - Inner list isolated as `flex-1 min-h-0 overflow-y-auto dropdown-scroll`.
3. **Guardrails & Verification**:
   - Zero TypeScript compiler errors (`tsc --noEmit`).
   - Pass `npm run guardrails`.
   - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## 2. Tasks Breakdown & Execution Progress

### Phase 1: CRM & Refill Snooze Engine
- [x] `Task 1.1`: Add `snoozed_until` column check to [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts) schema migrations.
- [x] `Task 1.2`: Update [src/services/refillService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillService.ts) (`stageRefillCollectionNotifications` and `checkAllRefills`) to respect active snoozes and eliminate the infinite re-staging loop.
- [x] `Task 1.3`: Enhance [src/routes/automation.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/automation.ts) (`/notifications/:id/snooze`, `/group/snooze`, and add `/snooze-patient`) to record `snoozed_until` and emit proper SSE updates.
- [x] `Task 1.4`: Add Snooze dropdown menu (+1d, +3d, +7d) to [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx) patient refill toolbar.

### Phase 2: Dropdown Layout & Scroll Isolation (21 Instances Across 10 Files)
- [x] `Task 2.1`: POS 6 Dropdowns in [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx):
  - Patient Search Autocomplete: Pinned fuzzy header outside `flex-1 min-h-0 overflow-y-auto dropdown-scroll`.
  - Doctor Search Autocomplete: `flex-1 min-h-0 overflow-y-auto dropdown-scroll`.
  - Main Medicine Search Dropdown: Pinned Quick-Add header (`bg-bg3 shrink-0`) + isolated scroll list.
  - Search Results Divide List: Standardized scroll body.
  - Inline Cart Row Search: Pinned custom entry header + isolated scroll list.
  - Inline Cart Row Batch Selector Dropdown: Pinned `Switch Batch` header + isolated scroll list.
- [x] `Task 2.2`: Purchases 4 Dropdowns in [frontend/src/pages/Purchases/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx):
  - Distributor Search Autocomplete: Pinned `Only Mapped` filter header + isolated scroll list.
  - Category / Purchase Filter Dropdown: Standardized.
  - Invoice Item Medicine Search Dropdown: Pinned `Register as New` header + isolated scroll list.
  - Invoice Item Batch Selector Dropdown: Pinned `Old Batches` header + isolated scroll list.
- [x] `Task 2.3`: Returns 2 Dropdowns in [frontend/src/pages/Returns/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Returns/index.tsx): Distributor autocomplete and medicine item autocomplete.
- [x] `Task 2.4`: Investigation 1 Dropdown in [frontend/src/pages/Investigation/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Investigation/index.tsx): Medicine ledger search autocomplete.
- [x] `Task 2.5`: CRM 2 Dropdowns in [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx): Add refill medicine autocomplete and Pharmarack live order results dropdown.
- [x] `Task 2.6`: UniversalMedicineEditModal 2 Dropdowns in [frontend/src/components/UniversalMedicineEditModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/UniversalMedicineEditModal.tsx): Manufacturer suggestions and marketer suggestions.
- [x] `Task 2.7`: QuickOrderModal & LiveCartAddModal in [frontend/src/components/QuickOrderModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickOrderModal.tsx) and [frontend/src/components/LiveCartAddModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx): Live distributor suggestions with pinned header.
- [x] `Task 2.8`: OrderModifyModal & MedicineLinkModal in [frontend/src/components/OrderModifyModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/OrderModifyModal.tsx) and [frontend/src/components/MedicineLinkModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/MedicineLinkModal.tsx): Live candidate distributor linking with pinned header.

### Phase 3: Verification & Guardrails
- [x] `Task 3.1`: Verify backend snooze retention and database consistency.
- [x] `Task 3.2`: Run `npm run guardrails` (Verified: Exit code 0, clean TypeScript compilation, no violations).
- [x] `Task 3.3`: Run `node scripts/quick-update.mjs` (Verified: Knowledge graph updated in 4.2s, 1135 nodes, 571 edges).

