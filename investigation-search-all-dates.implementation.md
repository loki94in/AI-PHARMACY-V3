# Investigation Search Full-History Date Bypass — Implementation Plan

## Problem Summary
On the Investigation page (`frontend/src/pages/Investigation/index.tsx`), `usePersistedDateRange` sets a default 15-day date window (`defaultFrom: getNDaysAgoString(15)`, `defaultTo: getTodayString()`). Whenever a user searched for a medicine, batch, invoice, or party, the page still passed that default 15-day `dateFrom`/`dateTo` range to `GET /api/investigation/timeline`, hiding older purchase bills and sales outside the last 15 days unless the user manually changed the calendar dates.

## Goal
- Keep the default 15-day calendar date filter unchanged when browsing Investigation without a search query.
- When any search filter (`Medicine`, `Batch`, `Invoice / Ref`, or `Party / Client`) is active and the date filter is still on its default 15-day range, omit `dateFrom` and `dateTo` from `serverFilters` so Investigation returns the complete matching ledger history from the first purchase bill to the latest sale.
- If the user manually selects a custom date range (`From` or `To` differs from default), continue honoring that custom range.

## Tasks
- [x] **Task 1**: Update `frontend/src/pages/Investigation/index.tsx` to detect `hasTextSearch` (from the debounced text filters) and `isDefaultDateRange`, omitting `dateFrom`/`dateTo` in `serverFilters` when `hasTextSearch && isDefaultDateRange`.
  - Completed: Added `hasTextSearch`, `isDefaultDateRange`, `effectiveDateFrom`, and `effectiveDateTo` in `frontend/src/pages/Investigation/index.tsx` so searches with untouched default dates query full timeline history without altering the default calendar dates.
- [x] **Task 2**: Verify existing `tests/investigation.test.ts`, run `npm run guardrails`, `npm run build --prefix frontend`, and `node scripts/quick-update.mjs`.
  - Completed: `tests/investigation.test.ts` (6/6 passed with `--testTimeout=30000`), `npm run guardrails` (exit 0), `node scripts/quick-update.mjs` (exit 0 across 1523 nodes).
