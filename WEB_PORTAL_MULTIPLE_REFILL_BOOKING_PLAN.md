# Web Portal Multiple Refill & Re-Order Booking Plan

> **Scope**: Customer Portal (`/portal`), Multi-Item Refill Booking, 1-Click Reorder from Past Orders, Active Booking Status Indicators, Selection Controls.  
> **Contract**: Root `AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`, `AGENT_BUG_FIX_RULEBOOK.md`.

---

## 1. Problem Statement & Desired Outcome

1. **Multi-Refill Selection Friction**:
   * Previously, when a patient logged in, all refills were pre-selected, but if a patient wanted only 1 or 2 specific medicines out of 6, they had to manually uncheck every other medicine one by one.
   * There were no `Select All` or `Clear All` bulk controls.
2. **Missing 1-Click Reorder on Past Online Orders**:
   * In Section 0 ("Your Online Orders & Live Status"), patients could see their past orders, but had no way to reorder them in 1 click.
   * If a patient wanted to reorder the same medicine(s) they ordered previously, they had to manually search or re-find them.
3. **Lack of Active Order Visibility on Refill Items**:
   * If a patient had already booked a refill earlier in the day or had an active order in `Pending` / `Ready` status, the refill list showed no indication of this active booking, leading to uncertainty about whether the medicine was already requested.

---

## 2. Technical Architecture & Implementation Steps

### Phase 1: Frontend Enhancements in `frontend/src/pages/CustomerPortal/index.tsx`
- **Step 1: Selection Controls for Regular Prescriptions (Section 1)**
  - Implement `handleSelectAllRefills()`: Selects all items in `refills` with their default prescribed quantities (`quantity_needed || 1`).
  - Implement `handleClearRefills()`: Deselects all refill items from `selectedItems`.
  - Add UI controls in the header:
    - Counter chip: `{selectedRefillCount} of {refills.length} selected`.
    - Compact action buttons: `Select All` and `Clear`.

- **Step 2: Active Booking Status Badge on Refills & Past Requests**
  - Cross-reference each medicine in `refills` against active items in `customerOrders` (status: `pending`, `confirmed`, `ready`, `order_ready_for_pickup`, `pending_verification`).
  - Render an informative chip on the medicine item:
    `⏳ Active Order #{order.id} ({status})`.
  - Informs the patient that an order is currently active, while keeping the checkbox accessible if they want to order additional packs.

- **Step 3: 1-Click "Reorder Items" Button on Past Online Orders (Section 0)**
  - Add a `handleReorderOnlineOrder(order)` function:
    - Iterates over `order.items` (or `order.product`).
    - Maps each item into `selectedItems` with its original quantity and pricing.
    - Sets `isCartModalOpen(true)` so the patient can review and immediately click "Place Order".
  - Add a clean `🔁 Reorder Items` button in each order card's action row.

- **Step 4: Enhanced Multi-Item Cart Summary**
  - Ensure the floating basket trigger and cart modal show the exact count of items and total units.
  - Distinguish item sources (`Refill`, `Previous Order`, `Catalog`).

---

## 3. Verification & Guardrails
- **Step 5: Run Automated Guardrails**
  - Run `npm run guardrails` and verify exit code 0.
- **Step 6: TypeScript Type Check**
  - Run `tsc --noEmit` and `npx tsc -b frontend` to verify 0 compile errors.
- **Step 7: Auto-Knowledge Graph Update**
  - Run `node scripts/quick-update.mjs`.
