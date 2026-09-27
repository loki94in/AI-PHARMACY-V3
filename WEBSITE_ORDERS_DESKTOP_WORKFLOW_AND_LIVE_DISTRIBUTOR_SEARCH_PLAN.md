# Implementation Plan: Website Orders Complete Desktop Workflow & Live Distributor Search

## 1. Problem & Architecture Overview
Currently, when a WhatsApp customer requests an unstocked or special-order medicine:
1. Sourcing options are sent exclusively to the pharmacy owner's WhatsApp phone for verification.
2. If the owner's phone is absent, locked, or unavailable, the pharmacist on PC cannot confirm the distributor, view live stock, or trigger the customer's ₹50 payment QR.
3. Pharmacists need the ability to complete the ENTIRE workflow directly from the `/website-orders` page:
   - Expand any order card inline to view the evaluated distributor options.
   - Run a live Pharmarack query for the medicine right inside the card to reassure stock availability.
   - Click "Approve & Send Payment QR" directly from the PC to dispatch the QR code and link to the customer on WhatsApp.
   - Inspect payment receipt screenshots and confirm payments directly from PC.
   - Hand off to POS with 1-click fuzzy matching.

## 2. Planned Changes

### Backend API
- [x] Task 1: Create endpoint `GET /api/orders/:id/distributor-options` in `src/routes/orders.ts`. (Completed: returns escalated options and current distributor state).
- [x] Task 2: Create endpoint `POST /api/orders/:id/confirm-distributor` in `src/routes/orders.ts`. (Completed: updates distributor, allocates UPI QR card, updates pending clarifications, enqueues WhatsApp message to customer, emits SSE).

### Frontend API Service
- [x] Task 3: In `frontend/src/services/api.ts`:
  - Add `getOrderDistributorOptions(orderId: number)`. (Completed).
  - Add `confirmOrderDistributor(orderId: number, payload: any)`. (Completed).

### Frontend `/website-orders` Page UI
- [x] Task 4: In `frontend/src/pages/WebsiteOrders/index.tsx`:
  - Add an inline expandable section inside each order card: **"📦 Sourcing & Distributor (Live Stock)"**. (Completed).
  - **Section A (Escalated Options)**:
    - Display evaluated options from `wa_owner_pending_requests` with distributor name, live stock indicator (🟢/🟡/🔴), wholesale rate, MRP, and profit margin. (Completed).
    - One-click button: **"Approve & Send Payment QR"**. (Completed).
  - **Section B (Live Pharmarack Query & Reassurance)**:
    - Search input prefilled with medicine name (`order.medicine_name || order.product`). (Completed).
    - "Search Live Stock" button triggering `api.searchPharmarack(query)`. (Completed).
    - Live list of all stocking distributors with real-time stock levels, rates, and schemes. (Completed).
    - One-click button: **"Select & Send QR"** for any distributor in the live search list. (Completed).
  - Real-time feedback loading states and toast notifications on confirmation. (Completed).

### Testing & Verification
- [x] Task 5: Run integration tests (`npm test -- tests/websiteOrderIntegration.test.ts tests/specialOrderNotification.test.ts`). (Completed: 9 of 9 PASS).
- [x] Task 6: Run `npm run guardrails` (`tsc --noEmit`) to verify 0 compiler errors. (Completed: PASS, 0 violations).
- [x] Task 7: Update knowledge graph via `node scripts/quick-update.mjs` and log in `SMALL_BUG_FIX_PLAN.md`. (Completed).

## 3. Post-Implementation Summary
- Full desktop & phone parity achieved: Pharmacists can now execute the complete procurement and customer payment cycle on PC without needing the owner's phone.
- Pharmacists can review bot recommendations or live query Pharmarack distributors to guarantee stock availability before issuing payment cards.
- Clicking "Approve & Send QR" immediately updates SQLite, allocates a fresh dynamic UPI QR card, and sends the payment image card with direct UPI payment link to the customer on WhatsApp.
