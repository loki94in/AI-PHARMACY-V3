# Implementation Plan: Systemic Unification on `medicine_name` Column & Complete Removal of Stale `product` Queries

**Target:** Ensure 100% of backend queries and frontend callers use the single canonical column `special_orders.medicine_name` without creating or adding back any duplicate `product` column in the SQLite schema.

## Core Contract & Guidelines
1. Do NOT re-add `product` column to `special_orders` table in `src/database.ts` or SQLite.
2. The database schema has ONE source of truth: `special_orders.medicine_name`.
3. In SQL `SELECT` queries across backend routes and services, replace stale references to `product` with `medicine_name AS product, medicine_name` (or `medicine_name`).
4. In frontend components, add safe null/undefined guards `(o.medicine_name || o.product || '').toLowerCase()` so no component ever throws a TypeError.

## Tasks & Resume Log
- [x] **Task 1: Update Backend SQL Queries to query `medicine_name` (routes & services)**
  - Completed across `src/routes/pharmarack.ts`, `src/routes/sales.ts`, `src/routes/whatsappQueue.ts`, `src/services/whatsappIntentService.ts`, `src/routes/refills.ts`, `src/routes/quickAssistant.ts`, `src/routes/websiteOwner.ts`, `src/services/customer/customerService.ts`, `src/services/morningBriefingService.ts`, `src/services/marketClosureService.ts`, `src/services/orderScheduleService.ts`, `src/services/refillService.ts`, and `src/worker/autoMatchWorker.ts`.
- [x] **Task 2: Update Frontend `.toLowerCase()` calls with safe guards**
  - Completed across `frontend/src/pages/Inventory/index.tsx`, `frontend/src/pages/POS/index.tsx`, `frontend/src/pages/PharmarackCart/index.tsx`, `frontend/src/components/PortalAccountsManager.tsx`, and `frontend/src/components/QuickOrderModal.tsx`.
- [x] **Task 3: Run Guardrails, Production Build & Knowledge Graph Update**
  - Completed: `npm run guardrails` passed (0 violations), frontend production build verified.
- [x] **Task 4: Human-in-the-Loop Verification**
  - Verified and ready for deployment.
