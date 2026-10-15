# Implementation Plan: Fix Idle DB Locks, 15s Timeout & Strict Refill Distributor Linking

## 1. Problem Statement
1. **15,000ms Timeout & Transaction Rollbacks**: When editing medicine distributor links or database settings during idle times, Axios times out at 15s (`timeout: 15000`), aborting the connection. `requestTransactionGuard` detects `res.on('close')` with an open transaction and forcibly rolls back the database operation (`[DB-MUTEX] PUT /api/refills/medicine-links/:id answered with its transaction still open`).
2. **Idle DB Lock Contention**: Background catalog sync (`pharmarackCatalogCache.ts`) ran `BEGIN TRANSACTION` without `/* BACKGROUND */` priority tag, treating long batches as `NORMAL` priority and blocking interactive requests. Furthermore, HTTP requests entering during a background worker's transaction erroneously joined it via `SAVEPOINT` instead of waiting for their own turn.
3. **Wrong Medicine Added to Live Cart (Vishal Bhise 16:35 Incident)**: WhatsApp bot confirmed refill flow in `whatsappIntentService.ts` bypassed saved `medicine_distributor_links` and searched `distributor_catalog` with broad wildcard queries. When 0 exact matches existed for `LAMETEC`, line 407 returned 500 unrelated `formFilteredCandidates`, picking and adding `SUBSYDE CR 100` and `TAMBAC 200` to the Live Cart.
4. **Stale Refill Snapshot & Silent Auto-Link**: `saveMedicineLinks` did not clear stale `cart_store_name` / `cart_product_code` in `patient_refills` when links were deleted or replaced. Additionally, `processRefillCartItem` had a silent live-search fallback that auto-linked arbitrary candidates.

---

## 2. Implementation Tasks

### Task 1: Fix Database Locks, Worker Isolation & Frontend Timeouts
- [x] **1.1 Database Worker Isolation (`src/database/connection.ts`)**:
  - Updated `BEGIN` handler: HTTP requests now only use `SAVEPOINT` for nested transactions within the same request. When a background worker holds the lock, incoming HTTP requests wait for lock acquisition rather than joining the worker's transaction.
- [x] **1.2 Background Priority Tagging (`src/services/pharmarackCatalogCache.ts`)**:
  - Tagged catalog sync transactions with `BEGIN TRANSACTION /* BACKGROUND */` so the prioritized mutex always lets interactive UI actions (`NORMAL`/`VIP`) jump ahead.
- [x] **1.3 Frontend Timeout Extension (`frontend/src/services/api.ts`)**:
  - Added `{ timeout: 60000 }` on `saveMedicineLinks` and `saveDistributorPriority` so operations never abort prematurely at 15s.

### Task 2: Strict Distributor Linking & No Wrong Product in WhatsApp Flow
- [x] **2.1 Strict Linked-Distributor Ordering (`src/services/whatsappIntentService.ts`)**:
  - In `executeConfirmedProcurementFlow`, now checks `medicine_distributor_links` first. If linked distributors exist, it checks stock in priority order for that exact `store_id` and `product_code`.
  - If all linked distributors are Out-of-Stock, it halts immediately with `OOS` status, alerts the store owner, and never adds random catalog candidates.
  - Passes `medicineId` into `executeConfirmedProcurementFlow` across bundle confirmation items.
- [x] **2.2 Remove Wildcard Candidate Leak (`src/services/whatsappIntentService.ts`)**:
  - In `filterCandidatesByFormulation`, if `exactMatches.length === 0` for target modifiers/strengths, returns `[]` instead of leaking 500 unrelated `formFilteredCandidates`. Ensures brand compatibility when no modifiers are present.

### Task 3: Clear Stale Cart Snapshot & Remove Silent Fallback
- [x] **3.1 Clear Stale Cart Snapshot on Unlink (`src/services/refillCartService.ts`)**:
  - In `saveMedicineLinks`, clears stale `cart_store_id`, `cart_store_name`, `cart_product_code`, and `cart_qty` on `patient_refills` for the target medicine whenever links are updated or deleted.
- [x] **3.2 Remove Silent Auto-Link Fallback (`src/services/refillCartService.ts`)**:
  - In `processRefillCartItem`, removed the silent auto-linking fallback that linked arbitrary in-stock candidates when `links.length === 0`. Now strictly returns `needs_link`.

---

## 3. Verification & Compliance
- [x] Run `npx tsc --noEmit` and frontend TypeScript check: **0 errors** (Both passed with exit code 0).
- [x] Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`): **PASS — no guardrail violations. Speed architecture intact.**
- [x] Run `node scripts/quick-update.mjs` to synchronize the Auto-Knowledge Graph: **Done in 10.8s (1192 nodes, 798 edges)**.

---

## 4. Execution Log
- **2026-10-15**:
  - Patched `src/database/connection.ts` to prevent HTTP requests from mistakenly joining background worker transactions as savepoints.
  - Tagged `pharmarackCatalogCache.ts` daily sync transactions with `/* BACKGROUND */`.
  - Added `{ timeout: 60000 }` to `saveMedicineLinks` and `saveDistributorPriority` in `frontend/src/services/api.ts`.
  - Hardened `whatsappIntentService.ts` to strictly query saved distributor links, halt truthfully on OOS, and block candidate leaks in `filterCandidatesByFormulation`.
  - Cleared stale cart snapshots and eliminated silent auto-linking fallbacks in `src/services/refillCartService.ts`.
  - Verified compilation and guardrails cleanly. Knowledge graph updated.
