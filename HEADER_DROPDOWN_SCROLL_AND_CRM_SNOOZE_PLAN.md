# Comprehensive Architecture Plan: Header & Dropdown Scroll Fixes + CRM Snooze Engine

> **Master Tracking File**: `HEADER_DROPDOWN_SCROLL_AND_CRM_SNOOZE_PLAN.md`
> **Associated Implementation Plan**: `implementation.md`
> **Status**: DISCUSSION & ARCHITECTURAL REVIEW (Code changes gated on user "IMPLEMENT" command)

---

## 1. Problem Statement & Executive Summary

The user reported two key issues in the application:
1. **Dropdown List & Header Scroll Overlap**: In dropdown lists and autocomplete menus, headers and scrollable content occasionally overlap, jitter, or bleed into one another during scrolling, preventing smooth navigation.
2. **CRM Snooze Not Working ("SMNOOZ")**: When snoozing reminders or refill alerts in CRM / Quick Assist, the snooze does not stick and immediately reappears in staged queues.

---

## 2. Deep Root-Cause Trace

### Part A: Header & Scroll Overlap in Dropdown Lists
1. **Unseparated Scroll Containers in Autocomplete Shells**:
   - In several dropdowns (e.g., POS main search, POS inline row search, Purchases batch selector, CRM customer search), the search/filter header or action bar is inside the scrolling container (`overflow-y-auto`) rather than structured as a pinned `shrink-0` header above an isolated `flex-1 min-h-0 overflow-y-auto` list.
   - When users scroll down, items scroll directly behind/over the header or the scrollbar covers header action buttons.
2. **Sticky Header Z-Index & Backdrop Bleed**:
   - Table headers (`thead.sticky.top-0`) and dropdown headers using `backdrop-blur` without opaque background fills (`bg-bg2` / `bg-bg3`) allow scrolled text to show through the header while scrolling.
   - In software-rendered Electron environments (GPU-disabled), `backdrop-blur` on scrolling lists also causes CPU paint stalls.
3. **Table Row Dropdown Boundary Clipping**:
   - In `POS/index.tsx` and `Purchases/index.tsx`, row-level dropdowns rendered inside `overflow-x-auto` table containers conflict with table header z-indices (`z-10` vs `z-20` vs `z-dropdown`).

### Part B: CRM Snooze Engine Failure
1. **Re-staging Loop in Refill Service**:
   - When a notification is snoozed via `POST /api/automation/notifications/:id/snooze` or `/group/snooze`, its database record is updated to `status = 'snoozed'` and the patient refill's `next_refill_date` is incremented by `+1 day`.
   - However, the background worker `checkAllRefills()` queries:
     ```sql
     SELECT id FROM automation_notifications 
     WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?)
     ```
   - Since the existing notification is marked `'snoozed'`, `checkAllRefills()` finds 0 `'staged'` notifications.
   - Because `next_refill_date` (+1 day) is still within the `noticeDays` window (default: 3 days), `checkAllRefills()` immediately runs `INSERT INTO automation_notifications ... status = 'staged'`, recreating the exact reminder as 'staged' within seconds of being snoozed!
2. **Missing Snooze Lead-Time Gate**:
   - `patient_refills` lacks a `snoozed_until` timestamp column or explicit notification snooze expiration check in `refillService.ts`.
3. **UI Snooze Capability Gap in CRM**:
   - In `frontend/src/pages/CRM/index.tsx`, the patient refills panel only has a binary "⏸️ Pause" toggle without multi-day snooze options (1d, 3d, 7d, custom date), leading to confusion between Quick Assist and CRM views.

---

## 3. Codebase Census & Inventory

### All Dropdown Scroll Lists in the Application (21 Instances Across 10 Files):
1. `frontend/src/pages/POS/index.tsx`:
   - Patient Search Autocomplete (Line 4224)
   - Doctor Search Autocomplete (Line 4417)
   - Main Medicine Search Dropdown with Quick-Add Header & Alternatives (Line 4691)
   - Search Results Divide List (Line 4782)
   - Inline Cart Row Medicine Search Dropdown with Manual-Entry Header (Line 5458)
   - Inline Cart Row Batch Selector Dropdown (Line 5629)
2. `frontend/src/pages/Purchases/index.tsx`:
   - Distributor Search Autocomplete (Line 3236)
   - Multi-category / Purchase Filter Dropdown (Line 3490)
   - Invoice Item Medicine Search Dropdown with Header (Line 3923)
   - Invoice Item Batch Dropdown (Line 4092)
3. `frontend/src/pages/Returns/index.tsx`:
   - Distributor Return Autocomplete (Line 1907)
   - Item Search Autocomplete (Line 2288)
4. `frontend/src/pages/Investigation/index.tsx`:
   - Medicine Ledger Search Autocomplete with Header (Line 1376)
