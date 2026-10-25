# Implementation Plan: Record Schemes for Cart-Added Medicines & Display in Reorder Hub

## Context & User Goal
1. **Focus Strictly on Added Medicines**: Only medicines that are actually added to the cart will be stored in `pharmarack_distributor_products`. No raw search queries or dropdown clicks are saved.
2. **Zero Duplicates per Distributor**: The database uniquely identifies products by `(store_id, product_code)`. Adding the same medicine for the same distributor updates the existing record with the latest rate, MRP, and scheme deal without creating duplicate rows.
3. **Capture Distributor Schemes**: Deals such as `10+1`, `5+1`, or `10%` (`item.scheme` / `item.Scheme`) must be recorded when medicines are added to the cart and returned in the Reorder Hub.
4. **Display Scheme in Reorder Hub**: When a medicine is viewed in Reorder Hub ("All Items" and "Recent & Cart Items"), it displays a clear `🎁 Scheme: {item.scheme}` badge so the user sees the distributor deal immediately when reordering.

---

## Detailed Implementation Tasks

### Task 1: Update Schema in `src/database.ts`
- Ensure column `scheme TEXT DEFAULT NULL` on `pharmarack_distributor_products` via `ensureColumns` in `ensureRefillCartLinkSchema` (runs on both fast-boot and full DDL paths).
- Update the `CREATE TABLE IF NOT EXISTS pharmarack_distributor_products` DDL statement to include `scheme TEXT DEFAULT NULL`.

### Task 2: Capture `scheme` in `upsertDistributorProducts` (`src/routes/pharmarack.ts`)
- Extract `item.scheme || item.Scheme || item.ProductScheme`.
- Include `scheme` in the SQL `INSERT INTO pharmarack_distributor_products` statement and `ON CONFLICT ... DO UPDATE SET scheme = CASE WHEN excluded.scheme != '' THEN excluded.scheme ELSE pharmarack_distributor_products.scheme END`.

### Task 3: Expose `scheme` in `GET /api/pharmarack/reorder-recent` (`src/routes/pharmarack.ts`)
- In `reorder-recent`, return `scheme` for both placed orders (`item.scheme || item.Scheme || ''`) and cart-added products (`p.scheme || ''`).

### Task 4: Update Frontend Types & UI in `PharmarackCart/index.tsx`
- Add `scheme?: string` to `ReorderRecentItem` in `frontend/src/types/api.ts`.
- In `frontend/src/pages/PharmarackCart/index.tsx`, render an emerald `🎁 Scheme: {item.scheme}` badge on the card in both the unified "All Items" view and the "Recent & Cart Items" subtab.

### Task 5: Verification, Performance Guardrails & Knowledge Graph
- Run `npm run guardrails` (`tsc --noEmit` and performance checks).
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## Verification Plan

### Automated Checks
```bash
npm run guardrails
node scripts/quick-update.mjs
```

### Manual / Component Verification
1. Verify database schema:
   - Check `pharmarack_distributor_products` has the `scheme` column.
2. Verify cart addition with scheme:
   - When an item with a scheme (e.g. `10+1`) is added to the cart, verify `upsertDistributorProducts` writes the scheme value into the database.
   - For the same distributor, verify re-adding updates the existing record with no duplicate rows.
3. Verify Reorder Hub:
   - Check that items with schemes render the `🎁 Scheme: 10+1` badge on their card.

---

## Task Progress & Completion Status
- [x] Task 1: Update Schema in `src/database.ts`
  - *Completed*: Added `scheme TEXT DEFAULT NULL` to `CREATE TABLE IF NOT EXISTS pharmarack_distributor_products` and added `await ensureColumns(db, 'pharmarack_distributor_products', { scheme: 'TEXT DEFAULT NULL' })` inside `ensureRefillCartLinkSchema` so both boot paths and existing databases safely get the scheme column without data loss.
- [x] Task 2: Capture `scheme` in `upsertDistributorProducts` (`src/routes/pharmarack.ts`)
  - *Completed*: Extracted `item.scheme || item.Scheme || item.ProductScheme` and included it in the `INSERT` and `ON CONFLICT(store_id, product_code) DO UPDATE SET scheme = CASE WHEN excluded.scheme != '' THEN excluded.scheme ELSE pharmarack_distributor_products.scheme END`, ensuring zero duplicates per distributor.
- [x] Task 3: Expose `scheme` in `GET /api/pharmarack/reorder-recent` (`src/routes/pharmarack.ts`)
  - *Completed*: Returned `scheme` for both placed orders (`item.scheme`) and distributor cart-added products (`p.scheme`).
- [x] Task 4: Update Frontend Types & UI in `PharmarackCart/index.tsx`
  - *Completed*: Added `scheme?: string` to `ReorderRecentItem` in `frontend/src/types/api.ts` and rendered an emerald `🎁 {item.scheme}` badge on the cards in both the unified "All Items" view and the "Recent & Cart Items" subtab.
- [x] Task 5: Verification, Performance Guardrails & Knowledge Graph
  - *Completed*: `npm run guardrails` passed with 0 errors (`tsc --noEmit` clean, database schema check clean) and `node scripts/quick-update.mjs` synchronized all 1345 nodes in the knowledge graph.