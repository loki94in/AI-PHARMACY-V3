# Implementation Plan: PC Payment Confirmation & Customer WhatsApp Notification Dispatch

## Problem Summary
When a pharmacist or store owner confirms an order's payment from PC/Desktop on `/website-orders` (`PATCH /api/website/orders/:orderId/payment`) or `/orders` (`POST /api/orders/:id/mark-advance-paid`):
1. **Customer WhatsApp message was omitted**: `whatsappQueueWorker.enqueue` was never invoked, so the customer received no payment confirmation or procurement status update.
2. **Bot/Clarification state stayed pending**: `wa_owner_pending_requests` and `wa_pending_clarifications` were not updated to `fulfilled`/`completed`, leaving the WhatsApp state machine waiting for payment verification.
3. **Pharmarack Live Cart metadata was incomplete**: The cart addition in `websiteOrders.ts` hardcoded `storeId: 0`, `productCode: ''`, and `productId: order.medicine_id || 0` instead of using the locked distributor details (`pharmarack_store_id`, `pharmarack_product_id`, `pharmarack_product_code`).
4. **Order Status for Special Orders**: Prematurely setting status to `ORDER_READY_FOR_PICKUP` hid the "Open in Live Cart →" button in the UI and falsely indicated that out-of-stock procured items were already waiting on the shelf.

## Planned Changes
- [x] Task 1: Update `PATCH /api/website/orders/:orderId/payment` in `src/routes/websiteOrders.ts` to:
  - Generate proper store special order code (`generateStoreSpecialOrderCode`)
  - Set appropriate status (`Confirmed` for procurement orders, or pickup/delivery status)
  - Ensure `online_order_items` entry exists for Live Cart queue visibility
  - Pass complete distributor details (`storeId`, `pharmarack_product_id`, `pharmarack_product_code`) to `addItemsToPharmarackCart`
  - Update `wa_owner_pending_requests` to `fulfilled` and `wa_pending_clarifications` to `completed`
  - Enqueue customer confirmation message on WhatsApp via `whatsappQueueWorker.enqueue`
  - Stage the notification in `automation_notifications`
  - Support `so.payment_status IN ('CONFIRMED', 'PAYMENT_CONFIRMED', 'VERIFIED')` in `GET /api/website/live-cart`
- [x] Task 2: Mirror customer WhatsApp notification and state resolution in `POST /api/orders/:id/mark-advance-paid` in `src/routes/orders.ts`
- [x] Task 3: Run automated tests (`specialOrderNotification.test.ts` and `websiteOrderIntegration.test.ts`)
- [x] Task 4: Run `npm run guardrails` and verify TypeScript compilation and performance constraints
- [x] Task 5: Update knowledge graph via `node scripts/quick-update.mjs` and log fix in `SMALL_BUG_FIX_PLAN.md`

## Completed Task Details
- **Task 1 Completed**: `src/routes/websiteOrders.ts` patched. Desktop confirmations now automatically format and enqueue the customer receipt via `whatsappQueueWorker`, log tracking event, stage in `automation_notifications`, mark `wa_owner_pending_requests` fulfilled, mark `wa_pending_clarifications` completed, pass locked distributor store and product IDs to `addItemsToPharmarackCart`, and allow `GET /api/website/live-cart` to include `PAYMENT_CONFIRMED` and `VERIFIED` statuses.
- **Task 2 Completed**: `src/routes/orders.ts` updated to mirror the automated customer WhatsApp dispatch, owner request resolution, and notification logging upon marking advance paid.
- **Task 3 Completed**: Executed Jest test suites: `tests/specialOrderNotification.test.ts` (4/4 tests passed), `tests/websiteOrderIntegration.test.ts` (5/5 tests passed, including new integration test verifying PC payment confirmation).
- **Task 4 Completed**: Executed `npm run guardrails`. Zero TypeScript errors (`tsc --noEmit`), zero speed or dummy token violations.
- **Task 5 Completed**: Recorded `[Fixed] P2-43` in `SMALL_BUG_FIX_PLAN.md` and ran `node scripts/quick-update.mjs`.
