# Implementation Plan: Pharmarack PO-to-Inventory Linking & Online Website Order Workflow

## Goal
Build a completely separate, non-blocking workflow that connects:
1. **Side-by-Side Bill / Sent PO History Linking**: Compare saved bill/inventory medicine names (left) with the same distributor's Pharmarack Sent PO History items (right), allowing one-click linking, multi-distributor linking, manual edit/unlink (`MedicineLinkModal`), and auto-preservation (`medicine_distributor_links`).
2. **Inventory Page Link Status Views**: Separate `Already Linked`, `Broken Link`, and `Unlinked` filters on Inventory with one-by-one `MedicineLinkModal` linking/editing.
3. **24/7 Cloud Website Catalog & On-Demand Cart Check**:
   - Push Pharmarack-linked medicines (even with `0` local inventory) to the cloud catalog with **only the latest highest MRP** and availability (never distributor name, rate, or discount).
   - On-demand Pharmarack stock check **only when a patient adds a no-inventory linked product to their cart** (avoiding unnecessary API calls during browsing). Low/out-of-stock notifies both the patient and the app.
   - Support the ₹50 advance booking QR flow (`paymentQrService`), auto-adding confirmed bookings to the Pharmarack Live Cart, and sending a **closure/Sunday-aware 20–24h arrival confirmation** (`pharmacyCalendar.ts`, `marketClosureService.ts`, `closureNotice.ts`).
   - When the shop PC comes back online after being off, `pullCloudOrdersToLocal()` checks queued cloud orders against Pharmarack stock and follows up cleanly.

## Architecture & Guardrail Rules
- Completely separate & non-blocking: never blocks bill saving, POS, or existing refill flows.
- Single writer for links: `medicine_distributor_links` (same table as CRM `MedicineLinkModal` and `reconnectDistributorLinks`).
- Patient privacy: NEVER expose distributor name, purchase rate, or distributor discount on website search, cart check, cloud catalog sync, or customer WhatsApp messages — ONLY MRP.
- Local time only (`src/utils/localTime.ts`), semantic Tailwind tokens only, no native `alert()`/`confirm()`, run `npm run guardrails` and `node scripts/quick-update.mjs` after edits.

---

## Tasks

- [x] **Task 1: Backend PO-vs-Bill Comparative Linking Service & Routes**
  - Extended `src/services/billDistributorLinkService.ts` with `getBillPoComparison(purchaseId, days)` and `getPoOrderComparison(orderId)` reading `pharmarack_placed_orders` for the same distributor, plus `appendSingleMedicineLink` and `removeSingleMedicineLink`.
  - Added `GET /api/refills/bill-po-comparison/:purchaseId`, `GET /api/refills/po-comparison/:orderId`, `POST /api/refills/medicine-links/:medicineId/append`, and `DELETE /api/refills/medicine-links/:medicineId/:storeId/:productCode` in `src/routes/refills.ts` (and removed duplicate `POST /bill-links`).
- [x] **Task 2: Backend Inventory Link Filter (`linked` / `broken` / `unlinked`)**
  - Updated `GET /api/inventory` in `src/routes/inventory.ts` to support `link_filter` (`linked`, `broken`, `unlinked`) and enrich page rows with `link_count`, `broken_link_count`, and `linked_stores` in one chunked query.
- [x] **Task 3: Backend Website Search, On-Demand Cart Check, Cloud Sync & Offline Follow-Back**
  - Created `src/services/pharmarackWebsiteOrderHelper.ts` (`checkLinkedPharmarackStock`, `buildClosureAwareEtaNote`, `addConfirmedWebsiteItemToLiveCart`).
  - Updated `src/services/cloudCatalogSyncService.ts` (`pushLocalCatalogToCloud` includes Pharmarack-linked items with highest MRP only; `pullCloudOrdersToLocal` runs offline-to-online Pharmarack check & Live Cart add when confirmed).
  - Updated `src/routes/websiteOrders.ts`: `GET /medicines/search` exposes Pharmarack-linked items with `Available (Order)` and MRP only (zero browse-time Pharmarack calls); added `POST /medicines/cart-check` for on-demand qty checks + low-stock toast; updated `POST /orders/:id/confirm-payment` to auto-add to Live Cart and send closure/Sunday-aware 20–24h arrival WhatsApp.
- [x] **Task 4: Frontend API & Components (Side-by-Side PO Comparison Modal + Inventory Link Tabs)**
  - Added `PoOrderItemCandidate`, `BillPoComparisonRow`, `BillPoComparisonResult`, and API methods in `frontend/src/services/api.ts` and `frontend/src/types/api.ts`.
  - Created `frontend/src/components/BillPoComparisonModal.tsx` and wired it into `SaveBillSpecialPriceModal.tsx` ("Compare with Sent PO") and `PharmarackCart/index.tsx` ("Link PO" on Sent Orders).
  - Added `All Links` / `Already Linked` / `Broken Link` / `Unlinked` filter, per-row link status chips, and drawer "Link Distributor" button in `frontend/src/pages/Inventory/index.tsx`.
- [x] **Task 5: Verification, Guardrails & DOX/Knowledge Graph Sync**
  - Backend & frontend `npx tsc --noEmit` exited 0.
  - `npm run guardrails` exited 0 (`PASS — no guardrail violations. Speed architecture intact.`).
  - `node scripts/quick-update.mjs` run to refresh `.understand-anything/knowledge-graph.json`.
