# Implementation Plan: Official Pharmarack Order Placement & Concise WhatsApp PO Dispatch Reminder

## 1. Goal
Transition the Pharmarack cart ordering workflow:
- Place purchase orders officially through the Pharmarack retailer platform (`retailers.pharmarack.com`).
- Track and capture the official Pharmarack Order ID (`OrderNo`) in the app and Sent PO History.
- Replace the legacy verbose WhatsApp message (which dumped 20-50 medicine item lines with packaging and MRP) with a clean, concise **Dispatch Reminder** sent to the distributor referencing the official Order ID (#PO).
- Retain the itemized verification list exclusively for the assigned Delivery Staff so they can count and check medicines upon counter pickup.
- Provide human-in-the-loop review and Order ID override in `SingleDispatchModal` prior to dispatch.

---

## 2. User Selections & Design Contract
- **Distributor Notification**: Pure reminder message containing:
  - Official Pharmarack Order ID (`#<OrderNo>` or `#<Id>`)
  - Immediate packing & dispatch request
  - Assigned Delivery / Pickup Staff details (Name, Contact)
  - Pharmacy details & invoice format note
  - Zero individual medicine item lines.
- **Delivery Staff Notification**: Preserved with item list so the delivery person can physically cross-check medicines when collecting the shipment from the distributor counter.
- **Human-in-the-Loop**: `SingleDispatchModal` displays the auto-detected Pharmarack Order ID, permits manual edit/override, and previews the concise reminder message before sending.

---

## 3. Proposed Changes

### Frontend
1. **`frontend/src/pages/PharmarackCart/SingleDispatchModal.tsx`**:
   - Add `orderNo` state & input field (pre-populated with detected Order ID or empty for manual entry).
   - Display live preview of the concise dispatch reminder message.
   - Pass the resolved `orderNo` to the confirm handler.
2. **`frontend/src/pages/PharmarackCart/index.tsx`**:
   - Update `buildDistributorOrderMessage(dist, resolvedBoy, customOrderNo)`:
     - Detect synced Pharmarack `order_no` from `sentOrders` / `latestSentMap` or use `customOrderNo`.
     - Output the concise dispatch reminder format (Order #, Delivery Staff, Pharmacy contact, invoice note).
     - Remove the `📋 ORDER ITEMS` line dump from distributor text.
   - Update `handleSendWhatsAppOrder` and `handleConfirmSingleDispatch` to accept and pass the Order ID.
   - Ensure the Delivery Boy backend notification keeps the items for verification.

### Backend
3. **`src/utils/whatsappTemplateBuilder.ts`**:
   - Update `buildStandardDistributorOrderMessage`:
     - When `orderNo` is present or `isReminder` is set, format the concise dispatch reminder without the lengthy medicine items list.
4. **`src/services/notificationService.ts`**:
   - In `notifyDistributorCartOrder`:
     - Look up synced Pharmarack `order_no` for the distributor.
     - Ensure the distributor receives the clean reminder while Delivery Boy notifications continue to receive the verification items list.

---

## 4. Verification Plan
1. **TypeScript & Static Check**:
   - Run `npx tsc --noEmit` across `frontend` and root backend to verify zero type regressions.
2. **Performance Guardrails**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
3. **Knowledge Graph Update**:
   - Run `node scripts/quick-update.mjs`.
4. **Functional Testing**:
   - Verify `SingleDispatchModal` renders the Order ID input, pre-fills when synced, and shows live concise preview.
   - Verify `buildDistributorOrderMessage` formats the concise reminder with Order ID and delivery boy contact, completely omitting individual medicine items.
   - Verify Delivery Boy notification payload still retains item list for counter verification.

---

## 5. Execution Tasks & Status
- [x] Task 1: Update `SingleDispatchModal.tsx` to support Order ID review, edit, and live message preview.
  - *Completed*: Added `orderNo` input, helper text, and live message preview card to `SingleDispatchModal` with human-in-the-loop review.
- [x] Task 2: Update `PharmarackCart/index.tsx` `buildDistributorOrderMessage` and dispatch handlers for the concise reminder.
  - *Completed*: Updated `buildDistributorOrderMessage` to format the pure dispatch reminder with official Order #/ID, delivery staff, and pharmacy details (completely omitting redundant 50+ medicine lists). Bound order number lookup from `sentOrders` into `SingleDispatchModal` and dispatch handlers.
- [x] Task 3: Update `whatsappTemplateBuilder.ts` and `notificationService.ts` to standardize backend reminder messages.
  - *Completed*: Enhanced `buildStandardDistributorOrderMessage` to support `orderNo` and `isReminderOnly` branch. Updated `notifyDistributorCartOrder` in `notificationService.ts` to resolve today's synced Pharmarack `order_no` using local shop time and send the concise PO reminder while preserving full item lists for delivery boys.
- [x] Task 4: Run tests, TypeScript compilation check, guardrails scanner, and quick-update.
  - *Completed*: Verified zero errors on backend `tsc --noEmit`, verified frontend `npm run build` (0 errors), passed `npm run guardrails` (0 violations), and completed `node scripts/quick-update.mjs` (0 errors, knowledge graph refreshed).
