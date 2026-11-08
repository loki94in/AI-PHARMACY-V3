# Implementation Plan: Instant In-Memory State Updates for Core Operational Pages

## 1. Overview & Objective
Upgrade the core operational pages (**Inventory**, **Purchase History**, and **Dispatch**) to support **0ms Instant In-Memory State Updates**. 
Previously, actions such as toggling online medicine availability, editing inventory batches, deleting purchases, and assigning delivery boys or updating dispatch statuses awaited network round-trips before refetching full tables.
This plan implements optimistic in-memory mutations with automated rollback on server failure, backed by the existing `useInfiniteScroll` and module-cache contracts.

---

## 2. Target Files & Surgical Scope
1. **`frontend/src/pages/Inventory/index.tsx`**:
   - Unpack `removeItem` and `updateItem` from `useInfiniteScroll`.
   - Make `handleToggleOnline` instant in-memory with rollback.
   - Make `handleBulkOnline` instant in-memory with rollback.
   - Make `handleSave` (drawer batch edit) instant in-memory with rollback.
2. **`frontend/src/pages/PurchaseHistory/index.tsx`**:
   - Unpack `removeItem` from `useInfiniteScroll`.
   - Make `handleDeletePurchase` instant in-memory row eviction with rollback on failure.
3. **`frontend/src/pages/Dispatch/index.tsx`**:
   - Make `handleAssignDeliveryBoy` instant in-memory update across `orders`, `websiteOrders`, and module caches.
   - Make `handleUnifiedStatusChange` instant in-memory status flip across `orders`, `websiteOrders`, and module caches.
4. **Documentation**:
   - Updated `frontend/AGENTS.md` to document the instant in-memory update contracts for these pages.

---

## 3. Human-In-The-Loop (HITL) Contract (Rule 6)
Every instant in-memory state update remains strictly governed by human operators:
- All destructive actions (e.g. deleting purchase invoices) still require explicit human confirmation modal click before the optimistic eviction triggers.
- In the event of a network or server constraint failure, the UI immediately reverts the in-memory state to the truthful server snapshot and surfaces an informative error toast.
- Manual refresh buttons remain available on all pages so operators can force an authoritative server reconciliation at any time.

---

## 4. Step-by-Step Execution Plan

### Step 1: Inventory Instant In-Memory Updates
- Modify `frontend/src/pages/Inventory/index.tsx`:
  - Extract `updateItem` and `removeItem` from `useInfiniteScroll`.
  - In `handleToggleOnline(medId, currentOnline)`:
    - Capture previous `is_online` status.
    - Call `updateItem(i => (i.medicine_id || i.id) === medId, i => ({ ...i, is_online: nextOnline ? 1 : 0 }))`.
    - Fire `api.toggleOnlineStatus`.
    - In `catch`, rollback with `updateItem(..., { is_online: currentOnline ? 1 : 0 })` and trigger error toast.
  - In `handleBulkOnline(isOnline)`:
    - Optimistically update all matching `selectedMedIds` in memory via `updateItem`.
    - Fire API call; rollback if failed.
  - In `handleSave()`:
    - Optimistically apply `editForm` to `selectedItem` and table via `updateItem`.
    - Close editor immediately; rollback on API error.

### Step 2: Purchase History Instant In-Memory Row Eviction
- Modify `frontend/src/pages/PurchaseHistory/index.tsx`:
  - Extract `removeItem` from `useInfiniteScroll`.
  - In `handleDeletePurchase(tx)`:
    - Close confirmation modal immediately (`setDeleteConfirmPurchase(null)`).
    - Evict row instantly from table via `removeItem(i => i.id === tx.id)`.
    - Fire `api.deletePurchase(tx.id)`.
    - On failure, trigger `refetch()` and display error toast.

### Step 3: Dispatch Instant Delivery Staff Assignment & Status Updates
- Modify `frontend/src/pages/Dispatch/index.tsx`:
  - In `handleAssignDeliveryBoy(order, boyId)`:
    - Optimistically update `orders` and `websiteOrders` state: update `delivery_boy_id` and `delivery_boy_name`.
    - Sync into `setDispatchOrdersCache`.
    - Fire background PUT. On catch, rollback to previous values and toast error.
  - In `handleUnifiedStatusChange(order, newStatus)`:
    - Optimistically update `orders` and `websiteOrders` state: update `status`.
    - Sync into `setDispatchOrdersCache`.
    - Fire background PUT. On catch, rollback to previous status and toast error.

### Step 4: Verification & Guardrails
- Run `npm run guardrails` to verify no performance guardrail violations (No-GPU, mark-stale, no syntax errors).
- Run `tsc -b && vite build` in `frontend/` to verify clean TypeScript compilation and asset packaging.
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 5. Completed Tasks & Verification Log
- [x] **Task 1 (Inventory)**: Unpacked `updateItem` and `removeItem` in `frontend/src/pages/Inventory/index.tsx`. Upgraded `handleToggleOnline`, `handleBulkOnline`, and `handleSave` to 0ms instant in-memory state updates with automatic rollback on network failure.
- [x] **Task 2 (Purchase History)**: Unpacked `removeItem` in `frontend/src/pages/PurchaseHistory/index.tsx`. Upgraded `handleDeletePurchase` to 0ms instant row eviction with modal dismissal and rollback on failure.
- [x] **Task 3 (Dispatch)**: Upgraded `handleAssignDeliveryBoy` and `handleUnifiedStatusChange` in `frontend/src/pages/Dispatch/index.tsx` to 0ms instant in-memory state and module cache updates with automatic rollback.
- [x] **Task 4 (Documentation & DOX)**: Documented instant in-memory state contracts in `frontend/AGENTS.md`.
- [x] **Task 5 (Verification & Guardrails)**:
  - `npm run guardrails` passed with 0 violations.
  - `tsc -b && vite build` passed in 1m 6s.
  - `node scripts/quick-update.mjs` synchronized knowledge graph (1498 files).
