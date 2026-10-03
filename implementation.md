# Distributor Minimum Order Constraints & Delivery-Boy-Only Dispatch Plan

## 1. Problem Statement & Root Cause

### Observed Problem
- When users attempt to place orders or use "Send All via WhatsApp" from the Pharmarack Cart, different distributors impose distinct minimum ordering rules:
  1. **Minimum Order Amount (`MinAmountLimit`)**: E.g., SENIOR AGENCY requires ₹400 (current cart has ₹199.54, short by ₹200.46); New Amar Pharmaceuticals requires ₹250 (current cart has ₹199.54, short by ₹50.46).
  2. **Minimum Line Items (`MinItemLimit`)**: E.g., AJAY PHARMA requires at least 3 distinct line items with stock (current cart has 1 item, short by 2 items).
  3. **Zero Restrictions**: E.g., TAPADIYA DISTRIBUTORS has no minimums (₹199.54 total, 100% ready).
- Currently, our backend (`loadLiveCartCore` in `src/routes/pharmarack.ts`) strips these limit fields during object mapping, so the frontend has no visibility into them.
- Batch "Send All" previously attempted to send orders to all stores blindly, causing upstream errors and sending full medicine item lists directly to distributors' WhatsApp numbers instead of dispatch instructions to the delivery boy.

### User Requirements (Confirmed via Q&A)
1. **Notification Recipient**: Send the order pickup list ONLY to our Delivery Boy (distributor receives the order directly on Pharmarack; no WhatsApp order list sent to distributor).
2. **Batch Placement Policy**: Block "Send All" completely until all distributors meet their minimum order thresholds, with prominent alerts detailing each store's exact shortfall. Single-distributor placement remains available for eligible stores.
3. **Human-In-The-Loop**: Always allow the user to review, see the breakdown, and take action.

---

## 2. Implementation Architecture

### Phase 1: Backend Cart Route Enhancements (`src/routes/pharmarack.ts`)
- In `loadLiveCartCore`:
  - Inspect `store.lineItems` to extract `MinAmountLimit`, `MinItemLimit`, `AllowMOQ`, and `MinOrderQuantity`.
  - Calculate per-distributor validation metrics:
    - `minAmountLimit`: Number (e.g. 400, 250, 0)
    - `minItemLimit`: Number (e.g. 3, 0)
    - `shortfallAmount`: `Math.max(0, minAmountLimit - lineTotal)`
    - `shortfallItems`: `Math.max(0, minItemLimit - itemCount)`
    - `meetsMinAmount`: `lineTotal >= minAmountLimit`
    - `meetsMinItems`: `itemCount >= minItemLimit`
    - `isEligibleForOrder`: `meetsMinAmount && meetsMinItems`
  - Pass these properties in the `/api/pharmarack/cart` response for every distributor.
  - Remove temporary debug endpoint `/cart-raw-debug` once verified.

### Phase 2: Frontend Cart Interface & Visual Alerts (`frontend/src/pages/PharmarackCart/index.tsx`)
- Update `Distributor` interface with the new validation fields.
- **Card-Level Warning Banners**:
  - Display exact red warning banner matching Pharmarack:
    - If `shortfallAmount > 0`: `"Minimum Order amount is set Rs. {minAmountLimit} for the {storeName} store (Shortfall: ₹{shortfallAmount})"`
    - If `shortfallItems > 0`: `"{storeName} - Minimum line items for above store with stock is {minItemLimit} (Need {shortfallItems} more items)"`
  - Display green badge `"✓ Ready to Place"` for eligible stores.
- **"Send All / Place All" Gate**:
  - If any distributor in the cart is ineligible (`isEligibleForOrder === false`):
    - Disable or gate "Send All" button.
    - Show an alert modal / banner when clicked, listing all stores that do not meet minimums and their exact requirements.
    - Prevent accidental batch placement that would fail upstream.
- **Single-Store Placement**:
  - Eligible stores (e.g. TAPADIYA) have an active "Place Order" action that works individually.

### Phase 3: Workflow Transition — Delivery Boy WhatsApp Dispatch
- In `handleSendWhatsAppOrder` / batch send:
  - Do NOT send WhatsApp order list to the distributor's phone number.
  - Route the dispatch pickup summary to the assigned Delivery Boy via `notificationService.sendConsolidatedDeliveryBoyDispatch` or direct queue send to the delivery boy's WhatsApp number.
  - Log the placed order in `pharmarack_placed_orders` table.
  - Toast confirmation: `"Order placed for {storeName} and pickup notification dispatched to Delivery Boy ({boyName})!"`

### Phase 4: Verification & Guardrails
- Validate with `npm run guardrails` (passes all checks: no UTC dates, semantic Tailwind, clean build).
- Run `node scripts/quick-update.mjs` to update knowledge graph.
- Verify live cart reflects accurate minimum amounts and item counts.

---

## 3. Tasks & Completed Log

- [x] Task 1: `src/routes/pharmarack.ts` surfaces `minAmountLimit`/`minItemLimit`/`maxItemLimit`/`maxAmountLimit` per distributor (null = unknown); eligibility is computed live in the frontend (`getOrderLimitIssues`). Debug route removed.
- [x] Task 2: Update `frontend/src/pages/PharmarackCart/index.tsx` UI to display distributor threshold warning banners and badges.
- [x] Task 3: Implement batch blocking logic when distributors are below minimum, with clear actionable modal/banner.
- [ ] Task 4: Redirect WhatsApp order workflow to send pickup/dispatch list exclusively to the assigned Delivery Boy instead of sending medicine lists to distributors.
- [x] Task 5: Run `npm run guardrails` and `node scripts/quick-update.mjs` to ensure zero regressions.
