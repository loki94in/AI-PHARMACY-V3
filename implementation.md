# CRM Refill/Special Orders Lifecycle & Pharmarack Cart Distributor Links — Implementation Plan

## Goal
Resolve three interconnected operational issues across CRM and the Pharmarack Live Cart:
1. **Permanent CRM Refill & Special Order Cancellation**:
   - Add missing `POST /refills/:id/cancel` route to eliminate 404 errors.
   - Cascade cancellation/deletion between `patient_refills` and `special_orders` so cancelled test orders never resurrect as "zombies" during `checkAllRefills()`.
2. **Eliminate Duplicate Medicines & Unify Single Distributor Links**:
   - Unify reorders and shortfall suggestions by canonical `(medicine_id, store_id)`.
   - Prevent the app from ever showing the same medicine twice under the same distributor.
   - Auto-save/upsert every added or placed cart item into `medicine_distributor_links` in SQLite so the database continuously updates without duplicate rows.
3. **Accurate Deficit Shortfall Suggestions & One-Click Linking**:
   - Connect the Live Cart shortfall suggestion cards to `medicine_distributor_links`.
   - Linked medicines add immediately with exact `product_code` and `product_id`.
   - Unlinked medicines open the existing `MedicineLinkModal` (the same modal used in Refills) pre-filtered to the distributor, allowing 1-click linking.
   - Remove the unsafe OpenSearch fallback in `addItemsToPharmarackCart` that was picking unrelated medicines for that store.
4. **Distributor Ordering Limit Protection**:
   - Cap shortfall suggestions to stay within `maxAmountLimit` and `maxItemLimit`.
   - Parse and surface clear upstream Pharmarack error messages when order limits or caps are exceeded.

---

## Architectural & Data Flow

```text
[CRM Refills / Special Orders]
   │
   ├─► Cancel Refill (`POST /refills/:id/cancel`)
   │      ├─► Sets `patient_refills.status = 'cancelled'`, `is_active = 0`
   │      ├─► Purges pending WhatsApp reminders & live cart lines
   │      └─► Permanently deletes linked rows in `special_orders`
   │
   ├─► Delete Special Order (`DELETE /orders/:id`)
   │      ├─► Deletes `special_orders` row
   │      └─► Cascades to linked `patient_refills` (cancels/deletes to prevent zombie re-creation)
   │
   └─► `checkAllRefills()` Background Worker
          └─► Ignores refills where `status IN ('cancelled', 'deleted', 'completed')`
                (Never re-creates deleted test orders)

[Pharmarack Live Cart Suggestions & Reorders]
   │
   ├─► Fetch Shortfall Candidates & Purchase Reorder History
   │      ├─► Queries `purchase_items` & `purchases`
   │      ├─► Joins / resolves canonical `(medicine_id, store_id)`
   │      ├─► Enriches with `medicine_distributor_links` (checks if verified)
   │      └─► Strictly de-duplicates: ONE card per medicine per distributor
   │
   ├─► User Clicks `+ Add (x1)` on Shortfall Filler
   │      ├─► Is Item Linked?
   │      │      ├─► YES: Sends exact `productCode` & `productId` to `POST /api/pharmarack/cart/add`
   │      │      └─► NO: Opens `MedicineLinkModal` (same as Refills) pre-filtered for that distributor
   │      │
   │      └─► Auto-Upsert on Add
   │             └─► `addItemsToPharmarackCart` auto-saves `(medicine_id, store_id, product_code)`
   │                 into `medicine_distributor_links` for future zero-friction 1-click orders
   │
   └─► Safety Matcher in `addItemsToPharmarackCart`
          └─► Requires strict product name match (BANS arbitrary store-only fallbacks)
```

---

## Detailed Step-by-Step Plan

### Step 1: Implement CRM Refill & Special Order Cancellation Cascades
- In `src/routes/refills.ts`:
  - Implement `POST /:id/cancel`:
    - Validates `refillId`.
    - Updates `patient_refills SET status = 'cancelled', is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`.
    - Deletes corresponding reminders from `automation_notifications`.
    - Calls `removeRefillCartLines([refill], false)`.
    - Deletes linked rows in `special_orders` (`WHERE source_refill_id = ? OR (source = 'refill' AND phone = ? AND product = ?)`).
  - In `deletePatientRefillsHandler` (`POST /refills/delete-patient`):
    - Clean up linked rows in `special_orders` matching the patient phone or refill IDs.
