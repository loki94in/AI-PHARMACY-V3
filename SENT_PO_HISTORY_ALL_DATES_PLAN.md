# Sent PO History All Dates & Complete Sync Implementation Plan

## Problem Statement
In the application, the Sent PO History tab in Pharmarack Cart was missing historical dates (including Nov 11, where 20 orders were placed on Pharmarack).
Investigation identified four root causes:
1. **HTTP 406 Error on Historical Sync**: `runHistoricalSync` in `src/services/pharmarackOrderSyncService.ts` called Pharmarack's `DisplayOrders` API with `pageSize: 200`. Pharmarack strictly caps page size at 100, rejecting `pageSize: 200` with `HTTP 406 Not Acceptable`. This caused background historical sync to fail silently on every attempt.
2. **Lack of Multi-Page Pagination**: `runHistoricalSync` only fetched page 1, which truncates any orders beyond page 1 for pharmacies with higher order volumes.
3. **Date Normalization in Queries**: `GET /api/pharmarack/sent-orders/dates` and `GET /api/pharmarack/sent-orders` in `src/routes/pharmarack.ts` queried exact strings without normalizing `substr(order_date, 1, 10)`, risking mismatches when timestamps or full ISO strings are stored.
4. **UI Month Collapsing & Missing On-Demand Trigger**: In `frontend/src/pages/PharmarackCart/index.tsx`, older months were collapsed by default and split from recent days, making past dates hard to discover, with no user-triggered "Sync History" button on the Sent PO History view.

---

## User Review Required

> [!IMPORTANT]
> The historical sync will ingest past external orders from Pharmarack up to 60 days into local SQLite (`pharmarack_synced_orders` and `pharmarack_placed_orders`).
> As designed by system contracts, past orders do NOT trigger WhatsApp notifications to distributors—only present-day orders trigger dispatch notifications.

---

## Step-by-Step Proposed Changes

### Phase 1: Backend Historical Sync Fix & Multi-Page Pagination
- File: `src/services/pharmarackOrderSyncService.ts`
  - In `fetchDisplayOrders`, allow pagination by accepting `pageNo?: number`.
  - In `runHistoricalSync`, change `pageSize` from `200` to `100`.
  - Add pagination loop in `runHistoricalSync`: fetch page 1, 2, 3... up to 5 pages (up to 500 orders) or until a page returns 0 new orders or < 100 items.
  - Normalize dates with `orderDayIso(...)`.

### Phase 2: Resilient Date Queries in Backend Routes
- File: `src/routes/pharmarack.ts`
  - In `GET /api/pharmarack/sent-orders/dates`: normalize to `substr(order_date, 1, 10)` in `DISTINCT` union.
  - In `GET /api/pharmarack/sent-orders`: query `WHERE (order_date = ? OR substr(order_date, 1, 10) = ?)` to match both pure dates and timestamped dates.

### Phase 3: Frontend Sent History UI & Manual Sync Button
- File: `frontend/src/pages/PharmarackCart/index.tsx`
  - Ensure the current month accordion in `olderMonthGroups` is auto-expanded by default so all current-month historical dates are immediately visible.
  - Add an "Expand All / Collapse All" toggle for month folders.
  - Add an on-demand "Sync History" button in the Sent PO History header that calls `POST /api/pharmarack/sync-historical-orders` with a spinner and refreshes the date list and current date orders upon completion.

### Phase 4: Verification & Human-in-the-Loop Review
- Run immediate historical sync against `G:\AI Pharmacy OS\data\app.db` to pull missing dates (including Nov 11).
- Verify that Nov 11 and all other historical dates are present in SQLite.
- Run `npm run guardrails` to guarantee TypeScript types, lint, and architecture contracts pass.
- Run `node scripts/quick-update.mjs` to keep knowledge graph up to date.

---

## Verification Plan

### Automated Tests / Verification
- Guardrails check: `npm run guardrails`
- Live database check: verify `pharmarack_synced_orders` and `pharmarack_placed_orders` include `2026-11-11` and all past dates.

### Manual Verification
- Open Sent PO History tab in UI.
- Verify `2026-11-11` and all past dates appear in the history list.
- Click on dates to verify order items, distributor names, and order numbers render correctly.
- Test "Sync History" button.

---

## Tasks Progress

- [x] Task 1: Fix `fetchDisplayOrders` and `runHistoricalSync` in `src/services/pharmarackOrderSyncService.ts` (pageSize 100 + pagination loop)
- [x] Task 2: Update `GET /api/pharmarack/sent-orders/dates` and `GET /api/pharmarack/sent-orders` in `src/routes/pharmarack.ts` (resilient date normalization with `substr(order_date, 1, 10)`)
- [x] Task 3: Enhance `frontend/src/pages/PharmarackCart/index.tsx` (auto-expand latest older month group by default, "Expand All / Collapse All" toggle, on-demand "Sync History" button with live spinner and count)
- [x] Task 4: Execute historical sync on live DB and verify data (fetched 217 orders, imported 71 missing orders including Nov 11)
- [x] Task 5: Run `npm run guardrails` (PASS: clean TypeScript compilation, 0 guardrail violations) and `node scripts/quick-update.mjs`
- [x] Task 6: Final Human-in-the-Loop summary & verification report
