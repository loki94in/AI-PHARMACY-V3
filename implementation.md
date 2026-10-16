# Implementation Plan: Distinct Sent PO Orders & Same-Day Multi-Order Display

## Overview
Currently, when multiple orders are placed for the same distributor on the same day, the backend order sync and `GET /api/pharmarack/sent-orders` endpoint collapsed all orders into a single store entry, grouping all PO numbers onto the first card while omitting the second order's distinct card and its itemized medicines.
This task ensures that every order placed on the same day is tracked by its unique `order_no`, has its medicine line items fetched and stored individually, and renders as its own plain, complete order card in the Sent PO History view with its own store name, PO badge, timestamp, and medicine items — exactly matching the existing standard order card design.

---

## Tasks

- [x] **Task 1: Backend Sync & Line Items Tracking by `order_no`**
  - **Files**: `src/services/pharmarackOrderSyncService.ts`
  - **Action**:
    - Updated `pollOrdersOnce`: When a synced order arrives, query `pharmarack_placed_orders` by `order_no = ?`. If an in-app order exists for today with `order_no IS NULL`, attached the `order_no` to it. If none, inserted a new distinct row for this `order_no` instead of skipping if the store already has an order today.
    - Updated `syncHistoricalPharmarackOrders`: Matched by `order_no` first, and only attached to in-app orders if `(order_no IS NULL OR order_no = '')`, preventing same-day multiple orders from overwriting or skipping each other.
    - Updated `fillOrderLines`: Queried and updated each order row by its unique `order_no` instead of store-level grouping. Fetched and stored the medicine lines for each order independently into its respective `items_json`.
  - **Verification**: Verified that distinct rows are created and updated in `pharmarack_placed_orders` for each `order_no`, each with populated `items_json`.

- [x] **Task 2: API Endpoint Refactor for Distinct Sent Orders**
  - **Files**: `src/routes/pharmarack.ts`
  - **Action**:
    - In `GET /api/pharmarack/sent-orders`, eliminated the store-level order number collapse (`syncedByStore`).
    - Kept each order's `order_no` strictly scoped to that individual order record (`pharmarack_order_nos: [order_no]`).
    - Allowed unattached in-app placed orders to claim at most one unassigned synced order (1-to-1) so order IDs never bleed across orders.
    - Surfaced any remaining synced orders as distinct cards without suppressing them due to shared store names.
  - **Verification**: Verified that `GET /api/pharmarack/sent-orders?date=...` returns an array of separate orders for the same distributor, each with its own `order_no` and `items`.

- [x] **Task 3: Frontend Sent PO History & Side-by-Side Multi-Order Display**
  - **Files**:
    - `frontend/src/pages/PharmarackCart/index.tsx`
    - `frontend/src/pages/PharmarackCart/SingleDispatchModal.tsx`
    - `frontend/src/services/api.ts`
  - **Action**:
    - Added `order_no?: string | null;` and `source?: string;` to `PharmarackSentOrder` in `api.ts` and `LocalSentOrder` in `PharmarackCart/index.tsx`.
    - In `PharmarackCart/index.tsx`: Sorted sent orders by store name and placement timestamp (`(a.placed_at || 0) - (b.placed_at || 0)`) so same-day orders for the same distributor appear side-by-side in the 2-column grid in chronological sequence.
    - Updated card keying to use unique order numbers (`${order.id}-${order.order_no || 'app'}`).
    - Formatted PO ID badge clearly as `PO #{no.replace(/^#+/, '')}`.
    - In `SingleDispatchModal.tsx` & `handleOpenSingleDispatchModal`: When opening single dispatch for a distributor with unsent items, kept `singleDispatchOrderNo` clean rather than pre-filling the morning's order number, allowing the new order to have its own clean PO number assigned.
  - **Verification**: Verified that placing multiple orders for the same distributor on the same day displays separate, distinct cards side-by-side in Sent PO History, each with its own PO ID, timestamp, and medicines list.

- [x] **Task 4: Quality & Performance Guardrails Verification**
  - **Action**:
    - Ran backend `tsc --noEmit` -> Exit code 0 (0 compilation errors).
    - Ran frontend `tsc -p frontend/tsconfig.app.json --noEmit` -> Exit code 0 (0 compilation errors).
    - Ran `npm run guardrails` -> 48 files checked, 0 violations, speed architecture intact.
    - Ran `node scripts/quick-update.mjs` -> Knowledge graph synchronized in 3.9 seconds.
  - **Verification**: All commands pass with exit code 0.

---

## Task Completion Log

### Task 1: Backend Sync & Line Items Tracking by `order_no`
- **Root Cause**: `pollOrdersOnce`, `syncHistoricalPharmarackOrders`, and `fillOrderLines` in `src/services/pharmarackOrderSyncService.ts` collapsed orders by `(order_date, store_name)`. If an order already existed for that store today, subsequent orders were skipped, and line items were never fetched for them.
- **Resolution**: Keyed order lookups and updates strictly by `order_no`. In-app placed orders without an order number can claim unassigned synced orders 1-to-1. Distinct orders on the same day now each create their own row in `pharmarack_placed_orders` and fetch their own line items via `fillOrderLines`.

### Task 2: API Endpoint Refactor for Distinct Sent Orders
- **Root Cause**: In `src/routes/pharmarack.ts` (`GET /api/pharmarack/sent-orders`), all order numbers for a distributor were lumped together into `syncedByStore` and attached to the first placed order card (`pharmarack_order_nos: [order1, order2]`). The second order in `syncedOrdersList` was then flagged as `alreadyHasOrderNo` and suppressed from rendering.
- **Resolution**: Refactored the endpoint so each order maintains its own `order_no` (`pharmarack_order_nos: [order_no]`). Every placed order row and synced order is returned as an independent object, preventing cards from collapsing together.

### Task 3: Frontend Sent PO History & Side-by-Side Multi-Order Display
- **Root Cause**: Cards for the same distributor were not sorted chronologically, and `SingleDispatchModal` was prefilling previous order IDs into new dispatches.
- **Resolution**: In `frontend/src/pages/PharmarackCart/index.tsx`, sorted orders by store name and then chronologically (`a.placed_at - b.placed_at`). When mapped to the 2-column grid (`grid-cols-1 lg:grid-cols-2`), same-day orders for the same distributor appear side-by-side. Updated `SingleDispatchModal` to start with a clean input when unsent items exist. Added `order_no` to `LocalSentOrder` and `PharmarackSentOrder`.

### Task 4: Automated Verification Gates
- **TypeScript**: Backend and frontend compilation verified cleanly (`tsc --noEmit` exit code 0).
- **Guardrails**: `npm run guardrails` verified with 0 violations.
- **Knowledge Graph**: `node scripts/quick-update.mjs` executed cleanly in 3.9s.
