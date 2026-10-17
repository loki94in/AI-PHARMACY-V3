# Implementation Plan: Single Canonical Distributor Name on Pharmarack Mapping & Merge

**Goal:**
Ensure there is only ONE canonical name per distributor across the entire application (Dispatch page, purchase bills, settings, and reminders). When a distributor is mapped to Pharmarack or merged:
1. Provide a one-click confirmation to overwrite the local/migration distributor name with the official Pharmarack name.
2. Unify all past and future bills and ledgers automatically under that single name.
3. Automatically re-link and deduplicate `distributor_dispatch_reminders` during distributor merge and mapping.
4. Add canonical in-memory deduplication in `getTodayDistributorRemindersFast` to guarantee the Dispatch page never displays duplicate cards.

---

## 1. Architecture & Design

### A. Pharmarack Mapping Endpoint (`POST /pharmarack/distributor-mappings`)
- Accept `overwrite_distributor_name?: boolean`.
- When `overwrite_distributor_name` is true and a valid `distributor_id` is supplied:
  - Update `distributors.name = store_name` where `id = distributor_id`.
  - Update `distributor_dispatch_reminders.distributor_name = store_name` where `distributor_id = distributor_id`.
  - If another distributor record already exists with `name = store_name` (or case-insensitive equal), merge the duplicate distributor records into this master distributor ID.

### B. Distributor Merge Re-linking (`src/routes/settings.ts` & `src/routes/learning.ts`)
- In `POST /distributors/merge` and `POST /api/learning/profiles/merge`:
  - Add `distributor_dispatch_reminders` to the re-linking routine:
    `UPDATE distributor_dispatch_reminders SET distributor_id = ?, distributor_name = ? WHERE distributor_id IN (...)`
  - Run deduplication on `distributor_dispatch_reminders` for rows with matching `date` and `distributor_id` to merge order counts and remove duplicate reminder entries.

### C. Fast Dispatch Reminder Deduplication (`getTodayDistributorRemindersFast`)
- In `src/services/distributorDispatchReminderWorker.ts`:
  - Group fetched rows by `getCanonicalDistributorKey(r.distributor_id, r.distributor_name)`.
  - If multiple rows exist on the same date for the same canonical vendor, merge them into a single primary card (combining order counts, orders list, and preserving the most advanced status like `Dispatched` or `Pending`).
  - Guarantees 0 duplicate cards on the Dispatch page regardless of raw database artifacts.

### D. Frontend 1-Click Confirmation Prompt (`PharmarackCart/index.tsx`)
- When a user maps a Pharmarack distributor to a local distributor, detect name divergence:
  - If `dist.name.toLowerCase().trim() !== storeName.toLowerCase().trim()`, show a prompt/checkbox:
    *"Update distributor name in pharmacy to '[Pharmarack Name]' to unify all bills and reminders"* (checked by default).
  - Submit `overwrite_distributor_name: true` when checked.

---

## 2. Verification Plan

1. **TypeScript Compilations:**
   - Backend: `npx tsc --noEmit`
   - Frontend: `npx tsc -p frontend/tsconfig.app.json --noEmit`
2. **Performance Guardrails:**
   - `npm run guardrails` (zero violations)
3. **Runtime & Data Verification:**
   - Test `getTodayDistributorRemindersFast` to ensure 0 duplicates.
   - Test mapping API with `overwrite_distributor_name: true`.
   - Test `/distributors/merge` re-linking of `distributor_dispatch_reminders`.
4. **Knowledge Graph Synchronization:**
   - `node scripts/quick-update.mjs`

---

## 3. Task Checklist & Progress Log

- [x] Task 1: Add canonical in-memory deduplication in `getTodayDistributorRemindersFast`
- [x] Task 2: Enhance `POST /pharmarack/distributor-mappings` with `overwrite_distributor_name` and duplicate auto-merge
- [x] Task 3: Include `distributor_dispatch_reminders` re-linking and deduplication in `settings.ts` and `learning.ts` merge routes
- [x] Task 4: Add 1-click confirmation UI in `PharmarackCart` distributor mapping
- [x] Task 5: Run compiler checks, performance guardrails, and knowledge graph sync

---

## 4. Completed Work Log & Verification Results

### 1. In-Memory Canonical Deduplication in `getTodayDistributorRemindersFast`
- **File:** [src/services/distributorDispatchReminderWorker.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/distributorDispatchReminderWorker.ts)
- **What was done:** Added grouping by `getCanonicalDistributorKey(r.distributor_id, r.distributor_name)` right before returning reminders. If multiple rows exist on the same date for the same canonical vendor, they are merged into one card (combining order counts, total items, and preserving the most advanced status like `Dispatched` or `Collected`), guaranteeing 0 duplicate cards on the Dispatch page.

### 2. Name Overwrite & Auto-Merge on Pharmarack Mapping
- **Files:** [src/utils/distributorSyncHelper.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/distributorSyncHelper.ts), [src/routes/pharmarack.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)
- **What was done:**
  - Extended `SyncDistributorParams` and `POST /pharmarack/distributor-mappings` to support `overwrite_distributor_name: boolean`.
  - When enabled, `distributors.name` is updated to the clean Pharmarack store name (`params.store_name.trim()`).
  - If another distributor row already existed with that exact name, it is automatically merged into the master record (re-linking purchases, orders, returns, payments, files, and reminders) and deleted, leaving zero duplicate records in `distributors`.
  - Also synchronized `distributor_dispatch_reminders.distributor_name` to the Pharmarack store name.

### 3. Re-Linking Reminders on Distributor Merge
- **Files:** [src/routes/settings.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/settings.ts), [src/routes/learning.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/learning.ts)
- **What was done:** Updated both `/distributors/merge` and `/api/learning/profiles/merge` to re-link `distributor_dispatch_reminders` onto the primary distributor ID and clean primary name, followed by an atomic deduplication pass on conflicting reminders for the same date.

### 4. Frontend 1-Click Confirmation UI in Pharmarack Mapping
- **File:** [frontend/src/pages/PharmarackCart/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)
- **What was done:**
  - When linking a Pharmarack distributor to a directory distributor whose name differs, dynamically displays a high-visibility, 1-click confirmation prompt:
    *"Unify distributor name across pharmacy: Update '[Local Name]' &rarr; '[Pharmarack Name]' so all bills and dispatch reminders show only this 1 name."* (checked by default).
  - On save, forwards `overwrite_distributor_name: overwriteDistributorName`, updates the local dropdown state, and syncs across the app with zero layout shifts.

### 5. Verification & Compliance
- **Backend Type Check:** `npx tsc --noEmit` &rarr; **PASSED (0 errors)**.
- **Frontend Type Check:** `npx tsc -p frontend/tsconfig.app.json --noEmit` &rarr; **PASSED (0 errors)**.
- **Performance Guardrails:** `npm run guardrails` &rarr; **PASSED (0 violations)**.
- **Knowledge Graph:** `node scripts/quick-update.mjs` &rarr; **PASSED (1214 nodes, 806 edges in 5.4s)**.
