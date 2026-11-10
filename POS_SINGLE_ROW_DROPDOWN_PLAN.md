# POS Single-Row Medicine Dropdown Plan

## Goal
Ensure the POS search dropdown (both top search bar and inline table-row search) always combines all non-expired, in-stock batches of the same medicine into **one single row per medicine** — never splitting rows by batch, MRP, rate, or expiry date.

## Root Cause
In `frontend/src/pages/POS/index.tsx`, `filterLocalInventory` previously keyed matches by `${normKey(name)}_mrp_${mrpKey}` inside separate per-tier maps (`tier1Map`–`tier5Map`). Any MRP difference (even ₹0.01) caused batches of the same medicine to appear as multiple rows in the dropdown.

## Design
1. Extract pure `filterLocalInventory` into `frontend/src/utils/posSearchFilter.ts` (zero `any`, zero browser-only runtime imports).
2. Group solely by normalized medicine name (`normKey`) falling back to `medicine_id` / `inventory_id` — no MRP/batch/rate/expiry suffix.
3. Merge across tiers using a single `Map<string, { tier, item }>` (keeping `Math.min` tier, summing `quantity` / `stock_qty` / `loose_quantity`, and keeping the FEFO earliest-expiry batch fields including `sell_price`).
4. Update `frontend/src/pages/POS/index.tsx` to delegate `filterLocalInventory` to the shared utility.
5. Add unit tests in `tests/posSearchFilter.test.ts` and register in `jest.config.js`.
6. Verify with Jest tests, frontend build (`npm run build:client`), `npm run guardrails`, and `node scripts/quick-update.mjs`.

## Tasks
- [x] Create `frontend/src/utils/posSearchFilter.ts` with single-row medicine grouping across batches/MRPs/tiers (removed `_mrp_` key suffix, merged across tiers via `matchMap`, summed strip/loose stock, kept earliest-expiry FEFO batch fields including `sell_price`)
- [x] Wire `frontend/src/pages/POS/index.tsx` to use `filterLocalInventory` from `frontend/src/utils/posSearchFilter.ts` and document contract in `frontend/AGENTS.md`
- [x] Add `tests/posSearchFilter.test.ts` and register in `jest.config.js`
- [x] Run Jest tests (`tests/posSearchFilter.test.ts` + `tests/posBatchAllocator.test.ts`: 2 suites, 8 tests passed), ESLint on `frontend/src/utils/posSearchFilter.ts`, `npm run build:client` (`tsc -b && vite build`), `npm run guardrails`, and `node scripts/quick-update.mjs`
