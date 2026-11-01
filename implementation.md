# Implementation Plan: Universal Distributor Phone Number Index & Resolution Pipeline

## Problem Statement
Previously, the app had fragmented and splintered paths for resolving and saving distributor phone numbers:
1. **Ad-hoc backend queries**: In `src/routes/pharmarack.ts` (`/send-single-whatsapp`), `src/services/notificationService.ts` (`notifyDistributorCartOrder`), and `src/routes/whatsappQueue.ts`, raw SQL queries were looking up numbers directly on `distributors` or `distributor_dispatch_reminders` with exact name matching or raw updates, bypassing `resolveDistributorContact` and `pharmarack_distributor_mappings`.
2. **Frontend Priority Inversion**: In `frontend/src/pages/PharmarackCart/index.tsx`, `getDistributorPhoneNumber` checked `dist.distributor_phone` as Priority 1 ahead of session edits (`customDistributorPhones`) and store mappings (`distributorMappings`). When a user updated a number in the modal, the old pre-resolved number took precedence.
3. **State Desync on Save**: Saving a contact in `handleSaveDistributorContact` or inline fast-fill updated mappings but omitted updating the active `distributors` state array in memory, causing UI badges (such as delivery boys and missing phone badges) to lag until an app reload.
4. **Encoding Artifact**: Line 7038 had a mangled ellipsis character (`'ΓÇª'`) in the missing phone counter.
5. **Installed App Build Gap**: In `frontend/src/pages/PharmarackCart/index.tsx`, the `Distributor` interface was missing `phone`, `distributor_phone`, `distributor_id`, and `delivery_boy_id`, which caused `tsc -b` to fail during `npm run build:client`. As a result, the installed application was serving a stale build that lacked the single universal index improvements.

---

## Changes Implemented

### 1. Backend: Consolidate All Number Lookups into Universal Resolver
- **File**: `src/routes/pharmarack.ts`
  - In `/send-single-whatsapp`: Replaced ad-hoc SQL query with `resolveDistributorContact(db, storeName)` so it checks mappings, normalized names, and directory fallbacks consistently.
- **File**: `src/services/notificationService.ts`
  - In `notifyDistributorCartOrder`: Replaced raw `SELECT phone FROM distributors WHERE name LIKE ?` with `resolveDistributorContact(db, storeName)`.
- **File**: `src/routes/whatsappQueue.ts`
  - In `POST /single-order`: Replaced raw SQL updates with `syncDistributorPhoneAcrossTables(db, { store_name: storeName, phone: rawDigits })` so mappings, directory, and reminders update atomically and trigger real-time SSE.
  - Used `toLocalSqlDateTime().slice(0, 10)` for local date to strictly satisfy Guardrail B4.

### 2. Frontend: Priority Order, Type Definitions & Real-Time State Sync
- **File**: `frontend/src/pages/PharmarackCart/index.tsx`
  - Extended `interface Distributor` with `phone?: string`, `distributor_phone?: string`, `distributor_id?: number | null`, `delivery_boy_id?: number | null`.
  - In `getDistributorPhoneNumber`:
    - Priority 1: User's transient session edit `customDistributorPhones[dist.storeId]`
    - Priority 2: Single master store mapping `distributorMappings[normName]?.phone` (including stripped alphanumeric fallback)
    - Priority 3: Server pre-resolved contact `dist.distributor_phone || dist.phone`
    - Priority 4: Directory exact and stripped match in `savedDistributorsList`
  - In `resolveInitialDeliveryBoyId`: Prioritized `distributorMappings` (user's explicit preference) with alphanumeric fallback before server pre-resolved and directory fallbacks.
  - In `handleOpenEditModal`: Checked `customDistributorPhones` and `storedMap?.phone` before `dist.distributor_phone`.
  - In `handleSaveDistributorContact` and `handleInlineQuickSaveDistPhone`:
    - Updated `setDistributors` in-memory state immediately so phone and delivery boy update instantaneously across the cards with 0ms latency.
    - Preserved `deliveryBoyId` during inline quick-saves.
  - In `handleDistributorContactUpdate` (SSE listener):
    - Matched both exact and alphanumeric stripped store keys and updated active `distributors` in state, including updating or clearing delivery boys.
  - Fixed character encoding on line 7038 from `'ΓÇª'` to `'...'`.

### 3. Production Client Build
- Recompiled `frontend/dist` with `npm run build:client` (`tsc -b && vite build`) so packaged and installed desktop applications receive the exact same code and single universal index as the development environment.

---

## Verification Plan & Results

### Automated Checks
1. **Backend Integration Test**: Executed automated test script (`test_distributor_lookup.mjs`) verifying:
   - Atomic sync via `syncDistributorPhoneAcrossTables`.
   - Resolution by exact Pharmarack store name (`TEST_PHARMARACK_STORE_PUNE_123` $\rightarrow$ `9876543210`).
   - Resolution by canonical directory name (`Test Canonical Pharma` $\rightarrow$ `9876543210`).
   - Resolution by normalized variation (`Test-Canonical-Pharma (Pune)` $\rightarrow$ `9876543210`).
   - Atomic phone update propagation (`9123456789`).
   - Result: **All tests passed (exit code 0)**.
2. **Frontend Production Build**: Ran `npm run build:client` (`tsc -b && vite build`). Result: **PASS (exit code 0)**, compiled 2695 modules into `frontend/dist`.
3. **Performance Guardrails**: Ran `npm run guardrails` (`tsc --noEmit` clean, zero violations, B4 local time compliance). Result: **PASS (exit code 0)**.
4. **Knowledge Graph**: Ran `node scripts/quick-update.mjs` (1340 files, 877 edges). Result: **PASS (exit code 0)**.

---

## Tasks Completed & Status

- [x] Task 1: Replace ad-hoc SQL distributor number lookups with `resolveDistributorContact` and `syncDistributorPhoneAcrossTables` in `src/routes/pharmarack.ts`, `src/services/notificationService.ts`, and `src/routes/whatsappQueue.ts`.
  - *Completed*: All 3 locations now route through `resolveDistributorContact` and `syncDistributorPhoneAcrossTables`.
- [x] Task 2: Correct priority ordering in `getDistributorPhoneNumber`, `resolveInitialDeliveryBoyId`, and `handleOpenEditModal` in `frontend/src/pages/PharmarackCart/index.tsx`.
  - *Completed*: Transient user edits and master mappings take priority over stale pre-resolved strings.
- [x] Task 3: Ensure `handleSaveDistributorContact`, `handleInlineQuickSaveDistPhone`, and SSE handlers update active `distributors` state immediately with zero latency.
  - *Completed*: In-memory `distributors` state is updated synchronously on save and on SSE event reception.
- [x] Task 4: Fix character encoding artifact on line 7038 in `PharmarackCart/index.tsx`.
  - *Completed*: Replaced mangled character with ASCII `'...'`.
- [x] Task 5: Fix `interface Distributor` TypeScript types and compile clean production bundle with `npm run build:client`.
  - *Completed*: `tsc -b && vite build` built successfully with exit code 0.
- [x] Task 6: Run `npm run guardrails`, run `node scripts/quick-update.mjs`, and verify all tests pass.
  - *Completed*: Guardrails passed with exit code 0 (`tsc --noEmit` clean, 0 violations); knowledge graph updated.
- [x] Task 7: Human-in-the-Loop review and verification report.
  - *Completed*: Ready for operator review.
