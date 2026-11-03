# Implementation Plan: Reorder Hub Always-Visible Multi-Distributor Rates & Zero-Popup Rapid Add

**Plan Name:** `reorder_hub_always_visible_multi_distributor_rates`  
**Target:** Eliminate all hidden pricing, multi-step confirmation popups, and single-distributor limitations in Reorder Hub ([`PharmarackCart/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx) and [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts)).

---

## 1. Problem Statement & Root Cause

1. **Hidden Rates in Reorder Hub**:
   - In Live Cart Add ([`LiveCartSearchSection.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartSearchSection.tsx)), rates (PTR), MRP, Scheme, and distributor options are directly visible during booking time.
   - In Reorder Hub, rates and prices are either completely missing (e.g. Refills Due cards) or hidden behind an invasive modal (`reorderSameModalTarget` "REORDER SAME MEDICINE").
   - Users are forced to click "Add to Cart" or "Reorder", wait for the popup to open, check the price inside the popup, and click "Confirm" to proceed.
2. **Single Distributor Discarding**:
   - In [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts#L3505-L3513), the query uses `ROW_NUMBER() = 1` partitioned by `medicine_id` only. If a medicine was purchased from Distributor A at ₹22 and Distributor B at ₹20.50, Distributor B was completely dropped from suggestions.
3. **Excessive Clicking & Lack of Comparison**:
   - Users cannot see at a glance on the screen which distributor offers the best rate before selecting the medicine.

---

## 2. Architecture & Solution Strategy

### A. Backend: Multi-Distributor Rate Enrichment in `/sales/reorder-suggestions`
- Update [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts):
  - Partition purchase items by both `medicine_id` and `distributor_id` to get the most recent purchase rate for **each** distributor.
  - Collect all mapped distributor links for each medicine from `medicine_distributor_links`.
  - Return `distributorOptions: Array<{ distributorId, distributorName, storeId, storeName, rate, mrp, scheme, lastDate, productCode, productId, isBestRate }>` for each suggestion.
  - Mark the lowest effective rate as `isBestRate: true`.
  - Maintain backward compatibility with existing single-object fields (`ptr`, `mrp`, `storeName`, etc.) defaulted to the best-rate option.

### B. Frontend: Reorder Pricing Resolution Across All Categories
- In [`frontend/src/pages/PharmarackCart/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx):
  - Construct a unified lookup memo `reorderPricingLookup` indexed by both `medicineId` and normalized `medicineName`.
  - Enrich **Special Requests**, **Refills Due**, **Sales Restock**, **Recent Orders**, and **Past Purchase Bills** with full distributor options, PTR, MRP, Scheme, and Best Rate tags.

### C. Frontend: Always-Visible Rate Strips & Selectable Multi-Distributor Chips
- On every card in Reorder Hub:
  - Display the Rate (PTR) and MRP in a bold, high-contrast, semantic color format (`PTR: ₹{rate}` in `text-emerald-400`, `MRP: ₹{mrp}` in `text-muted`).
  - If a medicine has multiple distributor options (e.g. Distributor A: ₹22, Distributor B: ₹20.50 [Best Rate]):
    - Render compact interactive distributor pills directly on the card.
    - Default to the Best Rate distributor.
    - Allow switching distributor with 1 click right on the card.

### D. Zero-Popup Direct Add (`executeReorderAdd`)
- Implement `executeReorderAdd` to optimistically add items to the target distributor's cart without requiring the `reorderSameModalTarget` popup.
- Keep inline quantity selector (`- [qty] +`) on the card.
- Provide instant visual feedback (`✓ In [Distributor] Cart`) and human-in-the-loop control (adjust qty or dismiss).
- Keep `reorderSameModalTarget` available only if the user explicitly clicks a secondary "View History / Invoice Record" link, never as a blocker to viewing prices or adding to cart.

---

## 3. Tasks & Execution Status

- [x] Task 1: Update [`src/routes/sales.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/sales.ts) to enrich reorder suggestions with multi-distributor purchase rates & links
  - Partitioned purchase items by `(pi.medicine_id, p.distributor_id)` to keep all distributor history instead of discarding them.
  - Attached `distributorOptions` with calculated `isBestRate` flag pointing to lowest positive rate.
- [x] Task 2: Update [`frontend/src/services/api.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts) and [`frontend/src/types/api.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/types/api.ts) to define `ReorderDistributorOption`
  - Added `ReorderDistributorOption` with full typing across both types and API service layers.
- [x] Task 3: Build unified `reorderPricingLookup` in [`frontend/src/pages/PharmarackCart/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)
  - Built memoized lookup indexed by both medicine ID and normalized lower-case medicine name, bridging prices to Refills and Requests.
- [x] Task 4: Add always-visible rate strips & multi-distributor chips across all Reorder Hub categories (All Matches, Special Requests, Refills Due, Sales Restock, Recent Orders, Past Purchases)
  - Implemented standalone `ReorderMedicineCard` with inline PTR (emerald), MRP, Scheme, and interactive distributor comparison pills.
  - Rolled out across All Matches (Categories 1-5), Requests, Refills, Sales Restock, Ordered Recently, and Past Purchases.
- [x] Task 5: Implement zero-popup 1-click `executeReorderAdd` with inline quantity control & human-in-the-loop feedback
  - Replaced intrusive confirmation modals with instant optimistic cart update, non-blocking background dispatch, and undo/rollback.
- [x] Task 6: Verify guardrails (`npm run guardrails`) and update knowledge graph (`node scripts/quick-update.mjs`)
  - `npm run guardrails` verified: `tsc --noEmit` passed with 0 errors; semantic colors verified; speed architecture intact.
  - `node scripts/quick-update.mjs` synchronized knowledge graph nodes and edges.
