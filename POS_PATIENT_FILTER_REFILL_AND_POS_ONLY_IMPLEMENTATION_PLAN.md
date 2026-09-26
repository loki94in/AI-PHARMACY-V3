# POS Patient Selection: Refill & POS Returning Patients Only — Implementation Plan

**Tracking File:** `POS_PATIENT_FILTER_REFILL_AND_POS_ONLY_IMPLEMENTATION_PLAN.md`  
**Status:** Completed ✅  
**Objective:** Restrict POS patient search suggestions and the previous prescription/refill banner exclusively to **Refill Patients** (active scheduled refills) and **POS Returning Patients** (customers with prior sales/invoices), preventing unused CRM leads or empty contacts from cluttering the cashier workflow.

---

## 1. Problem Overview & Scope

1. **Patient Suggestions Overload in POS**:
   - In [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx#L2139), typing in the Patient Name input queries `api.getPatients({ q: currentQuery, limit: 8 })`.
   - In [`src/routes/crm.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/crm.ts#L30), `GET /crm/patients` queries `SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ?`, returning any contact, lead, or empty entry from the CRM regardless of whether they have ever visited the pharmacy counter or have a refill schedule.
   - Cashiers need the POS dropdown to focus strictly on genuine pharmacy customers: **Refill Patients** and **Returning POS Patients**.

2. **Previous Prescription / Refill Banner Precision**:
   - In [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx#L2165) and [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts#L3325), selecting any customer runs `GET /sales/patient-refill-medicines`.
   - The top banner (`"{matchedRefill.patient_name} has previous prescription / refill: ... + Add to Bill"`) should only be triggered for verified Refill Patients or returning POS patients with actual purchase history, with truthful labeling distinguishing active refills from past sale history.

---

## 2. Senior-Level Architecture & Technical Design

### Part A: POS Patient Suggestions Filtering
1. **Backend Query Optimization (`GET /crm/patients` in `src/routes/crm.ts`)**:
   - Support a query parameter `pos=true` / `hasHistory=true`.
   - When set, use an optimized `JOIN` query to filter customers having either:
     - `sales_invoices.id IS NOT NULL` (prior POS purchases), OR
     - `patient_refills.id IS NOT NULL AND patient_refills.is_active = 1` (active scheduled refills).
   - Continue returning enriched properties `active_refill: 1|0`, `purchase_count: number`, and `last_sale_date: string`.
2. **Frontend Safeguard (`frontend/src/pages/POS/index.tsx`)**:
   - In `POS/index.tsx`, call `api.getPatients({ q: currentQuery, limit: 12, pos: true })`.
   - Filter suggestions client-side to ensure strictly:
     ```ts
     const validPatients = list.filter(c => c.active_refill === 1 || (c.purchase_count || 0) > 0);
     ```
   - Retain the convenient `+` button beside the input so the cashier can still register a brand new patient at any time.

### Part B: Refill & Previous Prescription Banner Precision
1. **Backend Enrichment (`GET /sales/patient-refill-medicines` in `src/routes/sales.ts`)**:
   - In `res.json`, return explicit flags:
     - `has_scheduled_refill: scheduledRefills.length > 0`
     - `purchase_count: pastSaleMedicines.length`
     - Each medicine row carries `source: 'refill' | 'sales_history'`.
2. **Frontend Banner Display in POS (`POS/index.tsx`)**:
   - Only set `matchedRefill` if the patient has `scheduledRefills` or verified prior POS sales.
   - Render contextual banner styling and truthful text:
     - If active refill: `"🔁 Active Refill Schedule for [Name]"`
     - If POS sales history: `"📋 Previous Prescription for [Name] (last visit [Date])"`

---

## 3. Step-by-Step Implementation Tasks

- [x] **Task 1: Add POS history filtering to `GET /crm/patients` endpoint**
  - File: [`src/routes/crm.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/crm.ts)
  - Added `pos=true` / `hasHistory=true` query parameter support using index-optimized `EXISTS` conditions on `sales_invoices` and `patient_refills`.

- [x] **Task 2: Update POS patient suggestions caller & client filter**
  - File: [`frontend/src/services/api.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts) & [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
  - Passed `pos: true` in `api.getPatients`.
  - Applied client-side filter strictly keeping `c.active_refill === 1 || (c.purchase_count || 0) > 0`.

- [x] **Task 3: Refine `GET /sales/patient-refill-medicines` and banner logic**
  - File: [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts)
  - Added `has_scheduled_refill`, `scheduled_refill_count`, and `past_purchase_count` flags to the response.
  - File: [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
  - Updated `matchedRefill` resolution to require scheduled refill or prior purchase history, and formatted banner text with contextual indicators.

- [x] **Task 4: Run Verification & Guardrails**
  - Ran `npm run guardrails` (`tsc --noEmit` passed clean with 0 errors).
  - Ran `node scripts/quick-update.mjs` to synchronize the Auto-Knowledge Graph.
  - Documented resolution in `SMALL_BUG_FIX_PLAN.md` under ticket `P2-41`.
