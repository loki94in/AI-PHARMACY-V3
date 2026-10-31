# Implementation Plan: Additional Pharmarack Cart Redundant Query & Scan Eliminations

## Objective
Eliminate all remaining redundant scans, background polls, duplicate route-change fetches, and unnecessary CRM lookups:
1. Stop WhatsApp queue scanning on quantity changes and checkbox clicks; scan and build messages only when placing/dispatching orders.
2. Query distributor contacts, mappings, and delivery boys once per session into module memory, updating only when a contact is edited or saved.
3. Lazy-load secondary "Req" and "Refills" tabs so CRM special orders, refills, and POS receipts are only queried when viewing those tabs.
4. Remove duplicate `GET /pharmarack/cart` from `Layout.tsx` on navigation to `/pharmarack-cart`, and skip redundant remote session probes when the live cart loads successfully.
5. Remove redundant mount POST pacing writes in `PharmarackCartCalendar.tsx`.

---

## Code Changes Implemented

### 1. `frontend/src/pages/PharmarackCart/index.tsx`
- **WhatsApp queue scanning**: Removed `distributors` from `syncQueueStatus` effect dependencies using `distributorsRef.current`. Queue status only checks on mount, window focus, and when SSE events arrive (`sse-wa-queue-updated`). Zero checks during quantity adjustments or checkbox toggles.
- **Contact data caching**: Added module-level caches `cachedSavedDistributorsList`, `cachedDistributorMappings`, `cachedDeliveryBoysList`, and `cachedStoreInfo`. `fetchSavedDistributors`, `fetchDistributorMappings`, `fetchDeliveryBoys`, and `fetchStoreInfo` read from memory and only hit SQLite on cold start or when a phone number/setting is edited (`force = true`).
- **Lazy CRM tabs**: Replaced automatic 300ms `showPendingTier` fetch with a tab guard: `fetchPendingOrders()`, `fetchPendingRefills()`, and `fetchTodaySoldMedicines()` only run when `currentTab === 'requests' || currentTab === 'refills' || currentTab === 'reorder'`.
- **Skip redundant session probe**: Removed duplicate mount/return `checkSession()` probes. When `fetchCart` loads the live cart, `sessionStatus` is marked active directly.

### 2. `frontend/src/components/Layout.tsx`
- Removed the route-change listener that called `loadCartData()` on navigation to `/pharmarack-cart`, cutting duplicate cart queries on route entry.

### 3. `frontend/src/components/PharmarackCartCalendar.tsx`
- Removed redundant `api.updateWhatsAppPacingConfig` POST write from mount.

---

## Tasks & Progress Tracker

- [x] Task 1: Disconnect `syncQueueStatus` from `distributors` dependency in `PharmarackCart/index.tsx`.
  - **Completed**: Used `distributorsRef.current` and scoped effect dependencies to `[pageActive]`. Qty changes and checkbox clicks no longer trigger WhatsApp queue scans.
- [x] Task 2: Module-level cache contacts and delivery boys in `PharmarackCart/index.tsx`.
  - **Completed**: Cached saved distributors, mappings, delivery boys, and store info in module memory; re-queries run only when a number is explicitly saved or edited.
- [x] Task 3: Lazy-load "Req" and "Refills" tab data in `PharmarackCart/index.tsx`.
  - **Completed**: CRM special orders, patient refills, and POS sold items only query when viewing secondary tabs, keeping cart open instant.
- [x] Task 4: Remove duplicate route fetch in `Layout.tsx` and duplicate mount write in `PharmarackCartCalendar.tsx`.
  - **Completed**: Removed redundant route listener from `Layout.tsx` and redundant POST pacing write from `PharmarackCartCalendar.tsx`.
- [x] Task 5: Run TypeScript compilation, performance guardrails, and knowledge graph update.
  - **Completed**: `npx tsc --noEmit` passed with 0 errors; `npm run guardrails` passed; `node scripts/quick-update.mjs` synchronized knowledge graph.
