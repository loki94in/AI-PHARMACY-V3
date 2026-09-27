# Website & Special Orders: Restore Cancelled Order & Multi-Item Order Modification Plan

## Overview
This plan implements:
1. **Restore Cancelled Orders**: Adds a one-click restore workflow to revert cancelled orders back to `Pending` status (with verification reset and audit logging), available in both `/website-orders` and `/crm?tab=special_orders`.
2. **Order Modification & Multi-Item Editing**: Adds full capabilities to modify existing items, adjust quantities/rates, search catalog to add new items, and remove items from both Website Orders and CRM Special Orders.
3. **Human-in-the-Loop Approval**: Allows the pharmacist to review updated totals and choose whether to dispatch an updated order summary to the customer via WhatsApp.

---

## Tasks

- [x] **Task 1: Backend Restore Endpoints (`websiteOrders.ts` and `orders.ts`)**
  - Implemented `POST /api/website/orders/:orderId/restore` and `POST /api/orders/:id/restore`.
  - Transactionally update `special_orders.status = 'Pending'` and `pharmacy_verification_status = 'PENDING'`.
  - Insert record into `order_tracking_events` with `event_type = 'order_restored'`.
  - Broadcast SSE `order_updated` and `refresh-special-orders`.

- [x] **Task 2: Backend Multi-Item Order Management Endpoints**
  - Implemented `GET /api/orders/:id/items` and `GET /api/website/orders/:orderId/items`: fetches items from `online_order_items` or synthesizes from `special_orders` row if legacy single-item.
  - Implemented `PUT /api/orders/:id/items` and `PUT /api/website/orders/:orderId/items`:
    - Deletes items in `removed_item_ids`.
    - Updates quantities and prices for existing items.
    - Inserts new line items into `online_order_items`.
    - Recalculates total order amount, total quantity, and primary product summary in `special_orders`.
    - Human-in-the-loop WhatsApp notification dispatch if `send_whatsapp: true`.
    - Broadcasts real-time SSE updates.

- [x] **Task 3: Frontend API Services (`frontend/src/services/api.ts`)**
  - Added `restoreOrder(orderId)`, `getOrderItems(orderId)`, and `updateOrderItems(orderId, payload)`.

- [x] **Task 4: Universal Order Modification Modal (`OrderModifyModal.tsx`)**
  - Created reusable modal with line items table, inline quantity editor, delete item action, live catalog search for adding new items, live total calculation, and human-in-the-loop WhatsApp checkbox.

- [x] **Task 5: Website Orders UI Integration (`WebsiteOrders/index.tsx`)**
  - Added `'cancelled'` filter tab and Cancelled KPI summary card.
  - Displayed "Restore Order" button on cancelled order cards.
  - Displayed "Modify Items" button on order cards to open the modification modal.

- [x] **Task 6: CRM Special Orders UI Integration (`CRM/index.tsx`)**
  - Added `'Cancelled'` filter chip in `SpecialOrdersSection`.
  - Added "Restore" action for cancelled special orders.
  - Added "Modify" action to open `OrderModifyModal`.

- [x] **Task 7: Verification & Quality Assurance**
  - Ran `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) clean, 0 errors, 0 violations.
  - Ran `node scripts/quick-update.mjs` to synchronize the knowledge graph.
