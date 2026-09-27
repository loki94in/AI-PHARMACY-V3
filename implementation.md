# Implementation Tracking — Website & Special Orders: Restore Cancelled Order & Multi-Item Order Modification

## Plan Reference
See `WEBSITE_AND_SPECIAL_ORDERS_RESTORE_AND_MULTI_ITEM_EDIT_PLAN.md` for full requirements and architectural context.

## Tasks Status
- [x] Task 1: Backend Restore Endpoints in `src/routes/websiteOrders.ts` and `src/routes/orders.ts`
  - *Completed*: Added `POST /api/website/orders/:orderId/restore` and `POST /api/orders/:id/restore`. Both transactionally update order status to `'Pending'`, reset verification status, record an `order_tracking_events` audit event, and trigger SSE event broadcasting (`broadcastOrdersChanged()`).
- [x] Task 2: Backend Multi-Item Order Management Endpoints (`GET /api/orders/:id/items` and `PUT /api/orders/:id/items`)
  - *Completed*: Added `GET` and `PUT` endpoints to both `websiteOrders.ts` and `orders.ts`. Fetches items from `online_order_items` with fallback to header fields for single-item requests. Updates items transactionally, recalculates order quantity and total amount, syncs `special_orders` header values, logs tracking events, and optionally dispatches an updated WhatsApp order summary.
- [x] Task 3: Frontend API Services in `frontend/src/services/api.ts`
  - *Completed*: Exposed `api.restoreOrder`, `api.getOrderItems`, and `api.updateOrderItems`.
- [x] Task 4: Universal Order Modification Modal (`OrderModifyModal.tsx`)
  - *Completed*: Created `frontend/src/components/OrderModifyModal.tsx` supporting interactive line-item editing (quantity stepper, rate editing, subtotal calculation), catalog search with debounced backend lookups, manual custom medicine addition, item deletion (preserving minimum 1 item), advance payment tracking, and human-in-the-loop WhatsApp dispatch toggle.
- [x] Task 5: Website Orders UI Integration (`WebsiteOrders/index.tsx`)
  - *Completed*: Added `'cancelled'` filter tab, Cancelled KPI metric card, `Restore Order` button (`RotateCcw`) on cancelled orders, `Modify Items` button (`Edit3`) on all orders, and embedded `<OrderModifyModal />`.
- [x] Task 6: CRM Special Orders UI Integration (`CRM/index.tsx`)
  - *Completed*: Added `'Cancelled'` filter chip in `SpecialOrdersSection`, `Restore` button when `order.status === 'Cancelled'`, `Modify` button on order cards, and rendered `<OrderModifyModal />` with cache invalidation and event trigger.
- [x] Task 7: Verification & Quality Assurance (`npm run guardrails` and quick-update)
  - *Completed*: Ran `npm run guardrails` (TypeScript compile check `tsc --noEmit` passed with 0 errors; all performance, color theme, and speed architecture checks passed). Updated `.understand-anything/knowledge-graph.json` via `node scripts/quick-update.mjs`.
