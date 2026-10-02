# Implementation Plan: Fix "Unknown" Distributor in Purchase Price History Hover Table

## 1. Problem Identification & Root Cause
In the **Purchases page**, when the user hovers over the Rate or MRP field of a medicine (e.g. `NICIP PLUS TABLET`), the `HoverPriceIntelTable` popover displays past distributor rates, MRPs, and profit margins. In certain medicines, the last row displays the distributor name as **"Unknown"** (e.g., `Unknown | ₹10.40 | ₹62.00 | 83.2%`).

### Verified Root Cause Details:
1. **The Medicine & The Batch**:
   - Medicine: **`NICIP PLUS TABLET`** (`medicine_id: 1140805`)
   - The row showing `₹10.40` and `₹62.00` is batch **`P111363`**.
   - In the database, batch `P111363` was actually purchased on **2022-04-19** under Invoice `SB-1877` from distributor **`SHREE SAI PHARMA`** (Distributor ID: 29).
   - Across the entire pharmacy database, **100% of all 16,214 purchases** have a valid, verified distributor. Not a single purchase has a missing distributor.
2. **The Cut-off & The Hardcoded NULL in Backend**:
   - In `src/routes/purchases.ts` -> `GET /purchases/medicine-batches`:
     - Query 1 (`purchaseRows`) fetches from `purchase_items` with `ORDER BY p.date DESC, pi.id DESC LIMIT 50`.
     - `NICIP PLUS TABLET` has **96 purchase transactions** in the database. Because of `LIMIT 50`, only the 50 most recent purchase lines are returned. Batch `P111363` (from purchase #96) is cut off.
     - Query 2 (`inventoryRows`) fetches from `inventory_master`. Because batch `P111363` exists in stock/history, it is fetched here.
     - **Critical Flaw**: Query 2 hardcodes:
       ```sql
       SELECT 
         im.batch_no,
         im.expiry_date,
         im.cost_price as rate,
         im.mrp,
         NULL as distributor_name,  -- <-- Hardcoded NULL!
         NULL as purchase_date,
         ...
       FROM inventory_master im
       ```
     - When deduplicating into `batchMap`, because batch `P111363` was not in the 50 newest `purchaseRows`, it is inserted into `batchMap` with `distributor_name: null`.
3. **Frontend Fallback**:
   - In `frontend/src/pages/Purchases/index.tsx`:
     `historyRowsAsPriceRecords` executes: `distributor_name: r.distributor_name || 'Unknown'`.
   - In `frontend/src/components/HoverPriceIntelTable.tsx`:
     `const key = r.distributor_name || 'Unknown';` groups all null records under the name **"Unknown"** and renders it in the table.

---

## 2. Proposed Architectural Solution

### Step 1: Backend Resolution (`src/routes/purchases.ts`)
1. **Join Purchase & Distributor in `inventoryRows`**:
   Instead of `NULL as distributor_name`, join `inventory_master` with `purchase_items`, `purchases`, and `distributors` (or query the latest purchase item for each inventory batch):
   ```sql
   SELECT 
     im.batch_no,
     im.expiry_date,
     im.cost_price as rate,
     im.mrp,
     m.cgst_per,
     m.sgst_per,
     im.quantity,
     COALESCE(d.name, NULL) as distributor_name,
     p.date as purchase_date,
     im.id as inventory_id
   FROM inventory_master im
   JOIN medicines m ON im.medicine_id = m.id
   LEFT JOIN purchase_items pi ON pi.medicine_id = im.medicine_id AND UPPER(TRIM(pi.batch_no)) = UPPER(TRIM(im.batch_no))
   LEFT JOIN purchases p ON pi.purchase_id = p.id
   LEFT JOIN distributors d ON p.distributor_id = d.id
   WHERE im.medicine_id IN (${placeholders}) AND im.batch_no IS NOT NULL AND TRIM(im.batch_no) != ''
   ORDER BY im.id DESC
   LIMIT 100
   ```
2. **Distinct Batch Retrieval in `purchaseRows`**:
   Ensure `purchaseRows` prioritizes distinct batches or queries up to 100/150 rows so that older purchases with distinct distributors are not starved by repeat purchases of the same batch.

### Step 2: Frontend Fallback & Display Cleanliness
1. In `frontend/src/pages/Purchases/index.tsx` (`historyRowsAsPriceRecords`) and `frontend/src/components/HoverPriceIntelTable.tsx`:
   - If a batch has a valid distributor name, show it (e.g. `SHREE SAI PHARMA`).
   - If an inventory item is pure opening stock (never had an invoice in `purchases`):
     - Do not label it as an "Unknown" distributor.
     - Either label it as **"Opening Stock"** or exclude it from the distributor comparison list so only real distributor quotes are compared.

---

## 3. Human-in-the-Loop Verification Checklist & Execution Summary
- [x] **Backend Fix Completed (`src/routes/purchases.ts`)**:
  - Replaced hardcoded `NULL as distributor_name` in `inventoryRows` with an indexed correlated subquery lookup against `purchase_items` + `purchases` + `distributors`.
  - Increased `LIMIT` from 50 to 100 on both `purchaseRows` and `inventoryRows`.
  - Preserved `distributor_name` and `purchase_date` in deduplication `batchMap`.
  - Measured live SQLite performance on 431MB production database: **15.06 ms** (100% indexed, zero full table scans).
- [x] **Frontend Fix Completed (`Purchases/index.tsx` & `HoverPriceIntelTable.tsx`)**:
  - In `historyRowsAsPriceRecords`, replaced `'Unknown'` fallback with `'Opening Stock'` for unbilled opening stock lines.
  - In `HoverPriceIntelTable.tsx`, normalized keys so `'Unknown'` or missing names never display and are grouped cleanly under `'Opening Stock'` with sanitized `recordWithCleanName`.
  - Expanded display limit from 10 to 15 distributors with smooth `.dropdown-scroll` and semantic theme colors (`text-text`, `text-muted`, `border-border/40`, `hover:bg-bg2/40`, `text-primary`), fully compliant with light/dark theme toggle.
- [x] **Partitioned CTE Upgrade (`src/routes/purchases.ts`)**:
  - Implemented `ROW_NUMBER() OVER (PARTITION BY p.distributor_id ORDER BY p.date DESC)` with `overall_rn <= 60 OR dist_rn <= 3`.
  - Guarantees that every distributor who has ever sold a medicine in the pharmacy's history (even if 100+ days or multiple years old) will ALWAYS be included in the Distributor Price Intelligence comparison, completely bypassing the old 50-bill cutoff.
- [x] **Verification & Guardrails**:
  - Batch `P111363` (`NICIP PLUS TABLET`) now cleanly returns distributor `'SHREE SAI PHARMA'` at Rate ₹10.40, MRP ₹62.00, Margin 83.2% instead of `'Unknown'`.
  - All 11 historical distributors for `NICIP PLUS TABLET` (spanning 2022 to 2026) verified present in price intel.
  - `npm run guardrails` passed with **0 violations** (clean TypeScript compilation via `tsc --noEmit`).
  - Frontend client build (`npm run build --prefix frontend`) passed with **0 errors**.
  - Knowledge graph updated via `node scripts/quick-update.mjs`.
