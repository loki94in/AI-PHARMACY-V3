# Implementation Plan: Shared Refill Batch Validation & QA Refill Panel Pipeline

## 1. Context & User Flow
Implement the complete Refill Batch processing and validation architecture according to the specification flowchart:
- **Refill Medicine Selected**: Website Booking or Manual CRM Booking.
- **Batch Creation**: 
  - Website Booking creates a Website Refill Batch (`WB-<timestamp>-<rand>`, `source: 'website'`, `source_id: <website order id>`).
  - Manual CRM Booking creates a CRM Refill Batch (`CRM-<timestamp>-<rand>`, `source: 'crm'`, `source_id: <crm id>`).
  - **CRITICAL**: Never route refill batches to the Online Orders app (`/website-orders`, `special_orders`).
- **Shared Refill Validation Pipeline**:
  - Check duplicate booking (within active cycle / recent window) and refill eligibility.
  - Check if quantity exceeds 2-month limit (`quantity > (quantity_needed / refill_interval_days) * 60`).
  - If Yes:
    - Hold for pharmacist reconfirmation.
    - QA Refill Panel displays: **Approval Required**.
    - If Approved: Release approved items to live cart.
    - If Not Approved: Remain on hold or reject.
  - If No:
    - Mark items eligible directly.
- **Live Cart Addition**:
  - Add eligible / approved medicines to the live cart.
  - If cart addition fails: Keep failed items visible in QA (with truthful status: `needs_link`, `linked_oos`, `failed`).
  - If cart addition succeeds: Record successful items (`added`, `in_cart`).
- **Update Batch & Notification**:
  - Update the relevant refill batch status and item states.
  - Trigger existing notification pipeline (`automation_notifications` staged queue, SSE `refill_updated`).
  - QA Refill Panel prominently displays the **Source** (Website vs CRM) and **Batch ID**.

---

## 2. Proposed Architecture & Changes

### A. Database Schema (`src/database.ts`)
1. Create `refill_batches` table in `ensureRefillCartLinkSchema` AND the main DDL block:
   - `id INTEGER PRIMARY KEY AUTOINCREMENT`
   - `batch_id TEXT UNIQUE NOT NULL`
   - `source TEXT NOT NULL CHECK(source IN ('website', 'crm'))`
   - `source_id TEXT`
   - `customer_id INTEGER`
   - `patient_name TEXT NOT NULL`
   - `patient_phone TEXT NOT NULL`
   - `store_id INTEGER DEFAULT 1`
   - `status TEXT DEFAULT 'pending'`
   - `approval_status TEXT DEFAULT 'none'`
   - `approval_reason TEXT`
   - `approved_by TEXT`
   - `approved_at DATETIME`
   - `total_items INTEGER DEFAULT 0`
   - `eligible_items INTEGER DEFAULT 0`
   - `added_items INTEGER DEFAULT 0`
   - `failed_items INTEGER DEFAULT 0`
   - `items_json TEXT`
   - `notes TEXT`
   - `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
   - `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
   - Indexes on `batch_id`, `patient_phone`, `source`, `status`, `created_at`.
2. Add columns to `patient_refills`:
   - `batch_id TEXT DEFAULT NULL`
   - `source TEXT DEFAULT 'counter'` (ensure column)
   - `source_id TEXT DEFAULT NULL`
   - `approval_status TEXT DEFAULT 'none'`
   - `approval_reason TEXT DEFAULT NULL`

### B. Shared Refill Service (`src/services/refillBatchService.ts`)
1. `createRefillBatch({ source, sourceId, patientName, patientPhone, customerId, storeId, items, notes })`
2. `validateRefillBatch(batchId, db)`:
   - Duplicate booking check: checks for pending/unsettled refill items for this patient.
   - Refill eligibility check: links with `patient_refills`, creates/updates schedule.
   - 2-month quantity limit calculation:
     - 2-month threshold = `Math.ceil((quantity_needed / interval_days) * 60)`.
     - If `requested_qty > threshold`: flags item as `approval_status: 'required'`, `approval_reason: 'Exceeds 2-month limit'`.
   - Sets batch `approval_status: 'required'` or `'approved'`.
3. `approveRefillBatch(batchId, { approvedBy, rejectedItemIds })`:
   - Marks approved items and batch as `approval_status: 'approved'`.
   - Triggers `addEligibleItemsToCart(batchId)`.
4. `rejectRefillBatch(batchId, { reason, rejectedBy })`:
   - Marks batch as rejected/on-hold.
