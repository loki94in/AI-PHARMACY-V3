# Implementation Plan: Post-Payment Distributor Switching, Cart Reconciliation & Pricing Invoicing

## Overview
This implementation addresses:
1. **Post-Payment Distributor Switching in Online Orders**: Allowing pharmacy users to modify/switch distributors on orders even after payment is confirmed (`PAYMENT_CONFIRMED`), without erroneously resetting payment status to `AWAITING_PAYMENT` or re-sending QR codes, while atomically evicting the item from the old distributor's active cart and injecting it into the new distributor's active cart.
2. **Distributor Page Active Cart Reconciliation**: Automatically detecting items in the live cart that belong to orders that are already paid and fulfilled/received, safely clearing them from the active cart, and displaying a human-in-the-loop review tray with 1-click restore.
3. **Decoupled Pricing & Final Invoicing**:
   - Wholesale level: Purchase rate (PTR/cost) finalized by the pharmacy in purchases.
   - Retail level: Customer billing strictly calculated using actual physical **Batch MRP** (which can fluctuate across batches).
   - Invoicing: Passing correct Batch MRP and deducting collected advance payment from the final customer bill.

---

## Tasks Checklist

- [x] **Task 1: Backend - Safe Post-Payment Distributor Switching in `orders.ts`**
  - [x] Check if `order.payment_status` is already confirmed (`PAYMENT_CONFIRMED`, `VERIFIED`, `CONFIRMED`).
  - [x] If already confirmed, preserve status and skip re-sending payment QR unless explicitly requested.
  - [x] When distributor changes, evict line from previous distributor's live cart (`adjustSpecialOrderInLiveCart`) and add to new distributor's live cart (`addItemsToPharmarackCart`).
  - [x] Log audit event in `order_tracking_events`.

- [x] **Task 2: Backend - Automated Cart Reconciliation on Distributor Page Visit in `pharmarack.ts`**
  - [x] When `/cart` endpoint is fetched, identify cart items corresponding to orders that are already paid and fulfilled or already entered into `purchase_items`.
  - [x] Safely evict those items via background delete queue.
  - [x] Return `reconciledItems` in API response for frontend awareness.

- [x] **Task 3: Frontend - Website Orders Distributor Switching & POS Prefill Fix in `WebsiteOrders/index.tsx`**
  - [x] Adjust Sourcing buttons for paid orders: display "Switch Distributor (Migrate Cart)" instead of "Approve & Send QR" when `payment_status` is confirmed.
  - [x] Send `sendPaymentQr: false` when switching distributor on confirmed payment orders.
  - [x] Fix `handleOpenInPOS`: pass legitimate `mrp: order.pharmarack_mrp || order.mrp` (NOT `pharmarack_rate`), pass `advancePayment: order.advance_payment`, and annotate notes with advance credit.

- [x] **Task 4: Frontend - Human-in-the-Loop Reconciled Cart Tray in `PharmarackCart/index.tsx`**
  - [x] Capture `reconciledItems` from `/cart` response.
  - [x] Render a non-intrusive alert tray showing cleared items with a 1-click "Undo / Keep in Cart" button.

- [x] **Task 5: Verification & Guardrails**
  - [x] Write integration verification script verifying post-payment distributor switch, cart transfer, and billing prefill.
  - [x] Run `npm run guardrails` to guarantee 0 violations.
