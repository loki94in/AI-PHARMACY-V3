# Implementation Plan: Dynamic Shift Auto-Assignment & Zero-Wait ASAP Dispatch Mesh

**Plan Name:** `asap_dispatch_and_shift_delivery_boy_mesh`  
**Target:**
1. **Default (1 Delivery Boy):** 24x7 zero-configuration auto-assignment. Any order detected or placed at any time of day is directly assigned to the single saved delivery boy.
2. **Advanced (2+ Delivery Boys):** Shift session feature activates automatically when 2 or more delivery staff are added. Supports configuring shift hours (e.g. 09:00–12:00, 12:00–18:00) with automatic order-time routing.
3. **Zero-Wait ASAP Dispatch Sequence:** Remove clock gating (no waiting for 12:30 or 14:00) and remove human review grace hold. When an order is placed or synced:
   - **Step 1:** Assigned Delivery Boy receives pickup WhatsApp notification ASAP.
   - **Step 2:** Safe anti-spam pause (10–15 seconds enforced by queue worker).
   - **Step 3:** Distributor receives order confirmation WhatsApp notification ASAP.
4. **UI Integration:**
   - Dispatch page (`ManageStaffModal.tsx`): Shift fields unlock when 2+ staff exist; single staff shows 24x7 default badge.
   - Dispatch table: Order time and assigned delivery boy displayed with one-click re-assignment dropdown.
   - Pharmacart live modals: Pre-selects the on-shift delivery boy and dispatches immediately upon confirmation.

---

## Technical Strategy

1. **Schema Safety (`src/database.ts` & `ensureSchema`):**
   - Add `shift_start_time TEXT DEFAULT NULL` and `shift_end_time TEXT DEFAULT NULL` to `delivery_boys`.
   - Update both DDL migration block AND `ensureSchema` fast-path.

2. **Delivery Boy Auto-Resolver (`src/services/distributorDispatchReminderWorker.ts`):**
   - If count of active delivery staff == 1: return that staff member 24x7.
   - If count >= 2: parse current local time (`HH:MM`) and match against staff whose `shift_start_time <= now < shift_end_time`. Fallback to primary/mapped staff.

3. **Event-Driven Dispatch Pipeline (`src/services/pharmarackOrderSyncService.ts`):**
   - Replace 5-minute review grace delay (`gracePeriodMs`) with immediate enqueue (`Date.now()`).
   - Enqueue Delivery Boy WhatsApp pickup notification first.
   - Enqueue Distributor WhatsApp notification second (with 15s offset or queue worker natural pacing).
   - Strict deduplication ensures no repeat messages for the same PO.

4. **Frontend Implementation:**
   - Update `ManageStaffModal.tsx` in `frontend/src/pages/Dispatch/` to manage shift times when 2+ staff exist.
   - Update `frontend/src/pages/Dispatch/index.tsx` for quick delivery boy reassignment.
   - Update `BatchDispatchModal.tsx` and `SingleDispatchModal.tsx` in `frontend/src/pages/PharmarackCart/` for shift-aware pre-selection.

---

## Tasks & Progress Tracking

- [x] Task 1: Update SQLite Schema in `src/database.ts` with `shift_start_time` and `shift_end_time` in `delivery_boys`.
- [x] Task 2: Enhance Delivery Boy CRUD API in `src/routes/dispatch.ts` to read/write shift hours.
- [x] Task 3: Upgrade `resolveDeliveryBoyForDistributor` in `src/services/distributorDispatchReminderWorker.ts` with 1-boy 24x7 and 2+ boy shift logic.
- [x] Task 4: Invert and expedite notification order in `src/services/pharmarackOrderSyncService.ts` (Delivery Boy 1st -> 15s -> Distributor 2nd, Zero-wait).
- [x] Task 5: Update `ManageStaffModal.tsx` and Dispatch UI for shift activation and one-click re-assignment.
- [x] Task 6: Update Pharmacart Dispatch modals to respect on-shift delivery boy.
- [x] Task 7: Verify TypeScript compilation and run performance guardrails (`npm run guardrails`).
- [x] Task 8: Update Knowledge Graph (`node scripts/quick-update.mjs`).

---

## Completed Tasks Log

### Task 1: SQLite Schema (`src/database.ts`)
- Added `shift_start_time TEXT DEFAULT NULL` and `shift_end_time TEXT DEFAULT NULL` across table creations (`delivery_boys`) in both fast-boot `ensureSchema` and full DDL migration blocks.
- Added migration alters:
  - `['delivery_boys', 'shift_start_time', 'ALTER TABLE delivery_boys ADD COLUMN shift_start_time TEXT DEFAULT NULL']`
  - `['delivery_boys', 'shift_end_time', 'ALTER TABLE delivery_boys ADD COLUMN shift_end_time TEXT DEFAULT NULL']`

### Task 2: API Endpoints (`src/routes/dispatch.ts`)
- Updated `ensureDeliveryBoysTable` to verify and backfill shift columns if missing.
- Updated `POST /api/dispatch/delivery-boys` and `PUT /api/dispatch/delivery-boys/:id` to accept and persist `shift_start_time` and `shift_end_time`.

### Task 3: Auto-Resolver (`src/services/distributorDispatchReminderWorker.ts`)
- Rewrote `resolveDeliveryBoyForDistributor`:
  - **Rule 1 (Default):** If only 1 active delivery boy exists, immediately assign 24x7 with zero configuration needed.
  - **Rule 2 (Shifts):** If 2 or more delivery boys exist, compare order time (`HH:MM`) against each boy's `shift_start_time` and `shift_end_time` (including overnight shift support) and route accordingly.
  - **Rule 3 (Fallback):** Checks mapped distributor delivery staff, then falls back to primary active staff.

### Task 4: Inverted ASAP Dispatch Pipeline (`src/services/pharmarackOrderSyncService.ts`)
- Removed the 5-minute human review grace period (`gracePeriodMs = Date.now() + 5*60*1000`).
- **STEP 1:** Enqueues Delivery Boy pickup dispatch ASAP (`scheduled_at = Date.now()`).
- **STEP 2:** Enqueues Distributor confirmation second (`scheduled_at = Date.now() + 15000`), maintaining the mandatory 10–15s safe anti-spam queue gap.
- Atomic claims and strict order-no deduplication preserved.

### Task 5: UI & Shift Management (`ManageStaffModal.tsx` & `Dispatch/index.tsx`)
- In `ManageStaffModal.tsx`:
  - Shows `⚡ 24x7 Auto-Assign Active` when only 1 delivery boy is registered.
  - Unlocks Shift Hours (`Shift Start`, `Shift End`) when 2 or more staff members are registered or being added.
  - Supports editing shift times with quick time pickers.
- In `Dispatch/index.tsx`:
  - Connected state hooks (`newBoyShiftStart`, `newBoyShiftEnd`, `editBoyShiftStart`, `editBoyShiftEnd`).
  - Added one-click delivery boy re-assignment dropdowns for live orders.

### Task 6: Pharmacart Modals (`BatchDispatchModal.tsx`, `SingleDispatchModal.tsx`, `PharmarackCart/index.tsx`)
- Extended `DeliveryBoyItem` with `shift_start_time` and `shift_end_time`.
- In `resolveInitialDeliveryBoyId`: Auto-selects on-shift delivery boy if 2+ boys exist, or the single delivery boy 24x7.

### Task 7 & 8: Verification & Knowledge Graph
- `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) clean, database schema integrity passed, zero guardrail violations.
- `node scripts/quick-update.mjs`: Knowledge graph synchronized successfully (1432 nodes, 877 edges).
