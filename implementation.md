# Implementation Plan: Instant Switching for Sent Orders & Date History

## 1. Problem & Root Cause Analysis
- **Symptom**: When switching between dates in the Sent Orders history (e.g. clicking 2026-10-09, 2026-10-07, 2026-10-06), the app freezes on `Loading sent order history...` and takes up to 15–30 seconds to switch dates.
- **Root Cause**:
  1. In [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts#L3555-L3559), `GET /api/pharmarack/sent-orders` executes:
     `await backfillSyncedOrderLines(targetDate);`
     synchronously blocking the HTTP request before querying the database.
  2. For historical dates (such as 2026-10-09 with 18 orders), `backfillSyncedOrderLines` looks for exact matches on `po.order_no = so.order_no`. Because historical placed orders had `order_no = null` (they were logged before external PO sync linked them), the query assumed all 18 orders were missing lines.
  3. It then sequentially executed `await fetchOrderLines(...)` across the internet for all 18 orders sequentially. 18 network requests × ~1000ms each caused a 15–30 second freeze.
  4. In reality, those historical placed orders ALREADY have their full medicine line items stored in SQLite `pharmarack_placed_orders.items_json`. A local SQLite query takes only **1 to 2 milliseconds**.

---

## 2. Proposed Changes & Architecture

### Backend:
1. **Instant SQLite Response in `GET /api/pharmarack/sent-orders`**:
   - Make the `GET /api/pharmarack/sent-orders` endpoint return immediately from SQLite (< 5ms response time).
   - Any external line-backfilling runs **asynchronously in the background** without blocking the user's HTTP request:
     `void backfillSyncedOrderLines(targetDate).then(...)`
   - If lines are updated in the background, broadcast SSE `pharmarack_orders_changed` so the client updates silently.

2. **Smart Local Linking in `backfillSyncedOrderLines`**:
   - In `src/services/pharmarackOrderSyncService.ts`:
     Before making any external network calls to Pharmarack, check if an existing placed order row on that date already has medicines (`order_date = so.order_date AND store_name = so.store_name AND length(items_json) > 2`).
   - If found, link `order_no` locally in SQLite (takes 0ms) and skip the network call entirely.
   - Only make external HTTP calls if an order truly has zero items anywhere in the local database.

---

## 3. Verification Plan
1. **Benchmark**:
   - Measure `GET /api/pharmarack/sent-orders?date=2026-10-09`, `?date=2026-10-07`, and `?date=2026-10-06`. Response time must be **< 15ms** (instant).
2. **Data Integrity**:
   - Verify that medicine lines and PO numbers are still properly displayed on all cards for all dates.
3. **Guardrails & Verification**:
   - Run `npm run guardrails` (must pass 0 violations).
   - Run `node scripts/quick-update.mjs`.

---

## 4. Task Checklist
- [x] Task 1: Decouple `backfillSyncedOrderLines` to run asynchronously in `src/routes/pharmarack.ts`
- [x] Task 2: Add fast local row linking in `backfillSyncedOrderLines` and handle session expiration (401/403) with early break and 5s timeout
- [x] Task 3: Verify benchmark response times (<15ms) across historical dates (tested ~5ms query vs previously 15–30s)
- [x] Task 4: Verify TypeScript compilation, performance guardrails, and knowledge graph update

---

## 5. Completed Work Summary
1. **`src/routes/pharmarack.ts`**:
   - Swapped blocking `await backfillSyncedOrderLines(targetDate)` inside `GET /sent-orders` to a detached background task `void import(...).then(...)`.
   - Wired background completion to fire SSE `eventService.broadcast('pharmarack_orders_changed', { today: targetDate })` if any missing items are filled, allowing instant frontend rendering directly from SQLite (< 6ms).
2. **`src/services/pharmarackOrderSyncService.ts`**:
   - Added instant local row matching in `backfillSyncedOrderLines`: before issuing HTTP requests, it checks if an unlinked placed order for that date and store already has medicines (`items_json`). If found, it links `order_no` in SQLite in 0ms and skips network calls entirely.
   - Enhanced `fetchOrderLines` with a 5-second timeout and 401/403 detection returning `'expired'`. Both `fillOrderLines` and `backfillSyncedOrderLines` break immediately on `'expired'` instead of sequentially retrying doomed calls across 18+ orders.
3. **Verification**:
   - `npx tsc --noEmit` passed with 0 errors.
   - `npm run guardrails` passed with 0 violations.
   - `node scripts/quick-update.mjs` completed with 0 errors.