5. `frontend/src/pages/CRM/index.tsx`:
   - Medicine Autocomplete in Add Refill modal (Line 2445)
   - Patient Record Search Dropdown (Line 5919)
6. `frontend/src/components/UniversalMedicineEditModal.tsx`:
   - Category / Form Suggestions Dropdown (Line 1505)
   - Packaging / Unit Suggestions Dropdown (Line 1533)
7. `frontend/src/components/QuickOrderModal.tsx`:
   - Live Medicine Autocomplete Dropdown with Live Ready / Offline sticky status header (Line 936)
8. `frontend/src/components/LiveCartAddModal.tsx`:
   - Live Cart Medicine Suggestions Dropdown with sticky header (Line 2502)
9. `frontend/src/components/OrderModifyModal.tsx`:
   - Medicine Search Suggestions Dropdown (Line 338)
10. `frontend/src/components/MedicineLinkModal.tsx`:
    - Link Candidate Selector Dropdown (Line 220)

### Sticky Headers Across All Major Views (22 Instances):
- POS Cart Table Header (`POS/index.tsx`)
- Purchases Invoice Table Header (`Purchases/index.tsx`)
- Returns Table Headers (`Returns/index.tsx`, `Returns/ExpiryReturnReview.tsx`)
- Reports Analytics Table Headers (`Reports/index.tsx`)
- Purchase History Table Header (`PurchaseHistory/index.tsx`)
- Learning Agency & Doctor Headers (`Learning/index.tsx`)
- Investigation Ledger Header (`Investigation/index.tsx`)
- Dispatch Rider Queue Headers (`Dispatch/index.tsx`)
- Database Master Table Header (`Database/index.tsx`)

---

## 4. Architectural Solution & Standard Fix

### Standard Dropdown Frame Pattern:
```html
<div className="absolute z-dropdown bg-bg2 border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[...px]">
  <!-- 1. PINNED HEADER (shrink-0, border-b, opaque background, outside scroll) -->
  <div className="p-2 border-b border-border bg-bg3 shrink-0 flex items-center justify-between">
    <!-- Header title, filter, or quick-add action -->
  </div>

  <!-- 2. ISOLATED SCROLLABLE LIST (flex-1 min-h-0 overflow-y-auto dropdown-scroll) -->
  <div className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/20">
    <!-- List items scroll cleanly with zero overlap -->
  </div>
</div>
```

### CRM Snooze Engine Solution:
1. **Database & Service Sizing**:
   - Check `automation_notifications` for both `'staged'` AND `'snoozed'` status in `refillService.ts`:
     ```sql
     SELECT id, status, COALESCE(snoozed_until, '') as snoozed_until 
     FROM automation_notifications 
     WHERE type = 'refill_collection' 
       AND status IN ('staged', 'snoozed') 
       AND (recipient_phone = ? OR recipient_name = ?)
     ```
   - If a snoozed notification is active and within its snooze window, `checkAllRefills()` will respect it and NOT re-create a staged notification.
2. **Add Snooze Action to CRM Refills View**:
   - Expose Snooze (+1d, +3d, +7d, custom date) in CRM patient refill action menus alongside Pause/Resume.
   - Synchronize CRM state with `refillEvent.triggerRefresh()` and `app-wa-queue-updated`.

---

## 5. Implementation Phases Checklist

### Phase 1: CRM & Refill Snooze Engine Fix
- [ ] `Task 1.1`: Update `src/services/refillService.ts` to respect active snoozed notifications and prevent duplicate re-staging loops.
- [ ] `Task 1.2`: Update `src/routes/automation.ts` snooze endpoints to record `snoozed_until` timestamp and properly advance refill reminders.
- [ ] `Task 1.3`: Add Snooze actions to [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx) patient refill rows.

### Phase 2: Dropdown Layout & Header Scroll Isolation
- [ ] `Task 2.1`: Standardize all 6 POS dropdowns in [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx) with pinned headers and `flex-1 min-h-0 overflow-y-auto dropdown-scroll`.
- [ ] `Task 2.2`: Standardize 4 Purchases dropdowns in [frontend/src/pages/Purchases/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx).
- [ ] `Task 2.3`: Standardize Returns, Investigation, CRM, and Modal dropdowns (`Returns/index.tsx`, `Investigation/index.tsx`, `CRM/index.tsx`, `UniversalMedicineEditModal.tsx`, `QuickOrderModal.tsx`, `LiveCartAddModal.tsx`, `OrderModifyModal.tsx`, `MedicineLinkModal.tsx`).

### Phase 3: Verification & Guardrails
- [ ] `Task 3.1`: Verify snooze persistence across reload and automated worker runs.
- [ ] `Task 3.2`: Verify smooth dropdown scrolling with zero header overlap or visual clipping.
- [ ] `Task 3.3`: Run `npm run guardrails` and `node scripts/quick-update.mjs`.
