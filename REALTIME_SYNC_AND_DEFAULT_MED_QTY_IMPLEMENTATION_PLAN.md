# Implementation Plan: Real-Time SSE Sync (Medicines, Doctors, Orders) & Default Medicine Quantity (1)

## Overview
1. **Default Medicine Quantity = 1**:
   - In `frontend/src/pages/POS/index.tsx`: When any medicine is selected into the cart (tablets, capsules, syrups, liquids, ointments, lotions, loose-sale items, etc.), ensure it defaults to **`qty = 1`** so at least one unit/pack is selected by default instead of 0 or blank.
2. **Medicine Real-Time SSE Broadcast & Cascade**:
   - In `src/routes/medicines.ts`: In `PUT /medicines/:id/quick-edit` and `PATCH /medicines/:id/allow-loose-sale`, broadcast `eventService.broadcast('inventory_sync', ...)` and `eventService.broadcast('medicines_updated', ...)`.
   - Cascade medicine name updates to `patient_refills.medicine_name` where `medicine_id = id`.
3. **Doctors Real-Time SSE Broadcast & Frontend Listener**:
   - In `src/routes/crm.ts`: On `POST /doctors`, `PUT /doctors/:id`, and `DELETE /doctors/:id`, broadcast `eventService.broadcast('doctors_updated', ...)`.
   - In `frontend/src/hooks/useGlobalSseInvalidation.ts`: Map `doctors_updated` to invalidate `['doctors']` queries.
   - In `frontend/src/pages/POS/index.tsx`: Invalidate or refresh the doctors list on `doctors_updated`.
4. **Special Orders Real-Time Cleanups**:
   - When special orders are fulfilled or cancelled, auto-complete/resolve any matching call tasks in `patient_call_tasks`.
5. **Verification**:
   - Run `npm run guardrails` and update knowledge graph with `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracking

- [x] Task 1: Fix default quantity in `frontend/src/pages/POS/index.tsx` so all medicines default to at least 1.
- [x] Task 2: Add SSE broadcasts and cascade to `src/routes/medicines.ts`.
- [x] Task 3: Add SSE broadcasts for Doctors in `src/routes/crm.ts` and wire invalidation in `frontend/src/hooks/useGlobalSseInvalidation.ts`.
- [x] Task 4: Auto-resolve call tasks on special order fulfillment in `src/routes/orders.ts`.
- [x] Task 5: Run performance guardrails (`npm run guardrails`) and update knowledge graph (`node scripts/quick-update.mjs`).

---

## Completion Report

### Summary of Completed Work
1. **Default Medicine Quantity = 1 ([frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx))**:
   - Fixed `defaultQty` calculation when selecting any medicine into an empty row:
     Previously, loose-sale enabled items were defaulting to `0`. Now, **all selected medicines** (syrups, liquids, solids, tablets, capsules, ointments, lotions, creams, drops, powders) automatically default to at least **`1`** unit/pack.
2. **Medicine Real-Time SSE Broadcast & Cascade ([src/routes/medicines.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/medicines.ts))**:
   - In `PUT /medicines/:id/quick-edit` and `PATCH /medicines/:id/allow-loose-sale`:
     - Cascades medicine name changes to `patient_refills.medicine_name`.
     - Broadcasts `inventory_sync` and `medicines_updated` via SSE on every edit and loose-sale toggle.
3. **Doctors Real-Time SSE Broadcast ([src/routes/crm.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/crm.ts) & [useGlobalSseInvalidation.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/useGlobalSseInvalidation.ts))**:
   - On `POST /doctors`, `PUT /doctors/:id`, and `DELETE /doctors/:id`: broadcasts `doctors_updated`.
   - Wired `doctors_updated` in `useGlobalSseInvalidation.ts` so POS billing's doctor picker and CRM lists update in-memory immediately.
4. **Special Orders Auto-Resolution ([src/routes/orders.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/orders.ts))**:
   - Fulfilling (`POST /:id/fulfill`) or deleting/cancelling (`DELETE /:id`) a special order automatically completes or dismisses matching call tasks in `patient_call_tasks`, broadcasting `call_tasks_updated`.
5. **Verification**:
   - Guardrails check passed (`npm run guardrails` exit code 0).
   - Knowledge graph updated via `node scripts/quick-update.mjs`.
