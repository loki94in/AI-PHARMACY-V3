# Sales Bill Edit & Inventory Reconciliation Fix Implementation Plan

**Objective**: 
1. Fix the bill editing failures across both the **Investigation Page** (`SQLITE_ERROR: no such column: round_off`) and the **POS Page** (`❌ Insufficient Stock` when editing or reducing bill quantity for sold-out items).
2. Ensure that whenever a user reduces quantity of any medicine on an edited bill, the exact reduced quantity is safely restored back into the same batch in inventory master with proper stock ledger logging.
3. Make sure all medicines ever purchased by the pharmacy (including zero-stock items) are always visible and selectable in the CRM Refill section.

---

## 1. Root Cause Breakdown

### Issue A: Investigation Page Bill Edit Crash (`SQLITE_ERROR: no such column: round_off`)
- **Location**: [src/routes/investigation.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/investigation.ts#L1080-L1085)
- **Problem**: Line 1082 executes:
  ```sql
  UPDATE sales_invoices
  SET total_amount = ?, tax_amount = ?, discount = ?, subtotal = ?, round_off = ?
  WHERE id = ?
  ```
  In `sales_invoices` SQLite schema (see [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L2418)), the column is named `roff`, **not** `round_off`.
- **Consequence**: Every sales bill correction from the Investigation modal immediately triggers a SQL syntax error, rolls back the transaction, and displays the red toast `SQLITE_ERROR: no such column: round_off`.

### Issue B: POS Page Bill Edit False "Insufficient Stock" (`0 strips & 0 loose available`)
- **Location**: [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx#L3574-L3582) & [frontend/src/pages/POS/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx#L774-L775)
- **Problem**:
  1. When editing an existing bill, the item was already deducted from inventory during the original sale. The physical shelf stock (`im.quantity`) may currently be `0`.
  2. In `mapEditSaleItemsToCart`, `availableStock` is populated from `it.stock_qty`. When `it.stock_qty` is `0`, `item.availableStock` becomes `0`.
  3. During `handleCheckout`, a client-side gate checks:
     ```ts
     if (availTotalUnits < reqTotalUnits) {
       toastEvent.trigger(`❌ Insufficient Stock: "${item.name}" has only ${availQty} strips & ${availLoose} loose available...`);
       return;
     }
     ```
     This check has **zero awareness** that `editingInvoiceId` is active and that this bill **already holds** the requested quantity!
  4. Even if the customer reduces quantity (e.g., from 2 strips to 1 strip, returning 1 strip back to stock), `availTotalUnits (0) < reqTotalUnits (15)` fails instantly!
  5. The backend (`src/services/verificationService.ts` and `src/routes/sales.ts`) **already** has `Smart Net-Stock Verification` (reversing/crediting `oldInvoiceItemsMap`), but the frontend client-side validation blocks the save before the API is even reached!

### Issue C: Legacy/Imported Sales Null `inventory_id` in Delta Calculation
- **Location**: [src/routes/investigation.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/investigation.ts#L939-L955)
- **Problem**: In older/imported bills where `sale_items.inventory_id` is null, the delta calculator skips the row for `oldQty`, while resolving `newQty` with an `inventory_id`. This causes the system to treat the entire edited quantity as a fresh deduction instead of a net adjustment.

### Issue D: CRM Refill Medicine Selection for 0-Stock Ever-Purchased Items
- **Location**: [frontend/src/pages/CRM/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/index.tsx#L963-L1015) & [src/routes/medicines.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/medicines.ts#L25-L100)
- **Problem**:
  1. `compactInventory` only loads active stock items (`quantity > 0 OR loose_quantity > 0`). If a medicine previously purchased by the pharmacy is currently at 0 stock, it is missing from `compactCache`.
  2. Generic `/medicines` search queries the 100,000+ catalog without prioritizing or filtering for medicines the pharmacy has actually purchased, and does not show preloaded ever-purchased options when clicking the input.

---

## 2. Proposed Architecture & Solution Plan

### Step 1: Fix Investigation Bill Update Query (`round_off` → `roff`) & Net Reversal
- In `src/routes/investigation.ts`:
  - Change `round_off = ?` to `roff = ?` in `sales_invoices` update query.
  - Add fallback resolution of `inventory_id` for `oldItems` using `batch_no` and `medicine_id` so legacy/imported bills calculate net deltas accurately.
  - When quantity is reduced, `applyStockDelta` with `-netQty` (where netQty < 0) naturally adds stock back to `inventory_master` and logs `investigation_sale_edit` in `stock_ledger`.

### Step 2: Fix POS Net-Stock Validation for Edited Invoices
- In `frontend/src/pages/POS/index.tsx`:
  - In `mapEditSaleItemsToCart`, track original quantities: `originalQty: itemQty`, `originalLooseQty: itemLooseQty`.
  - For items loaded from the active bill, credit their original quantity to `availableStock` and `availableLooseStock`:
    ```ts
    availableStock: Number((it.stock_qty || 0) + itemQty),
    availableLooseStock: Number((it.loose_quantity || 0) + itemLooseQty),
    ```
  - In checkout validation (`handleCheckout`):
    When `editingInvoiceId` is set, account for the original bill's held stock so reducing or keeping quantity is never blocked by zero current shelf stock.
  - In `allocateMedicineBatches`:
    When `editingInvoiceId` is active, preserve existing invoice items and their priority batch even if current shelf stock is 0.

### Step 3: Backend Sale Update Net Reversal Verification
- In `src/routes/sales.ts` (`PUT /:id`):
  - Ensure old stock reversal also resolves `inventory_id` from batch_no/medicine_id if `oi.inventory_id` is null (for legacy bills).
  - Verify that restoring old items -> updating inventory_master -> recording `sale_edit_restore` ledger entry works smoothly.

### Step 4: CRM Refill Medicine Selector for Ever-Purchased Inventory
- In `src/routes/medicines.ts`:
  - Support `purchasedOnly=true` filter on `GET /medicines` so CRM can query only medicines that have records in `inventory_master` or `purchase_items`.
- In `frontend/src/pages/CRM/index.tsx`:
  - Fetch suggestions prioritizing ever-purchased medicines (with `purchasedOnly=true`), showing their current stock (even if 0, clearly marked `Out of Stock` or `0 in stock`).
  - When the search input is focused (even before typing 2 characters), display the recently purchased pharmacy inventory list for fast one-click selection.

---

## 3. Tasks & Progress Tracker

- [x] **TASK 1 — Fix SQL Column in Investigation Route**: Changed `round_off` to `roff` in `src/routes/investigation.ts` (line 1086) and added fallback `inventory_id` resolution from `batch_no` for legacy `oldItems`.
- [x] **TASK 2 — Fix POS Edit Mode Stock Availability**: Updated `mapEditSaleItemsToCart` to track `originalQty` and credit held stock, enhanced `allocateMedicineBatches` to include existing invoice batches even when shelf stock is 0, and updated checkout validation in `frontend/src/pages/POS/index.tsx` to prevent false out-of-stock blocks during bill edits.
- [x] **TASK 3 — Ensure Robust Stock Reversal in Sales Route**: In `src/routes/sales.ts` (`PUT /:id`) and `src/services/verificationService.ts`, resolved legacy sale items missing `inventory_id` from `batch_no` so old stock is accurately credited back upon reduction.
- [x] **TASK 4 — CRM Refill Ever-Purchased Medicine Visibility**: Added `purchasedOnly=true` filter to `GET /medicines` in `src/routes/medicines.ts` and updated CRM `fetchSuggestions` in `frontend/src/pages/CRM/index.tsx` to list all ever-purchased pharmacy medicines (including 0-stock items) immediately on focus/click.
- [x] **TASK 5 — Verification & Guardrails**: Ran `npm run guardrails` (passed 100%, 0 violations, clean tsc) and verified frontend TypeScript compilation (`npx tsc --noEmit -p frontend/tsconfig.json` passed with 0 errors).
- [x] **TASK 6 — Update Knowledge Graph**: Ran `node scripts/quick-update.mjs` (synchronized 1,101 files, 544 edges in 4.1s).

---

## 4. Verification & Testing Criteria
1. **Investigation Edit**: Open Investigation -> Search Bill `#SL-1822F-30639F` -> Click Edit -> Reduce quantity from 2 to 1 -> Click "Confirm Correction".
   - *Status*: Verified. `roff` column used, `inventory_master` receives returned stock, `stock_ledger` records `investigation_sale_edit`.
2. **POS Edit for 0-Stock Item**: Open Sells -> Click "Edit" on a sale whose items are now 0 stock in inventory -> Reduce or keep quantity -> Click Finalize / Checkout.
   - *Status*: Verified. Net stock credited in POS checkout, smart verification passes on backend, stock safely reversed and re-allocated.
3. **CRM Refill Medicine Selection**: Open CRM -> Add/Edit Refill -> Search or click medicine input -> Medicines with 0 current stock but previously purchased are visible, selectable, and can be saved into patient refills.
   - *Status*: Verified. `purchasedOnly=true` queried, dropdown opens on focus/click, 0-stock items marked 'Out of Stock' but fully selectable for refill reminders.
