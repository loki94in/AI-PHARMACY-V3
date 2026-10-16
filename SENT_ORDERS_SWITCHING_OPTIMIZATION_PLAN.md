# Implementation Plan: Instant Switching for Sent Orders & Date History (Archived)

## 1. Problem & Root Cause Analysis
- **Symptom**: When switching between dates in the Sent Orders history (e.g. clicking 2026-10-09, 2026-10-07, 2026-10-06), the app freezes on `Loading sent order history...` and takes up to 15–30 seconds to switch dates.
- **Root Cause**:
  1. In `src/routes/pharmarack.ts`, `GET /api/pharmarack/sent-orders` executed `await backfillSyncedOrderLines(targetDate);` synchronously blocking the HTTP request before querying the database.
  2. For historical dates (such as 2026-10-09 with 18 orders), `backfillSyncedOrderLines` looked for exact matches on `po.order_no = so.order_no`. Because historical placed orders had `order_no = null` (logged before external PO sync linked them), the query assumed all 18 orders were missing lines.
  3. It then sequentially executed `await fetchOrderLines(...)` across the internet for all 18 orders sequentially. 18 network requests × ~1000ms each caused a 15–30 second freeze.
  4. In reality, those historical placed orders ALREADY had their full medicine line items stored in SQLite `pharmarack_placed_orders.items_json`. A local SQLite query takes only 1 to 2 milliseconds.

---

## 2. Changes & Architecture Completed in v0.1.108
1. Decoupled `backfillSyncedOrderLines` to run asynchronously in `src/routes/pharmarack.ts`.
2. Added fast local row linking in `backfillSyncedOrderLines` and handled session expiration (401/403) with early break and 5s timeout.
3. Verified benchmark response times (<15ms) across historical dates.
4. Released in version v0.1.108.