- In `src/routes/orders.ts`:
  - In `DELETE /orders/:id`:
    - If `existing.source === 'refill'` or `existing.source_refill_id`:
      - Mark or delete the linked `patient_refills` row (`WHERE id = existing.source_refill_id OR (patient_phone = existing.phone AND medicine_name = existing.product)`).
- In `src/services/refillService.ts`:
  - In `checkAllRefills()` around line 34:
    - Update `pausedUpcoming` query to include `AND (pr.status IS NULL OR pr.status NOT IN ('cancelled', 'deleted', 'completed'))` so cancelled or dismissed test refills are never resurrected.

### Step 2: Auto-Save Single Master Medicine Links (`medicine_distributor_links`)
- In `src/routes/pharmarack.ts`:
  - Create a helper `autoSaveMedicineDistributorLink(db, { medicineId, medicineName, storeId, storeName, productCode, productId, packaging, company })`:
    - Resolves `medicine_id` from `medicines` table if not provided.
    - Performs an `INSERT ... ON CONFLICT(medicine_id, store_id, product_code) DO UPDATE` to keep the link fresh and prevent duplicate rows.
  - In `addItemsToPharmarackCart`:
    - Once an item is validated or added, call `autoSaveMedicineDistributorLink` to auto-persist the verified link.
  - In `GET /purchase-reorder-history`:
    - Check `medicine_distributor_links` for `store_id = matchedStoreId` and `medicine_id = r.medicine_id`.
    - Attach `isLinked`, `productCode`, and `productId`.

### Step 3: De-duplicate Suggestions by `(medicine_id, store_id)` in Frontend & Backend
- In `frontend/src/pages/PharmarackCart/index.tsx`:
  - In `getDistributorShortfallFillers`:
    - Build a de-duplication set using `medKey = item.medicineId ? `${item.medicineId}:::${dist.storeId}` : `${norm(item.medicineName)}:::${dist.storeId}``.
    - Check against items already in the live cart by `medicineId`, `productCode`, and normalized base name.
    - Ensure `dist.maxAmountLimit` and `dist.maxItemLimit` are checked so suggested fillers never push the order past distributor caps.
  - In the Shortfall Suggestion UI (lines 5584–5640):
    - Add `MedicineLinkModal` integration:
      - If `item.productCode` and `item.productId` are present: button says `+ Add (x{qty})`.
      - If not linked: show `Link` button (or clicking opens `MedicineLinkModal` pre-filtered for `dist.storeId` and `item.medicineName`).
      - Once linked from modal, the item becomes immediately addable.

### Step 4: Fix Matcher in `addItemsToPharmarackCart` & Improve Upstream Error Surfacing
- In `src/routes/pharmarack.ts`:
  - In `addItemsToPharmarackCart` (lines 1672–1678):
    - Remove the loose fallback `searchData.data.find(p => Number(p.StoreId) === Number(item.storeId))`.
    - Require that `p.ProductName` matches `wantName` (normalized name match).
    - If no product matches under the target distributor, return a descriptive error: `"${item.productName}" is not available under distributor "${item.storeName}"`.
  - When `AddUserProductCartDetail` upstream call fails (lines 1824–1834):
    - Extract `resJson.Message || resJson.message` and pass it back in `details` so the frontend displays the exact limit/rejection reason (e.g., maximum allowed quantity or order ceiling exceeded).

### Step 5: Verification & Safety Guardrails
- Run `npm run guardrails` (`tsc --noEmit` and performance scanner).
- Run `node scripts/quick-update.mjs` to synchronize the Auto-Knowledge Graph.

---

## Tasks & Progress Tracking

- [x] Task 1: Implement CRM Refill & Special Order Cancellation Cascades (`POST /refills/:id/cancel`, `DELETE /orders/:id`, and `checkAllRefills`)
- [x] Task 2: Backend Auto-Save & Verified Enrichment in `medicine_distributor_links` (`addItemsToPharmarackCart` & `purchase-reorder-history`)
- [x] Task 3: Fix Safety Matcher in `addItemsToPharmarackCart` and Surface Upstream Limit Errors
- [x] Task 4: Frontend De-duplication by `(medicine_id, store_id)` & `MedicineLinkModal` Integration in Live Cart Shortfall Fillers
- [x] Task 5: Run Guardrails & Update Knowledge Graph

