# Implementation Plan: Pharmarack Paced Automated Checkout & Order ID Dispatch Flow

**Goal:**
Automate the end-to-end Pharmarack batch order placement with a 10–12 second settling buffer between steps. First notify delivery staff of today's pickup route, execute headless checkout on Pharmarack's cart with reliable 10–12s hydration and tokenized store matching, capture the official Order ID from the network/sync response, and automatically dispatch the confirmed Order ID to the saved distributor WhatsApp numbers with clean anti-flush pacing.

---

## 1. Problem & Architecture Review

1. **Previous Headless Automation Timeout & Name Mismatch**:
   - In `src/services/pharmarackCheckoutService.ts`, the script waited only 2.5s for the page to hydrate. On real/slow internet connections, Pharmarack's Angular SPA and API (`GetUserCartDetails`) take 4–10 seconds to render the cart table.
   - The store name matching strictly checked substrings, which failed if the local store name (e.g. `"MAHAVIR MEDICAL"`) did not exactly match the card heading (*"MAHAVIR PHARMA DISTRIBUTORS PVT LTD"*).
   - Button queries were limited to standard `<button>` tags, potentially missing Angular wrappers or disabled states.

2. **Sequential Pacing & Order ID Availability**:
   - Currently, distributor dispatch messages were constructed before the order was placed on Pharmarack, leaving the official `OrderNo` blank.
   - The user specified a clear 10–12 second gap per step to ensure slow internet and heavy web applications have sufficient time, preventing race conditions and fast-flush WhatsApp bursts.

---

## 2. Proposed Changes

### A. Paced & Resilient Headless Checkout (`src/services/pharmarackCheckoutService.ts`)
- Increase initial page hydration wait to a 10–12 second active polling loop checking for distributor cards, items, and checkout buttons.
- Implement tokenized fuzzy matching for distributor store names (matching common significant words).
- Broaden button search to `button, [role="button"], a[role="button"], .btn-checkout, .place-order-btn` with case-insensitive matching for "place order", "confirm order", "checkout", "proceed".
- Provide a 10–12 second network settling window post-click to capture all returned `OrderNo`s from the API response stream.
- Reconcile captured Order IDs with `syncPharmarackOrders()`.

### B. End-to-End Paced Batch Route (`src/routes/pharmarack.ts`)
- In `POST /cart/place-official-orders`:
  1. **Step 1**: Enqueue today's delivery boy pickup list summary first via `enqueue-pharmarack-batch` (with `dispatchDistributorsLater: true`).
  2. **Step 2**: Execute headless checkout on Pharmarack cart with the 10–12s buffer.
  3. **Step 3**: Capture official Order IDs and record them in `pharmarack_placed_orders` and `pharmarack_synced_orders`.
  4. **Step 4**: For each placed distributor order with an official Order ID, format the official PO dispatch message (`📦 *Pharmarack Order #${orderNo}* has been placed...`) and enqueue it to the distributor's phone number with anti-flush pacing.
  5. **Step 5**: If automated placement fails or encounters restrictions, return `success: false` so the frontend fallback can open the authenticated cart window for 1-click human verification.

### C. WhatsApp Queue & Distributor Order Dispatch (`src/routes/whatsappQueue.ts`)
- Support updating or enqueuing individual distributor PO messages after official order placement with the captured `order_no`.
- Respect safe queue delivery spacing.

### D. Frontend Feedback & Stepped Progress (`frontend/src/pages/PharmarackCart/index.tsx`)
- Update `handleSendAllWhatsAppOrders` to display paced progress toasts across the 4 steps.
- Retain human-in-the-loop fallback to open the official cart window on any exception.

---

## 3. Verification Plan

1. **TypeScript Compilation**:
   - Backend: `npx tsc --noEmit`
   - Frontend: `npx tsc -p frontend/tsconfig.app.json --noEmit`
2. **Performance Guardrails**:
   - `npm run guardrails` (zero violations)
   - Must pass all speed and schema constraints
3. **Knowledge Graph Sync**:
   - `node scripts/quick-update.mjs`

---

### Tasks & Progress Tracking

- [x] Task 1: Upgrade `pharmarackCheckoutService.ts` with 10–12s hydration polling, resilient button queries, tokenized store matching, and 10–12s network settling
  - *Completed:* Implemented an active polling loop waiting 10–12s for Angular SPA hydration and `GetUserCartDetails` to finish, tokenized fuzzy matching between local store names and Pharmarack card headings, multi-selector visibility-checked button queries with modal auto-confirmation, and an 11s network response settling buffer that captures official Order IDs (`OrderNo`, `OrderId`, `po_number`).
- [x] Task 2: Update `src/routes/pharmarack.ts` `/cart/place-official-orders` for the staged pipeline (Delivery Boy first -> Cart checkout -> Order ID capture -> Distributor dispatch with Order ID)
  - *Completed:* Re-ordered batch execution so delivery staff immediately receives today's assigned pickup list first (`dispatchDistributorsLater: true`), automated checkout executes with paced 10–12s buffers, official Order IDs are captured from network/sync, and each placed distributor is sent an official dispatch reminder containing the confirmed Order ID with anti-flush pacing.
- [x] Task 3: Enhance `frontend/src/pages/PharmarackCart/index.tsx` progress messaging & human-in-the-loop fallback
  - *Completed:* Updated batch send handlers to communicate clear staged progress to the user, and ensured the human-in-the-loop fallback opens the live cart window cleanly if manual verification is required.
- [x] Task 4: Verify typecheck, run performance guardrails, and update knowledge graph
  - *Completed:* Frontend TypeScript (`tsc -p frontend/tsconfig.app.json --noEmit`), backend TypeScript (`tsc --noEmit`), and performance guardrails (`npm run guardrails`) all passed with exit code 0 and zero violations. Knowledge graph synchronized via `node scripts/quick-update.mjs`.
