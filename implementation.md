# Active Implementation Plan: Post-Payment Distributor Switching, Cart Reconciliation & Pricing Invoicing

> **Master Plan**: [DISTRIBUTOR_CART_RECONCILIATION_AND_PRICING_IMPLEMENTATION_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/DISTRIBUTOR_CART_RECONCILIATION_AND_PRICING_IMPLEMENTATION_PLAN.md)
> **Goal**: 
> 1. Enable pharmacy users to switch distributors on orders even after payment is confirmed without resetting status or sending duplicate QR codes.
> 2. Automatically transfer items between distributor carts (evict from old distributor, add to new distributor).
> 3. Reconcile active cart on distributor page visit, auto-clearing already-paid and fulfilled/received items with human-in-the-loop review tray.
> 4. Ensure customer billing strictly uses actual Batch MRP (handling batch price fluctuations) and deducts collected advance payments.
> **Status**: Completed

---

## Tasks Checklist

- [x] `Task 1`: Backend - Safe Post-Payment Distributor Switching in `orders.ts`
- [x] `Task 2`: Backend - Automated Cart Reconciliation on Distributor Page Visit in `pharmarack.ts`
- [x] `Task 3`: Frontend - Website Orders Distributor Switching & POS Prefill Fix in `WebsiteOrders/index.tsx`
- [x] `Task 4`: Frontend - Human-in-the-Loop Reconciled Cart Tray in `PharmarackCart/index.tsx`
- [x] `Task 5`: Comprehensive Automated Tests, Performance Guardrails, and Knowledge Graph Update