---

## Completed Tasks Summary

### Task 1: Permanent CRM Refill & Special Order Cancellation Cascades
- **Refills API** (`src/routes/refills.ts`):
  - Created `POST /:id/cancel`: Atomically marks `patient_refills` row `status = 'cancelled', is_active = 0`, dismisses any pending automation reminders, removes live cart lines, and deletes linked special orders (`WHERE source_refill_id = ? OR (source = 'refill' AND phone = ? AND product = ?)`).
  - Updated `DELETE /:id` and `POST /delete-patient` to cascade cleanup to linked `special_orders`.
- **Orders API** (`src/routes/orders.ts`):
  - Updated `DELETE /orders/:id`: When a refill-originated special order is deleted, cascades to set `patient_refills` row `status = 'cancelled', is_active = 0` to prevent zombie resurrection.
- **Refill Worker** (`src/services/refillService.ts`):
  - Updated `checkAllRefills` to explicitly filter out `pr.status IN ('cancelled', 'deleted', 'completed')`, permanently terminating zombie order creation.

### Task 2: Backend Auto-Save & Verified Enrichment in `medicine_distributor_links`
- **Auto-Save Functionality** (`src/routes/pharmarack.ts`):
  - Added `autoSaveMedicineDistributorLinks(items)` to upsert into `medicine_distributor_links` keyed on `(medicine_id, store_id, product_code)`. Ensures the SQLite catalog database updates in real time on cart add and placed order without duplicate records.
  - Linked into `addItemsToPharmarackCart` and `POST /log-placed-order`.
- **Purchase History Enrichment** (`src/routes/pharmarack.ts`):
  - In `GET /purchase-reorder-history`, looks up `medicine_distributor_links` for `(medicine_id, store_id)` and attaches verified `product_code`, `product_id`, and `isMapped`.
  - Added strict name verification to catalog fallback so loose prefix queries cannot assign mismatched product codes.

### Task 3: Fix Safety Matcher in `addItemsToPharmarackCart` & Surface Upstream Limit Errors
- **Strict Product Verification** (`src/routes/pharmarack.ts`):
  - Enforced strict normalized product name matching when searching catalog/OpenSearch fallback, preventing arbitrary products from being picked for a store.
  - Refuses items missing `productCode`, returning a clear error requiring distributor linking.
- **Surface Upstream Rejection & Limits** (`src/routes/pharmarack.ts`):
  - Captured upstream distributor errors from `AddUserProductCartDetail` (`resJson.Message || resJson.Error`) and passes them back in `details` and `error` so pharmacists see exact quantity/amount caps rather than generic failures.

### Task 4: Frontend De-duplication by `(medicine_id, store_id)` & `MedicineLinkModal` Integration
- **Shortfall Suggestion Logic** (`frontend/src/pages/PharmarackCart/index.tsx`):
  - In `getDistributorShortfallFillers`, de-duplicates strictly by `(medicine_id, store_id)` using `medicineId` or canonical normalized name.
  - Excludes all items already present in the active live cart.
  - Caps suggested fillers against distributor `maxAmountLimit` and `maxItemLimit`.
- **Link & Add UI & Modal Wiring** (`frontend/src/pages/PharmarackCart/index.tsx`):
  - Linked items show `✓ Linked` badge and immediate `+ Add (x{qty})` button.
  - Unlinked items show `Link` badge and `Link & Add` button that opens `MedicineLinkModal` pre-filtered for that distributor and medicine.
  - Mounted `MedicineLinkModal` portal with automatic history refresh and user success toast.

### Task 5: Verification & Safety Guardrails
- `npm run guardrails`: Clean exit 0 (`tsc --noEmit` and performance scanner pass without violations).
- `npm run build:client`: Clean exit 0 (`tsc -b && vite build` bundled successfully in 48s).
- `node scripts/quick-update.mjs`: Knowledge graph successfully updated with 1,173 nodes and 783 edges.
