# Implementation Plan: Fix SQLite `no such column: preferred_language` in Special Orders

## 1. Problem Statement & User Intent
When creating special orders (either via Quick Order Modal or batch creation in `/api/orders`), the request fails with:
`Failed to log order request: Failed to create special orders: SQLITE_ERROR: no such column: preferred_language`

This completely blocks special order creation when WhatsApp notification dispatch is active.

---

## 2. Root Cause Analysis
1. In `src/routes/orders.ts` (lines 216, 383, 800), `db.get('SELECT preferred_language, language FROM customers WHERE phone LIKE ? LIMIT 1', ...)` was added in commit `f5e1836e`.
2. However, the `preferred_language` column was never added to the `customers` table in `src/database.ts` (neither in `CREATE TABLE customers`, nor in `ensureColumns` on the fast-boot path, nor in the migration array).
3. Because SQLite performs strict column checks, attempting to select `preferred_language` from `customers` causes an immediate `SQLITE_ERROR: no such column: preferred_language` exception.
4. Because this query is run inside `router.post('/batch')` and `router.post('/')` without a `.catch()`, the exception bubbles up and causes the endpoint to fail with HTTP 500: `Failed to create special orders: SQLITE_ERROR: no such column: preferred_language`.

---

## 3. Proposed Solution & Architecture (Following BACKEND SCHEMA SAFETY.md)

### A. Database Schema Update (`src/database.ts`)
1. **Schema Version**: Bump `CURRENT_SCHEMA_VERSION` from 78 to 79.
2. **Fast-Boot Path**: Add `preferred_language: "TEXT DEFAULT 'mr'"` to `ensureColumns(db, 'customers', ...)` in `ensureSchema()`.
3. **Full DDL Table Definition**: Add `preferred_language TEXT DEFAULT 'mr'` to `CREATE TABLE IF NOT EXISTS customers`.
4. **Migration Array**: Add `['customers', 'preferred_language', "ALTER TABLE customers ADD COLUMN preferred_language TEXT DEFAULT 'mr'"]` to the migration array in `ensureSchema()`.

### B. Route Query Safety (`src/routes/orders.ts`)
1. In `router.post('/batch')` (line 216), `router.post('/')` (line 383), and `router.post('/:id/resend-booking')` (line 800):
   Change:
   `await db.get('SELECT preferred_language, language FROM customers WHERE phone LIKE ? LIMIT 1', ...)`
   To:
   `await db.get('SELECT * FROM customers WHERE phone LIKE ? LIMIT 1', ...).catch(() => null)`
2. This ensures that language resolution never blocks order creation even in corner cases.

---

## 4. Verification Plan
1. **TypeScript & Guardrails**:
   - Run `npx tsc --noEmit` and `npm run guardrails` (exit code 0).
2. **Database Schema Verification**:
   - Run a node test script checking that `PRAGMA table_info(customers)` includes `preferred_language`.
3. **Knowledge Graph**:
   - Run `node scripts/quick-update.mjs`.

---

## 5. Completed Tasks Log
- [x] Task 1: Update `src/database.ts` with `preferred_language` on `customers` across all boot paths and bump schema version to 79.
  - *Details*: Added `preferred_language TEXT DEFAULT 'mr'` to `CREATE TABLE IF NOT EXISTS customers`, added to `ensureColumns` on fast-boot path, registered in the schema migration array, and bumped `CURRENT_SCHEMA_VERSION` from 78 to 79. Also verified and migrated both `app.db` and `app.dev.db`.
- [x] Task 2: Make customer language lookup resilient in `src/routes/orders.ts`.
  - *Details*: Replaced rigid `SELECT preferred_language, language` with safe `SELECT * FROM customers WHERE phone LIKE ? LIMIT 1` with a `.catch(() => null)` fallback in `/api/orders/batch`, `/api/orders` (single), and `/api/orders/:id/resend-booking` so missing columns or lookup issues never block order transactions.
- [x] Task 3: Verify with database schema test, run `npm run guardrails`, and update knowledge graph.
  - *Details*: Confirmed `preferred_language` column exists in all database files, verified TypeScript compilation (`tsc --noEmit`), passed performance guardrails (`npm run guardrails` exit code 0), and synchronized knowledge graph via `node scripts/quick-update.mjs`.
