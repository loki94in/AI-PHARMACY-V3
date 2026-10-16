# Implementation Plan: Same-Distributor Multi-Order Medicine Line Items Fix

## 1. Problem & Root Cause Analysis
- **Symptom**: When a distributor has multiple orders on the same day (such as "A.S. Distributors" on 2026-10-16 with orders `ASD464330` and `ASD464181`), the first order shows its complete medicine list, but the second order displays `"Placed on the Pharmarack website — product lines not available yet."` and has no medicines listed.
- **Root Cause**:
  1. `pharmarack_synced_orders` records `order_no` and `pharmarack_order_id`, but has no `items_json` column.
  2. When `runSync()` originally ran, it only inserted the first order for that distributor into `pharmarack_placed_orders` and left the second order (`ASD464181`) unrecorded in `pharmarack_placed_orders`.
  3. `fillOrderLines()` only updates rows that exist in `pharmarack_placed_orders`. Because no row existed for `ASD464181`, `fillOrderLines()` skipped fetching its lines.
  4. In `src/routes/pharmarack.ts` (`GET /api/pharmarack/sent-orders`), externally synced orders without a matching `pharmarack_placed_orders` row are pushed to `parsedOrders` with `items: []` hardcoded.
  5. In `frontend/src/pages/PharmarackCart/index.tsx`, when `order.items` is empty, it renders `<p>Placed on the Pharmarack website — product lines not available yet.</p>`.

---

## 2. Proposed Changes & Architecture

### Backend:
1. **`src/services/pharmarackOrderSyncService.ts`**:
   - In `fillOrderLines()`: If an order in `orders` does not have a row in `pharmarack_placed_orders`, create a row for it in `pharmarack_placed_orders` and store its fetched line items.
   - In `runSync()`: Ensure every distinct `orderNo` is always checked against `pharmarack_placed_orders`. If missing from `pharmarack_placed_orders`, insert it so its lines are fetched and tracked.
   - Add backfill helper `backfillMissingOrderLines()`: Scans recent orders (today & past days) that are in `pharmarack_synced_orders` or `pharmarack_placed_orders` with empty `items_json`, fetches their lines from Pharmarack `GetOrderDetailsForRetailerManager`, and persists them into `pharmarack_placed_orders`.

2. **`src/routes/pharmarack.ts`**:
   - In `GET /api/pharmarack/sent-orders`: When surfacing synced orders that do not yet have lines, check `pharmarack_placed_orders` by `order_no` or trigger a fast non-blocking fetch so `items` is populated with real products instead of empty `[]`.
   - Ensure the repair/backfill runs automatically on startup/route access so orders like `ASD464181` are immediately fixed in the database.

---

## 3. Verification Plan
1. **Live Data Verification**:
   - Verify that order `ASD464181` has its 3 products (`NIOGENTA F CREAM 20 GMS` x1, `LEVIPIL 750 TAB 10TAB` x1, `SARIDON 10 TAB` x10) properly stored in `pharmarack_placed_orders.items_json`.
2. **API Verification**:
   - Call `GET /api/pharmarack/sent-orders?date=2026-10-16` and ensure both `ASD464330` and `ASD464181` return their complete `items` array.
3. **Frontend Verification**:
   - Inspect `Sent Orders` tab: Both cards for `A.S. Distributors` appear with their respective PO numbers (`PO #ASD464330` and `PO #ASD464181`), timestamps, item counts, and itemized medicine lists with checkboxes and search buttons.
4. **Performance & Build Guardrails**:
   - Run backend `tsc --noEmit`.
   - Run frontend `tsc -p frontend/tsconfig.app.json --noEmit`.
   - Run `npm run guardrails`.
   - Run `node scripts/quick-update.mjs`.

---

## 4. Task Checklist
- [x] Task 1: Add automated backfill and line fetching for synced orders in `pharmarackOrderSyncService.ts`
- [x] Task 2: Update `GET /api/pharmarack/sent-orders` in `src/routes/pharmarack.ts` to guarantee populated items
- [x] Task 3: Execute backfill for existing order `ASD464181` and verify live database contents
- [x] Task 4: Verify TypeScript compilation, performance guardrails, and knowledge graph update

---

## 5. Task Completion Log

### Task 1: Automated Backfill and Line Fetching for Synced Orders
- **Files**: [`src/services/pharmarackOrderSyncService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/pharmarackOrderSyncService.ts)
- **Completed**:
  - Exported `fetchOrderLines` so detail lookups can be called by sync and backfill services.
  - In `fillOrderLines`: If a placed order row does not exist for an order, automatically inserts a placed order row with `(order_date, store_id, store_name, order_no, items_json)` so fetched lines are saved and tracked.
  - In `runSync`: Even if an order is already known in `pharmarack_synced_orders`, checks if `pharmarack_placed_orders` has the row, inserting it if missing so lines are fetched on the current run.
  - Added `backfillSyncedOrderLines(targetDate?: string)`: Scans synced orders for missing placed rows or empty `items_json`, calls Pharmarack `GetOrderDetailsForRetailerManager`, and persists items into `pharmarack_placed_orders.items_json`.
- **How Completed**: Implemented functions and verified with execution script.

### Task 2: Sent Orders Endpoint Line Guarantee
- **Files**: [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)
- **Completed**:
  - In `GET /api/pharmarack/sent-orders`: Invokes `backfillSyncedOrderLines(targetDate)` automatically so all placed orders are loaded with their items.
  - In the unattached fallback loop: Queries `pharmarack_placed_orders` by `order_no` rather than returning an empty `items: []` array.
- **How Completed**: Refactored endpoint logic and verified query response.

### Task 3: Live Data Verification for Order `ASD464181`
- **Completed**:
  - Executed `backfillSyncedOrderLines('2026-10-16')`.
  - Verified in `app.dev.db` that Order `ASD464181` now exists as row #79 in `pharmarack_placed_orders` with 3 medicines:
    1. `NIOGENTA F CREAM` (Qty: 1, Rate: 211.81, Pack: 20 GMS)
    2. `LEVIPIL 750 TAB` (Qty: 1, Rate: 158.42, Pack: 10TAB)
    3. `SARIDON` (Qty: 10, Rate: 39.28, Pack: 10 TAB)
  - Placed orders count on 2026-10-16 is now 16 (both A.S. orders side-by-side with full items).

### Task 4: Performance Guardrails & Compilation
- **Completed**:
  - `tsc --noEmit` on backend passed (0 errors).
  - `tsc -p frontend/tsconfig.app.json --noEmit` on frontend passed (0 errors).
  - `npm run guardrails` passed (0 violations, speed architecture intact).
  - `node scripts/quick-update.mjs` completed (knowledge graph updated in 4.9s).

