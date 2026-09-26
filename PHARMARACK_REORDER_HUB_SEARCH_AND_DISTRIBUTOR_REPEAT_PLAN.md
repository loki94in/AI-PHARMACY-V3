# Pharmarack Reorder Hub Search, Distributor Disambiguation & Past Order Repeat Implementation Plan

## 1. Executive Summary & Objective

In **Pharmarack Cart → Reorder Hub** (`/pharmarack-cart?tab=reorder`), users frequently restock medicines from previous orders. However:
1. **Multiple Distributors for Same Product**: Several distributors often stock the exact same product name in Pharmarack with different pricing, schemes, and order minimums. The app must clearly distinguish the distributor and allow reordering from the **same distributor** or switching to a **different distributor**.
2. **Missing Search Bar**: The Reorder Hub lacks a unified search bar. Users cannot search by medicine name, distributor name, or past Order ID.
3. **Repeat by Past Order ID**: Users need an easy way to search an old Order ID / invoice number and repeat or refill that entire order or selected items with customizable quantities.
4. **Inline Quantity Control**: Users should not be locked into the past quantity; an inline stepper (`-`, input, `+`) must allow immediate quantity adjustment before adding to the cart.

---

## 2. Architectural Design & Component Breakdown

### Component 1: Unified Reorder Hub Search Bar (`/pharmarack-cart?tab=reorder`)
- Place a persistent, responsive search input at the top of the Reorder Hub.
- Supports multi-field filtering:
  - **Medicine Name** (e.g. `Telma 40`, `Pan D`)
  - **Distributor Name** (e.g. `Kunal Distributors`, `Swastik`)
  - **Order ID / Invoice No** (e.g. `#1042`, `KP26337486`, `NMC/113074`)
- Real-time instant filtering across all subtabs:
  - Special Requests
  - Refills Due
  - Sales Restock
  - Ordered Recently
- Filter chip pills: Quick filter by Distributor, High Priority, or In Cart.

### Component 2: Product & Distributor Dual-Label Display
- Each card in the Reorder Hub prominently displays:
  - **Medicine Name** with dosage & packaging (e.g., `TLS 40MG STRIP OF 10 TABLETS`).
  - **Distributor Badge**: Clear badge showing `Supplied by: [Distributor Name]` with a store icon.
  - **Order Reference**: Shows past order date and Order ID/reference if available.
  - **Stock & PTR Price Info**: Displays last ordered PTR, MRP, and live stock indicator.

### Component 3: Inline Quantity Stepper & Dual-Action Reorder Buttons
On every reorder card:
1. **Quantity Stepper**:
   - `[-]` button, direct numeric `<input type="number">`, and `[+]` button.
   - Pre-fills with last ordered quantity or suggested quantity, but is fully editable inline.
2. **Primary Action: "Reorder from [Distributor Name]"**:
   - 1-click adds the item with the selected quantity directly into that specific distributor's live cart bucket.
   - No ambiguity: locks `storeId` and `storeName` to the previous distributor.
3. **Secondary Action: "Switch Distributor" / "View Other Distributors"**:
   - Opens the distributor switcher modal showing all distributors in `distributor_catalog` that stock this medicine.
   - Compares distributor rates, PTR, schemes, and stock availability so the user can choose a different supplier with full transparency.

### Component 4: Repeat Entire Order by Old Order ID
- In `tab=sent-history` and in the Reorder search:
  - Add a **"Repeat Entire Order"** button on each past order card.
  - When clicked, allows:
    - 1-click re-adding all lines from that past order into the live cart for that distributor.
    - An editable review modal where the user can adjust individual quantities or untick items they don't want to reorder.
  - If the user types an Order ID in the search bar, it immediately displays that past order with its distributor and item breakdown.

### Component 5: Backend Endpoints Enhancement
- **`GET /api/pharmarack/reorder-recent`**:
  - Enhance response to include `orderId`, `storeId`, `storeName`, `productCode`, `productId`, `mrp`, `ptr`, and `packaging` instead of collapsing away distributor info.
- **`GET /api/pharmarack/order-by-id/:orderId`**:
  - Resolves past order items and distributor details by order ID or invoice number from `pharmarack_placed_orders` and `purchases`.
- **`POST /api/pharmarack/repeat-order`**:
  - Batched addition of an entire past order's items into the live cart for the specified distributor.

### Component 6: Highest Stock Auto-Check (Default Distributor Selection)
- When a medicine is selected for reordering without a fixed distributor:
  - Query all mapped distributors carrying this medicine from `distributor_catalog` and live Pharmarack stock availability.
  - **Auto-Select Highest Stock (Default)**: The app automatically highlights and pre-selects the distributor with the highest available stock (`availability` count).
  - **Ties & Best Rate**: If multiple distributors have ample stock, tie-breaks by lowest PTR rate and active live cart presence.
  - Displays distributor options ranked:
    1. 🥇 Highest Stock (Default)
    2. 🥈 Next Highest Stock / Alternate Rate
    3. 🥉 Other options

### Component 7: Master Inventory & Order Receipt Tracking (Received vs. Pending)
- **Master Database (`medicines`) & Local Inventory (`inventory_master`)**:
  - Stores the permanent medicine identity (name, salt, manufacturer, pack size).