5. `addEligibleItemsToCart(batchId)`:
   - Calls `processRefillCartItem` for each approved/eligible item.
   - If successful, updates item to `cart_status: 'added'` and stamps `patient_refills.cart_*`.
   - If failed (`needs_link`, `linked_oos`, `failed`), preserves failure status in batch and `patient_refills` so it remains visible in QA.
   - Updates batch counts (`added_items`, `failed_items`, `status`).
   - Triggers staged notification in `automation_notifications` and broadcasts `refill_updated`.

### C. Booking Handlers: Prevent Leaks to Online Orders App
1. `src/routes/customerPortal.ts` `/customer/refill-order`:
   - Calls `refillBatchService.createRefillBatch` with `source: 'website'`, `source_id: websiteOrderId`.
   - Runs `validateRefillBatch`.
   - Does NOT insert into `special_orders`!
   - Returns batch info to portal.
2. `src/services/cloudCatalogSyncService.ts`:
   - When pulling cloud orders from Vercel KV, if `o.orderType === 'REFILL'` or `isRefill`:
   - Calls `refillBatchService.createRefillBatch` with `source: 'website'`, `source_id: o.orderId`.
   - Runs `validateRefillBatch`.
   - Does NOT insert into `special_orders` with `website_refill`!
3. `src/routes/refills.ts`:
   - Add API routes:
     - `POST /api/refills/batch`: manual CRM booking endpoint to create a CRM refill batch (`source: 'crm'`).
     - `POST /api/refills/batch/:batchId/approve`: pharmacist approval endpoint for held batches.
     - `POST /api/refills/batch/:batchId/reject`: pharmacist reject/hold endpoint.
     - `GET /api/refills/batches`: list active batches.
   - Update `GET /api/refills/panel`:
     - Returns `batch_id`, `source`, `approval_status`, `approval_reason` for each refill item and group!
4. `src/utils/onlineOrders.ts` and `src/routes/websiteOrders.ts`:
   - Ensure refill batches are strictly excluded from Online Orders app.

### D. Frontend: QA Refill Panel & CRM UI
1. `frontend/src/services/api.ts`:
   - Add `createRefillBatch`, `approveRefillBatch`, `rejectRefillBatch`, `getRefillBatches`.
2. `frontend/src/components/QuickAssistSidebar.tsx`:
   - In Refills list, display:
     - **Source Chip**: `🌐 Website` (Cyan) or `🏢 CRM` (Purple).
     - **Batch ID Chip**: `Batch: WB-...` or `Batch: CRM-...`.
     - When `approval_status === 'required'`:
       - Show prominent **⚠️ Approval Required: Exceeds 2-Mo Limit** chip.
       - Render **Approve** and **Reject** action buttons on the card.
       - Clicking Approve calls `api.approveRefillBatch`, invalidates `refills`, and adds eligible items to live cart.
     - Failed items remain clearly visible with their truthful status (`needs_link`, `linked_oos`, `failed`).
3. `frontend/src/pages/CRM/RefillsSection.tsx`:
   - Add manual batch booking support and render Source & Batch ID chips with approval controls.

---

## 3. Verification & Guardrails Plan
1. `npm run guardrails` (automated performance & safety scanner).
2. `npx tsc --noEmit` (backend TypeScript check).
3. `npm run build:client` (frontend production bundle check).
4. `node scripts/quick-update.mjs` (auto-knowledge graph update).
5. Comprehensive test suite for `refillBatchService` checking all flowchart branches:
   - Website booking batch creation with source ID and batch ID.
   - CRM booking batch creation with source ID and batch ID.
   - Neither routing to `special_orders` or Online Orders app.
   - 2-month limit exceeding -> hold with `approval_status: 'required'`.
   - Approval -> release and add to live cart.
   - Rejection -> remains on hold.
   - Cart addition failure -> stays visible in QA.
   - Cart addition success -> batch updated and notification triggered.

---

## 4. Completed Tasks Log
- [ ] Task 1: Database Schema & Migration (`refill_batches` table and `patient_refills` columns in `database.ts`).
- [ ] Task 2: Implement `src/services/refillBatchService.ts` with validation, 2-month limit check, approval, and live cart addition.
- [ ] Task 3: Decouple refill bookings from `special_orders` in `customerPortal.ts` and `cloudCatalogSyncService.ts`.
- [ ] Task 4: Expose batch endpoints in `src/routes/refills.ts` and include batch info in `GET /api/refills/panel`.
- [ ] Task 5: Update Frontend API and `QuickAssistSidebar.tsx` to display Source, Batch ID, and Approval Required controls.
- [ ] Task 6: Add automated test suite for Refill Batch pipeline and verify all flowchart paths.
- [ ] Task 7: Run guardrails, typecheck, client build, and quick-update knowledge graph.
