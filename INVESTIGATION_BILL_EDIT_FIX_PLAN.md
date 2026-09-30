# Investigation Center Sell Bill Edit & Inventory Reconciliation Implementation Plan

## Objective
Fix the issue where editing a sale bill from the Investigation Center causes the bill and items to go missing on the Investigation timeline and Sells page, and reconcile inventory stock and active status accurately.

---

## Root Causes Identified
1. **Missing Snapshots in `sale_items`**: `PUT /api/investigation/sales/:invoiceId` inserted rows without snapshot columns (`medicine_name_snapshot`, `batch_no_snapshot`, `expiry_date_snapshot`, `mrp_snapshot`, `tax_percent_snapshot`, `discount_per`, `cgst_value`, `sgst_value`).
2. **Strict `INNER JOIN` in Investigation Timeline**: `GET /api/investigation/timeline` joined `inventory_master` and `medicines` with `JOIN` instead of `LEFT JOIN`, causing bills with modified, depleted, or unlinked inventory IDs to completely vanish from the timeline.
3. **Missing `refreshInventoryActiveStatus`**: When stock changed to/from 0 in investigation adjustments, `is_active` in `inventory_master` remained stale.
4. **Missing SSE Sync Events**: Investigation adjustments did not broadcast `inventory_changed` events to all active SPA pages.
5. **Frontend Field Loss on Edit**: Investigation edit state was missing metadata fields (`expiry_date`, `mrp`, `cgst_per`, `sgst_per`, `medicine_id`) needed for complete bill rebuilding and human-in-the-loop preview.

---

## Tasks Checklist

- [x] **Task 1: Fix Investigation Timeline Query (`src/routes/investigation.ts`)**
  - Changed `JOIN inventory_master` and `JOIN medicines` to `LEFT JOIN` with snapshot `COALESCE` fallbacks in `salesQuery`.
  - Updated timeline query filters (`medicineName`, `batchNo`, `party`, `q`) to search both live inventory links and immutable snapshot fields.

- [x] **Task 2: Overhaul `PUT /api/investigation/sales/:invoiceId` (`src/routes/investigation.ts`)**
  - Implemented atomic inventory stock restoration for previous items and stock deduction for updated items.
  - Calculated exact GST breakdown, subtotal, total, and roundoff using shared `calculateSalesGstAndTotals`.
  - Inserted full `sale_items` rows including all snapshot columns (`medicine_name_snapshot`, `batch_no_snapshot`, `expiry_date_snapshot`, `mrp_snapshot`, `tax_percent_snapshot`, `discount_per`, `cgst_value`, `sgst_value`).
  - Added calls to `refreshInventoryActiveStatus` for all touched inventory rows.
  - Broadcasted `sales_sync`, `inventory_sync`, and `inventory_changed` SSE events.

- [x] **Task 3: Fix `PUT /api/investigation/inventory/:inventoryId` & `PUT /api/investigation/purchases/:purchaseId` (`src/routes/investigation.ts`)**
  - Added `refreshInventoryActiveStatus` on adjusted inventory records.
  - Broadcasted `inventory_changed` and `inventory_sync` SSE events.

- [x] **Task 4: Enhance Investigation Frontend Bill Edit Modal (`frontend/src/pages/Investigation/index.tsx`)**
  - Retained and mapped full item fields (`medicine_id`, `expiry_date`, `mrp`, `pack_size`, `discount_per`, `original_qty`) during bill edit.
  - Ensured added medicines include complete metadata.
  - Preserved human-in-the-loop confirmation modal with before/after delta preview.

- [x] **Task 5: Upgrade Sells & Sales PUT (`src/routes/sales.ts`)**
  - Exported `calculateSalesGstAndTotals`.
  - Updated `GET /sales/list` search subquery to search snapshot fields in addition to live inventory links.
  - Ensured `PUT /sales/:id` populates all snapshot columns, refreshes active status, and broadcasts `inventory_changed`.

- [x] **Task 6: Verification & Guardrails**
  - Ran `npm run guardrails` (passed with 0 errors).
  - Verified clean TypeScript compilation.
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
