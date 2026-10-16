# Implementation Plan: Purchase Bill Data Preservation, Distributor-Specific Matching & Purchase History Search Clear

## Objective
1. **Purchase History Search**: Add a 1-click inline `✕` clear button, `Escape` key handler, and active filter badge to the search input on `/purchase-history` so users can instantly clear search queries.
2. **Purchase Bill Data Preservation**: Fix the bug in `/purchases` where selecting/matching a medicine wiped out scanned/parsed numbers (`rate`, `mrp`, `batch_no`, `expiry_date`, `qty`, `free_qty`, `cgst_per`, `sgst_per`). Ensure all parsed values from Mail, CSV, and OCR remain 100% intact when linking medicines.
3. **Distributor-Specific Matching (No Cross-Matching)**: Ensure product mappings are saved and retrieved strictly per distributor (`distributor_medicine_aliases`). When importing a bill from Distributor A, match against Distributor A's past purchases and aliases—never cross-match or force-guess from other distributors. Unmatched items stay unlinked for human review.

---

## Proposed Changes

### 1. Purchase History Search Clear (`frontend/src/pages/PurchaseHistory/index.tsx`)
- Add right padding (`pr-9`) to the toolbar search input.
- Add `onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}`.
- Render a clear button (`<X size={15} />`) inside the input container when `searchQuery.length > 0`.
- Display a subtle active filter badge (`Filtering: "{searchQuery}" • Click to Clear ✕`) when search query is active.

### 2. Purchase Bill Item Selection Number Preservation (`frontend/src/pages/Purchases/index.tsx`)
- In `selectMedicine(medicine, index)`:
  - Do NOT wipe `item.qty`, `item.free_qty`, `item.batch_no`, `item.expiry_date`, `item.rate`, `item.mrp`.
  - Only set them to empty string if the row had no value (e.g. typing a fresh blank row from scratch).
  - Preserve bill-parsed GST (`cgst_per`, `sgst_per`); only fallback to catalog GST if bill row has no GST.
  - Recalculate `item.amount = calculateItemAmount(item)`.
  - Pass `selectedDistributor` to `api.createMedicineAlias`.

### 3. Distributor-Specific Alias Backend Support (`src/routes/inventory.ts` & `frontend/src/services/api.ts`)
- In `src/routes/inventory.ts` (`POST /medicines/alias`):
  - Accept `distributor_id` in request body.
  - When `distributor_id` is provided, insert or replace into `distributor_medicine_aliases (distributor_id, alias_name, medicine_id)`.
- In `frontend/src/services/api.ts`:
  - Update `createMedicineAlias` signature to `(aliasName: string, medicineId: number, distributorId?: number | null)`.

### 4. Distributor-Scoped File Upload Matching (`frontend/src/pages/Purchases/index.tsx`)
- In `handleFileUpload(fileToUpload)`:
  - Query `api.matchPurchaseItems` scoped to the active `distributor_id`.
  - Do not apply loose global catalog similarity that overrides or cross-matches items from unrelated distributors.
  - Unmatched items remain with `medicine_id = null` and clear prompt `✨ New Medicine (Click to Register)`.

---

## Verification Plan

### Automated Checks
- `npm run guardrails`: Verify performance guardrails pass (0 violations, clean `tsc --noEmit`).
- `node scripts/quick-update.mjs`: Update the auto-knowledge graph and audit.

### Manual / Functional Verification Points
1. **Purchase History Search**:
   - Go to `/purchase-history`.
   - Type a search query: verify `✕` icon appears inside the search input.
   - Press `Escape`: verify search query clears immediately and full purchase list restores.
   - Click the `✕` icon: verify search query clears immediately.
2. **Purchase Bill Number Preservation**:
   - On `/purchases`, upload a CSV/bill or import from `/mail`.
   - Notice parsed rate, MRP, batch, exp, and qty.
   - Select/change a catalog medicine for any row: verify rate, MRP, batch, exp, qty, and GST remain completely intact and are NOT wiped.
3. **Distributor-Specific Matching**:
   - Link a medicine for a specific distributor.
   - Verify alias is stored with `distributor_id` in `distributor_medicine_aliases`.
   - Next time an invoice from this distributor is parsed, verify it auto-matches to that medicine without cross-distributor mixing.

---

## Task Progress Checklist
- [x] Task 1: Add inline clear button, Escape key, and active filter badge to `/purchase-history`
  - *Completed*: Added trailing padding (`pr-10`) to the toolbar search input. Added keyboard listener for `Escape` key (`setSearchQuery('')`). Rendered a 1-click `<X size={15} />` clear button inside the search container. Added semantic active filter badge (`Filtering: "{searchQuery}" • Click to Clear ✕`) when a query is entered.
- [x] Task 2: Support `distributor_id` in `/medicines/alias` API and backend route
  - *Completed*: Updated `POST /inventory/medicines/alias` in `src/routes/inventory.ts` to accept `distributor_id` and insert or update `distributor_medicine_aliases` with `(distributor_id, alias_name, medicine_id)` on conflict. Updated `createMedicineAlias` in `frontend/src/services/api.ts` to forward `distributorId`.
- [x] Task 3: Fix `selectMedicine` in `/purchases` to preserve parsed rates, MRP, batch, exp, qty, and GST
  - *Completed*: Refactored `selectMedicine` in `frontend/src/pages/Purchases/index.tsx`. Detected existing parsed bill values (`rate`, `mrp`, `batch_no`, `expiry_date`, `qty`, `free_qty`, `gst`). Stopped resetting these fields on medicine selection. Preserved bill GST and only defaulted to catalog GST if bill row had none. Recalculated row amount with `calculateItemAmount` and passed `selectedDistributor` to `createMedicineAlias`.
- [x] Task 4: Ensure distributor-scoped resolution in `handleFileUpload` without loose cross-distributor matching
  - *Completed*: In `handleFileUpload`, resolved distributor ID before processing item names. Ran batched `api.matchPurchaseItems` scoped strictly to `resolvedDistId`. If matched against distributor aliases, history, or exact catalog name, linked `medicine_id` and marked `prefill_matched = true`. Unmatched items remain cleanly unlinked (`medicine_id = null`) with the yellow prompt without loose cross-distributor guessing. In mail prefill, eliminated loose 0.60 fuzzy matching and preserved parsed row amounts.
- [x] Task 5: Run performance guardrails and update knowledge graph
  - *Completed*: Fixed raw Tailwind color (`hover:text-white` -> `hover:text-text`). Ran `npm run guardrails` (passed: 0 violations, clean `tsc --noEmit`). Ran `node scripts/quick-update.mjs` (passed in 4.8s, updating 3D knowledge graph and audit).
