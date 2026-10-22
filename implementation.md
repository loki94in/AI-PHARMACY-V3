# Implementation Plan: Pharmarack Order ID Capture, 5-Min Grace Period Dispatch & Medicine De-duplication

## 1. Goal
1. **Never send a blank / Order-ID-less dispatch reminder**: Guarantee the official PO ID (e.g. `#HJW26466`) is captured from Pharmarack using a forced sync (`force=true`) and retry loop before generating any distributor notification. Never send empty fallback reminders without an Order ID.
2. **5-Minute Grace Period Hold (Human-in-the-Loop)**: When an order is placed from the cart, do not blast the reminder immediately. Schedule it in `whatsapp_send_queue` with a 5-minute hold (`Date.now() + 5 * 60 * 1000`). Display the live countdown in the Dispatch UI with 1-click "Send Now" (immediate release) and "Cancel / Delete" actions.
3. **Zero Duplicate Medicines in Dispatch**: Ensure same-day orders for a distributor do not duplicate identical medicines across multiple order cards or with mismatched PO numbers. Upgrade multi-order line deduplication.

---

## 2. Technical Architecture & File Changes

1. **`src/routes/pharmarack.ts` (`/cart/place-official-orders`)**:
   - In Step 2 & Step 3: Call `syncPharmarackOrders(true)` with `force = true` and a short polling loop (polling every 3s, max 15s) until the new orders show up in `pharmarack_synced_orders`.
   - In Step 4: Enqueue the distributor dispatch reminder with:
     - Verified PO ID(s) only (if no PO ID is verified, do not send; flag as pending confirmation).
     - Set `scheduled_at = Date.now() + 5 * 60 * 1000` (5-minute grace period hold).
     - Update the reminder record in `distributor_dispatch_reminders` so Dispatch shows the active grace period.
2. **`src/services/pharmarackOrderSyncService.ts`**:
   - Upgrade `deduplicateSameStoreMultiOrderLines(db)` so it does not only compare `rowA.length > rowB.length`. It must deduplicate any identical medicine items appearing across multiple rows for the same distributor on the same day.
   - When associating in-app placed orders with newly synced orders, link them strictly by `order_no` and prevent creating duplicate duplicate rows.
3. **`src/services/distributorDispatchReminderWorker.ts`**:
   - Ensure `orders_list` inside each distributor reminder strictly maps medicines to their true `order_no`.
   - Prevent duplicate medicine previews across `orders_list` for the same distributor.
4. **`frontend/src/pages/Dispatch/index.tsx`**:
   - Ensure the 5-Minute Grace Period banner and countdown (`⏳ X min remaining`) render reliably for orders held in grace period.
   - Verify "Send Now" (force release) and "Cancel" buttons exist and work smoothly.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Update `src/routes/pharmarack.ts` to force-poll official Order IDs (`syncPharmarackOrders(true)`), ban empty reminders without PO #, and enforce a 5-minute grace period hold.
- [x] **Step 2**: Upgrade `src/services/pharmarackOrderSyncService.ts` line deduplication so multi-order items are never duplicated across rows.
- [x] **Step 3**: Update `src/services/distributorDispatchReminderWorker.ts` to ensure `orders_list` correctly isolates distinct orders without cross-order duplicate item repetition.
- [x] **Step 4**: Verify `frontend/src/pages/Dispatch/index.tsx` displays the grace period countdown, PO tags, and release/cancel controls properly.
- [x] **Step 5**: Run `npm run guardrails` and verify clean TypeScript compilation (`tsc --noEmit`).
- [x] **Step 6**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log

### Task 1: Force Official Order ID Sync & 5-Min Grace Period Enqueue (`src/routes/pharmarack.ts`)
- **What was completed**:
  - Replaced the cached order sync call with an active, forced sync: `syncPharmarackOrders(true)` with a retry polling loop (up to 3 attempts with a 2.5s pause) right after checkout so that the newly assigned Pharmarack PO Number (e.g., `#HJW26466`) is retrieved from `DisplayOrders` before dispatch messaging.
  - Added a strict guard: If Pharmarack has not yet returned a verified `order_no`, the reminder is **never** sent blank. It is suppressed from immediate sending and preserved in Dispatch with `Pending` status.
  - Implemented the 5-Minute Grace Period Hold: Instead of immediately sending the message, it is scheduled in `whatsapp_send_queue` with `scheduled_at = Date.now() + 5 * 60 * 1000`.
  - Registered the reminder in `distributor_dispatch_reminders` with `status = 'Pending'` so the Dispatch tab displays the active countdown badge (`⏳ 5-Min Hold`) and provides the human-in-the-loop "Send Now" (immediate release) and "Cancel Hold" controls.
  - Marked `announced_at` and `announce_result = 'held_in_grace_period'` in `pharmarack_synced_orders` to ensure background workers do not send a duplicate notification later.

### Task 2: Multi-Order Line & Orphan Row Deduplication (`src/services/pharmarackOrderSyncService.ts`)
- **What was completed**:
  - Overhauled `deduplicateSameStoreMultiOrderLines(db)` to eliminate redundant orphan rows (`order_no IS NULL`) where an official PO row already exists for that distributor on the same day.
  - Upgraded medicine deduplication logic: Rather than only comparing row item lengths (`rowA.length > rowB.length`), it performs strict item-key deduplication (`productCode` or normalized `productName`) across all rows for the same distributor on that day, preventing any medicine from appearing on multiple order cards.

### Task 3: Order Isolation & PO Tracking in Dispatch Worker (`src/services/distributorDispatchReminderWorker.ts`)
- **What was completed**:
  - Updated SQL queries in both `getTodayDistributorRemindersFast` and `syncTodayActiveDistributors` to fetch `order_no` from `pharmarack_placed_orders`.
  - Filtered out orphan rows whenever an official PO row exists for that distributor, preventing duplicate order cards from rendering in Dispatch.
  - Applied medicine item deduplication across multiple orders in `ordersList` so each medicine is listed under its true order only once.
  - Attached `order_no` to each order entry and prevented duplicate IDs during canonical reminder merging.

### Task 4: Suppress Blank Announcements in Notification Service (`src/services/notificationService.ts`)
- **What was completed**:
  - Added a strict safeguard in `sendDistributorDispatchReminder`: If `isOrderAnnouncement` or `followUp` is requested but no `orderNoText` exists, the method immediately logs a warning and returns `false`, preventing any blank or order-less message from being sent to WhatsApp.

### Task 5: Dispatch UI Order Number Display (`frontend/src/pages/Dispatch/index.tsx`)
- **What was completed**:
  - Updated `LocalDistributorOrderEntry` interface with `order_no?: string | null`.
  - Updated the order card chip to render `PO #${ord.order_no}` when available (instead of generic `Order #${oIdx + 1}`).
  - Validated that the existing 5-Minute Grace Period countdown badge (`⏳ Xm hold`), "Send Now" (immediate release) button, and "Cancel Hold" button connect seamlessly to the backend status.

### Task 6: Verification & Guardrails
- **What was completed**:
  - Executed `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) passed with 0 errors and zero performance/speed architecture violations.
  - Executed `npm run build --prefix frontend`: Production bundle built cleanly with zero TypeScript or bundling errors.
  - Executed `node scripts/quick-update.mjs`: Knowledge graph synchronized successfully with 1310 files and 826 edges.