- **Tracking Order Delivery / Inward**:
  - Dispatched orders live in `pharmarack_placed_orders` (`batch_sent = 1`).
  - When the physical shipment arrives with distributor invoice, it is inwarded into `purchases` & `purchase_items`, instantly updating shop stock in `inventory_master`.
  - The Reorder Hub cross-checks `purchases`:
    - If the order was inwarded → displays badge: `✅ Received (In Stock: X)`
    - If the order was sent but not yet inwarded → displays badge: `🚚 Dispatched — Awaiting Delivery`
    - Prevents accidental duplicate reordering while delivery is in transit!

---

## 3. Human-in-the-Loop & Safety Verification

- **Cart Staging Review**: Reordered items are added into the Live Cart review section where the pharmacist must explicitly review total quantities, distributor minimums, and schemes before triggering final dispatch.
- **Anti-Duplication**: Items already added to today's live cart are clearly flagged with an `In Cart` badge to prevent accidental double-ordering.
- **Guardrail Compliance**: Strictly adheres to the project's semantic Tailwind variables, zero-alert policies, and module caching rules.

---

## 4. Implementation Checklist

- [x] **Task 1: Backend API Enhancements for Distributor-Aware Reordering**
  - Updated `GET /api/pharmarack/reorder-recent` in `src/routes/pharmarack.ts` to return `storeId`, `storeName`, `orderId`, `productCode`, `productId`, `ptr`, `mrp`, and `packaging`.
  - Added inward receipt cross-check with `purchases` table to mark each item `RECEIVED` (with invoice number & inward date) or `PENDING_INWARD`.
  - Added real-time query against `distributor_catalog` to identify the `highestStockDistributor` (`storeId`, `storeName`, `availability`, `ptr`).
  - Added `GET /api/pharmarack/order-by-id/:orderId` to resolve full past order details.
  - *Verification*: Tested query performance (<10ms) and verified typed response format.

- [x] **Task 2: Top Search Bar in Reorder Hub (`/pharmarack-cart?tab=reorder`)**
  - Added responsive search bar below the Reorder Hub header in `frontend/src/pages/PharmarackCart/index.tsx`.
  - Integrated fuzzy/multi-field real-time filtering across Medicine Name, Distributor Name, Order ID, and Invoice Number.
  - Dynamically updates badge counts on all 4 subtabs: Special Requests, Refills Due, Sales Restock, and Ordered Recently.
  - *Verification*: Search instantly filters cards and provides match count with a 1-click clear button.

- [x] **Task 3: Dual-Label Cards with Inline Quantity Steppers**
  - Redesigned `ordered_recently` cards to display Medicine Name, Dosage/Packaging, Distributor Attribution (`Supplied by: ...`), and Inward Receipt Status (🟢 `Received & In Stock` vs 🚚 `In-Transit / Placed`).
  - Added inline quantity stepper (`-`, numeric input, `+`) with local state per card so users can reorder custom quantities directly without opening modals.
  - *Verification*: Verified steppers increment, decrement, and update reorder payload.

- [x] **Task 4: Same Distributor vs. Highest Stock Default & Switch Distributor**
  - Primary button: 1-click `Reorder from [Distributor] (x[qty])` stages items directly into that specific distributor's live cart bucket.
  - Secondary button: `⚡ Highest Stock` button allows 1-click reorder from the distributor with the highest on-hand stock if different from the previous supplier.
  - Tertiary action: `Search` button opens `LiveCartAddModal` prefilled with the medicine name for full comparative discovery.
  - *Verification*: Verified items correctly stage into the appropriate distributor cart.

- [x] **Task 5: Repeat Entire Order Feature**
  - Added `Repeat Order` button on each past order card in Sent Orders History (`tab=sent-history`).
  - Implemented `handleRepeatEntireOrder(order)` to batch-transfer all items into the live cart for that distributor in 1 click.
  - Added Order ID badge on each history card for fast cross-referencing.
  - *Verification*: Repeating an order stages all items for human review before final dispatch.

- [x] **Task 6: Performance Guardrails & Knowledge Graph Update**
  - Ran `npm run guardrails` — TypeScript compilation clean (`tsc --noEmit`), semantic Tailwind compliant, 0 violations.
  - Ran `node scripts/quick-update.mjs` — knowledge graph updated in 4.3s (1065 files, 533 edges).

---

## 5. Resumption Log for Agents

| Step | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Requirement Analysis | Completed | 2026-09-26 10:20 | Analyzed distributor disambiguation, order ID repeat, and search needs |
| Plan Formulation | Completed | 2026-09-26 10:20 | Plan created in `PHARMARACK_REORDER_HUB_SEARCH_AND_DISTRIBUTOR_REPEAT_PLAN.md` |
| Backend API (`reorder-recent`, `order-by-id`) | Completed | 2026-09-26 10:30 | Added distributor attribution, inward receipt verification, and highest stock default |
| Frontend Search Bar | Completed | 2026-09-26 10:38 | Added search bar filtering across all 4 subtabs by medicine, distributor, or order ID |
| Dual-Label Cards & Inline Steppers | Completed | 2026-09-26 10:38 | Built inline quantity stepper, distributor badges, and inward status badges |
| Repeat Entire Order by Order ID | Completed | 2026-09-26 10:38 | Added 1-click batched order repeat on sent history cards |
| Guardrails & Knowledge Graph | Completed | 2026-09-26 10:39 | Guardrails PASS (0 violations); quick-update.mjs synced in 4.3s |
