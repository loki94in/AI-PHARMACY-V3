# Implementation Plan: Automated Official Pharmarack Order Placement & Clean Order Dispatch

## Overview
Currently, clicking "Send All via WhatsApp" in the Pharmarack Cart page only dispatches a pickup message to the delivery staff. The actual orders are never placed on Pharmarack (`https://retailers.pharmarack.com/cart`), leaving all products in the cart and requiring manual checkout. Furthermore, dispatch reminders must strictly only send today's genuine Order IDs (no duplicates, no old IDs), and delivery staff must receive a clean distributor list without medicine names or item counts. Additionally, any minimum order value/item shortfalls must strictly block order submission with clear warning indicators rather than allowing fake or premature sends.

---

## Root Causes Identified
1. **No Automated Order Submission Mechanism**:
   The app previously only supported cart inspection (`GetUserCartDetails`), item adds, and deletes, providing an external link (`Proceed to Checkout`) to `https://retailers.pharmarack.com/cart` instead of executing automated checkout.
2. **"Send All via WhatsApp" Decoupled from Order Placement**:
   The batch send handler only triggered `/whatsapp/queue/enqueue-pharmarack-batch` with `dispatchDistributorsLater: true`, which only alerted delivery staff and waited for external order IDs that were never generated.
3. **Missing Minimum Order Requirement Gate in Modal**:
   `BatchDispatchModal.tsx` lacked prominent warning badges and button-disabling logic for distributors that failed `getOrderLimitIssues` (e.g. minimum amount/item count shortfalls).
4. **Delivery Staff Messages Contained Unnecessary Detail**:
   Staff messages optionally included itemized medicine lists or counts instead of a clean, focused pickup list with distributor names and phone numbers.

---

## Tasks

- [x] **Task 1: Build Automated Pharmarack Checkout Service (`src/services/pharmarackCheckoutService.ts`)**
  - Use the app's authenticated session profile (`data/pharmarack_profile`) and single-flight browser mutex.
  - Navigate to `https://retailers.pharmarack.com/cart`, trigger order submission for specified/verified distributors, and intercept the generated official `OrderNo`s.
  - Return the results (placed distributor orders, order numbers, and any store-specific errors).

- [x] **Task 2: Implement Official Order Placement Route in Backend (`src/routes/pharmarack.ts`)**
  - Add `POST /api/pharmarack/cart/place-official-orders`:
    1. Pre-validates that no store has minimum limit shortfalls.
    2. Runs `pharmarackCheckoutService.placeCartOrders()`.
    3. Records successful `OrderNo`s in `pharmarack_placed_orders` and `pharmarack_synced_orders` strictly for today's date (`today.iso`).
    4. Enqueues the clean Delivery Staff summary (Template 7A simplified) and the Distributor Dispatch Reminders (Template 1B with real `OrderNo`s).
    5. Returns order results and status.

- [x] **Task 3: Enforce Clean Delivery Staff Summary & Strict Today-Only Reminders (`src/routes/whatsappQueue.ts`)**
  - Ensure the Delivery Boy pickup summary includes ONLY distributor name, phone number, and total assigned stores (no medicine names, no item counts).
  - Enforce strict today-only date checks and deduplication in `whatsapp_send_queue` and `pharmarack_synced_orders` to guarantee no old IDs or duplicate messages are ever sent.

- [x] **Task 4: Update Frontend Modal & Gating (`BatchDispatchModal.tsx` & `PharmarackCart/index.tsx`)**
  - In `BatchDispatchModal.tsx`:
    - Display bold warning badges on any distributor not meeting minimum order limits.
    - Strictly disable the "Place Official Orders & Dispatch" button if any selected distributor has a shortfall.
    - Remove medicine itemization toggle to ensure clean distributor list for staff.
  - In `PharmarackCart/index.tsx`:
    - Upgrade the action to call `api.placeOfficialPharmarackOrders()`.
    - Provide live progress indicators (*Checking limits...* -> *Placing official orders on Pharmarack...* -> *Dispatching reminders*).
    - Provide a 1-click fallback button (*Open Official Cart Window*) if Pharmarack requires human review on any store.

- [x] **Task 5: Verification & System Guardrails**
  - Run `npm run guardrails` (`tsc --noEmit` and performance checks).
  - Verify against test suites and run `node scripts/quick-update.mjs`.

---

## Task Completion Log
- **Task 1 Completed**: Implemented `src/services/pharmarackCheckoutService.ts` providing `executeCartCheckout()` with single-flight mutex protection, DOM-based order placement and dialog confirmation on `https://retailers.pharmarack.com/cart`, official `OrderNo` network response interception, and `openAuthenticatedCartWindow()` for 1-click human review.
- **Task 2 Completed**: Implemented `POST /api/pharmarack/cart/place-official-orders` and `POST /api/pharmarack/cart/open-official-window` in `src/routes/pharmarack.ts`, integrating order execution, cache invalidation, instant order sync, and staff/distributor dispatch queueing.
- **Task 3 Completed**: In `src/routes/whatsappQueue.ts`, simplified the delivery staff pickup summary to clean distributor names and contact numbers (no medicine names or item counts), and enforced shop-local date formatting (`toLocalSqlDateTime`) with strict today-only deduplication.
- **Task 4 Completed**: In `BatchDispatchModal.tsx`, added `limitIssuesMap` rendering prominent warning badges on shortfall distributors, strictly disabled the send button when any distributor has unmet minimum order requirements, and updated the modal to "Place Official Orders & Dispatch". In `PharmarackCart/index.tsx`, wired `api.placeOfficialPharmarackOrders()`, updated the footer buttons, and connected `api.openOfficialPharmarackCartWindow()`.
- **Task 5 Completed**: Ran `npm run guardrails` (clean `tsc --noEmit`, 0 violations) and `npm run build:client` (clean client build in 45s, 0 errors). Syncing knowledge graph with `node scripts/quick-update.mjs`.
