# Active Implementation Plan: Header Dropdown Scroll Standard & CRM Snooze Engine

> **Master Specification**: [HEADER_DROPDOWN_SCROLL_AND_CRM_SNOOZE_IMPLEMENTATION_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/HEADER_DROPDOWN_SCROLL_AND_CRM_SNOOZE_IMPLEMENTATION_PLAN.md)
> **Goal**: 
> 1. Fix CRM Snooze Engine so snoozing notifications and refill alerts permanently sticks without background worker re-staging loops.
> 2. Standardize all 21 dropdown scrolling containers across 10 files into invariant 2-tier frames (pinned `shrink-0` header + `flex-1 min-h-0 overflow-y-auto dropdown-scroll` body).
> **Status**: COMPLETED & VERIFIED (Passes `npm run guardrails` and quick-update sync)

---

## 1. Status & Work Breakdown

### Phase 1: CRM & Refill Snooze Engine
- [x] `Task 1.1`: Add `snoozed_until` column check to [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts) schema migrations.
- [x] `Task 1.2`: Update [src/services/refillService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillService.ts) (`stageRefillCollectionNotifications` and `checkAllRefills`) to respect active snoozes and eliminate the infinite re-staging loop.
- [x] `Task 1.3`: Enhance [src/routes/automation.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/automation.ts) (`/notifications/:id/snooze`, `/group/snooze`, and add `/snooze-patient`) to record `snoozed_until` and emit proper SSE updates.
- [x] `Task 1.4`: Add Snooze dropdown menu (+1d, +3d, +7d) to [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx) patient refill toolbar.

### Phase 2: Dropdown Layout & Scroll Isolation (21 Instances Across 10 Files)
- [x] `Task 2.1`: POS 6 Dropdowns in [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx).
- [x] `Task 2.2`: Purchases 4 Dropdowns in [frontend/src/pages/Purchases/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx).
- [x] `Task 2.3`: Returns 2 Dropdowns in [frontend/src/pages/Returns/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Returns/index.tsx).
- [x] `Task 2.4`: Investigation 1 Dropdown in [frontend/src/pages/Investigation/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Investigation/index.tsx).
- [x] `Task 2.5`: CRM 2 Dropdowns in [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx).
- [x] `Task 2.6`: UniversalMedicineEditModal 2 Dropdowns in [frontend/src/components/UniversalMedicineEditModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/UniversalMedicineEditModal.tsx).
- [x] `Task 2.7`: QuickOrderModal & LiveCartAddModal in [frontend/src/components/QuickOrderModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/QuickOrderModal.tsx) and [frontend/src/components/LiveCartAddModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx).
- [x] `Task 2.8`: OrderModifyModal & MedicineLinkModal in [frontend/src/components/OrderModifyModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/OrderModifyModal.tsx) and [frontend/src/components/MedicineLinkModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/MedicineLinkModal.tsx).

### Phase 3: Verification & Guardrails
- [x] `Task 3.1`: Verify backend snooze retention and database consistency.
- [x] `Task 3.2`: Run `npm run guardrails` (PASS — 0 errors, clean TypeScript build).
- [x] `Task 3.3`: Run `node scripts/quick-update.mjs` (PASS — knowledge graph synchronized).

