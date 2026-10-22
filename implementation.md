# Implementation Plan: Duplicate Phone Detection, Order ID Product Isolation & Multi-Order Safety

## 1. Goal
1. **Duplicate Phone Detection & Real-time Warning**:
   - When entering or saving a phone number for any distributor (in Dispatch, Cart, or Master Directory), the app will proactively check if that number is already assigned to another distributor or a delivery boy.
   - Display an instant real-time alert (e.g. `⚠️ 9762483343 is already assigned to AJAY PHARMA!`) so users never mistakenly save the same number across different distributors.
   - Provide human-in-the-loop controls: allow the user to easily change the number or explicitly confirm if it is an intentional shared counter/warehouse contact.
2. **Strict Order ID Product Isolation (Zero Cross-Order Mixing/Pruning)**:
   - Each Order / PO ID must strictly retain only its own products (`items_json`).
   - Remove aggressive same-store cross-order medicine pruning from `deduplicateSameStoreMultiOrderLines` and `distributorDispatchReminderWorker.ts`. Distinct orders placed on the same day must keep 100% of their respective items.
3. **Surgical PO Assignment by Order ID**:
   - In `src/routes/pharmarack.ts`, update `pharmarack_placed_orders` strictly by its specific order record ID (`WHERE id = ?`), never broad `WHERE store_name = ?` across all orders, preventing multiple orders from getting stamped with the same PO number.
4. **Zero Phantom 0-Item Cards in Sent Orders**:
   - In `/api/pharmarack/sent-orders`, if an in-app placed order already exists for that store/PO with items, suppress creating redundant empty synced cards.

---

## 2. Technical Architecture & File Changes

1. **`src/routes/distributors.ts`**:
   - Add endpoint `GET /api/distributors/check-duplicate-phone`:
     - Checks `distributors`, `pharmarack_distributor_mappings`, and `delivery_boys` tables.
     - Returns `{ isDuplicate, matchedDistributor, matchedDeliveryBoy }`.
2. **`src/routes/pharmarack.ts` (`/cart/place-official-orders` & `/sent-orders`)**:
   - Update `pharmarack_placed_orders` with confirmed `order_no` strictly targeting the specific unattached row by `id = ?`.
   - In `/sent-orders`, deduplicate synced orders against existing placed orders so empty 0-item placeholder cards are never duplicated when a full order card exists.
3. **`src/services/pharmarackOrderSyncService.ts`**:
   - In `deduplicateSameStoreMultiOrderLines`: Keep 100% of line items for distinct orders (different `order_no`). Never delete products across different orders of the same distributor.
4. **`src/services/distributorDispatchReminderWorker.ts`**:
   - In `getTodayDistributorRemindersFast` and `syncTodayActiveDistributors`: Remove cross-order item deduplication across distinct POs. Each order preview shows its true products.
5. **`frontend/src/services/api.ts`**:
   - Expose `checkDuplicateDistributorPhone(phone, excludeId?, excludeName?)`.
6. **`frontend/src/pages/Dispatch/index.tsx`**:
   - Real-time debounced duplicate check on phone input when editing distributor phone.
   - Warning banner: `⚠️ Already saved for [Distributor Name]`.
   - Human-in-the-loop confirmation modal if user attempts to save a conflicting number: `[Change Number]` vs `[Confirm Shared Contact]`.
7. **`frontend/src/pages/PharmarackCart/index.tsx`**:
   - Live duplicate phone check and warning in single dispatch modal & mapping save.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Add `GET /check-duplicate-phone` in `src/routes/distributors.ts` and expose it in `frontend/src/services/api.ts`.
- [x] **Step 2**: Fix surgical `order_no` update in `src/routes/pharmarack.ts` (`/cart/place-official-orders`) so only the specific order row is updated.
- [x] **Step 3**: Remove cross-order item pruning in `src/services/pharmarackOrderSyncService.ts` and `src/services/distributorDispatchReminderWorker.ts` so each PO retains 100% of its own products.
- [x] **Step 4**: Suppress duplicate 0-item placeholder cards in `src/routes/pharmarack.ts` (`/sent-orders`).
- [x] **Step 5**: Integrate real-time duplicate warning and human-in-the-loop confirmation in `frontend/src/pages/Dispatch/index.tsx`.
- [x] **Step 6**: Integrate duplicate phone check in `frontend/src/pages/PharmarackCart/index.tsx`.
- [x] **Step 7**: Run `npm run guardrails` and verify clean TypeScript compilation (`tsc --noEmit`).
- [x] **Step 8**: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log

1. **Step 1 - Backend & API Duplicate Phone Validation**:
   - Implemented `GET /api/distributors/check-duplicate-phone` in `src/routes/distributors.ts` querying `distributors`, `pharmarack_distributor_mappings`, and `delivery_boys`.
   - Exposed `api.checkDuplicateDistributorPhone(phone, excludeId?, excludeName?)` in `frontend/src/services/api.ts`.
2. **Step 2 - Surgical PO Assignment by Order ID**:
   - In `src/routes/pharmarack.ts` (`/cart/place-official-orders`), updated `pharmarack_placed_orders` post-checkout update to target the exact row ID (`WHERE id = ?`) rather than broad date and store name match.
3. **Step 3 - Order ID Product Isolation (Zero Cross-Order Mixing/Pruning)**:
   - In `src/services/pharmarackOrderSyncService.ts` (`deduplicateSameStoreMultiOrderLines`), removed cross-order item deduplication across distinct `order_no`s. Distinct orders retain 100% of their respective items.
   - In `src/services/distributorDispatchReminderWorker.ts`, updated `getTodayDistributorRemindersFast` and `syncTodayActiveDistributors` so orders never strip medicines belonging to other orders of the same distributor.
4. **Step 4 - Phantom 0-Item Card Suppression in Sent Orders**:
   - In `src/routes/pharmarack.ts` (`/sent-orders`), merged synced orders into existing store order cards, strictly suppressing redundant 0-item placeholder cards.
5. **Step 5 - Human-in-the-Loop Confirmation in Dispatch**:
   - In `frontend/src/pages/Dispatch/index.tsx`, added debounced duplicate check on phone input, an amber alert badge when a duplicate is found, and a Human-in-the-Loop confirmation modal (`[Change Number]` vs `[Confirm Shared Contact]`) before saving.
6. **Step 6 - Duplicate Warning & Confirmation in PharmarackCart**:
   - In `frontend/src/pages/PharmarackCart/index.tsx`, added real-time duplicate phone checking, warning callout under input, and human-in-the-loop confirmation banner in the contact modal.
7. **Step 7 & 8 - Verification & Knowledge Graph Sync**:
   - Fixed all raw Tailwind color classes to comply with semantic theming (F6 guardrail).
   - Passed `npm run guardrails` with 0 violations and verified TypeScript compilation (`tsc --noEmit`).
   - Ran `node scripts/quick-update.mjs` to synchronize knowledge graph (1,310 nodes, 826 edges).
