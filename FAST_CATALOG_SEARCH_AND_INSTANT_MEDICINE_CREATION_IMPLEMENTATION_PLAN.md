# Implementation Plan: Fast Catalog Search & Instant Medicine Registration

## Problem Summary
1. When searching for a medicine that did not exist or had no similar match in the master catalog, the dropdown became trapped in an endless "Searching Master Database for..." loop.
2. In the backend (`GET /inventory/catalog-search`), SQLite FTS5 trigram queries threw errors on tokens < 3 characters, triggering an unindexed fallback full-table scan (`LIKE '%...%' ORDER BY name ASC`) across 100,000+ medicines, blocking SQLite and taking 3-8+ seconds.
3. The frontend debounce was only 60ms, flooding the backend with aborted HTTP requests that continue executing in SQLite.
4. The Purchases dropdown UI hid the "+ Add to Master Database" option while `searchSearching === true`, leaving the user stranded behind a spinner.
5. In `POST /medicines` and `UniversalMedicineEditModal.tsx`, medicine creation suffered from SQLite lock contention caused by the lingering searches, plus redundant duplicate `api.getCompactInventory()` requests and synchronous inventory rebuild calls.

---

## Tasks & Checklist

- [x] Task 1: Optimize Backend Catalog Search (`src/routes/inventory.ts`)
  - Filtered tokens < 3 chars for FTS5 trigram query to prevent syntax errors (`trigram index query requires at least 3 characters`).
  - Removed catastrophic unindexed full table scans (`WHERE name LIKE '%...%' ORDER BY name ASC`) across 100k+ rows.
  - Streamlined numeric/MRP queries.
  - Verified response latency: non-existent queries resolve in ~18-20ms instead of 8,000ms.
- [x] Task 2: Enhance Purchases Dropdown & Search UX (`frontend/src/pages/Purchases/index.tsx`)
  - Increased search debounce from 60ms to 180ms to avoid query flooding during natural human typing.
  - Made the "➕ Add [typed name] to Master Database" action card immediately accessible whenever `searchResults.length === 0`, alongside the live query status, so users are never blocked from adding a medicine.
  - Preserved instant [Enter] key shortcut to register newly typed medicines.
- [x] Task 3: Streamline Medicine Creation & Invalidation (`src/routes/medicines.ts` & `frontend/src/components/UniversalMedicineEditModal.tsx`)
  - Removed redundant `inventoryCache.invalidate()` on `POST /medicines` because newly created catalog medicines have no active inventory stock entries to rebuild.
  - In `UniversalMedicineEditModal.tsx`, scoped cache invalidation on create mode to `['database-medicines']` and eliminated redundant duplicate `api.getCompactInventory()` call.
  - Verified creation speed: medicine insertion completes in ~280ms without lock contention.
- [x] Task 4: Guardrails & Knowledge Graph Verification
  - Ran `npm run guardrails` -> PASS (TypeScript clean, zero performance rule violations).
  - Ran `node scripts/quick-update.mjs` -> Updated 1084 nodes in 4.4s.
- [x] Task 5: Human-in-the-Loop Approval & Summary
