# Implementation Plan: Fix SQLITE_ERROR no such column m.ptr in distributor-medicines Route

## Problem Statement
When fetching distributor medicines via `GET /api/pharmarack/distributor-medicines/:storeId`, the server threw:
```text
Error fetching distributor medicines: [Error: SQLITE_ERROR: no such column: m.ptr]
```
### Root Cause:
In [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts#L4842):
The query executed:
```sql
COALESCE(p.ptr, m.ptr, 0) AS ptr
```
However, the `medicines` table in SQLite does not possess a column named `ptr`. The corresponding price columns in `medicines` are `rate` and `last_purchase_ptr`. Additionally, `medicine_distributor_links` has `rate`.

---

## Proposed Changes

### 1. Fix SQL Query in `src/routes/pharmarack.ts`
- Replace `COALESCE(p.ptr, m.ptr, 0) AS ptr` with:
  ```sql
  COALESCE(p.ptr, l.rate, m.last_purchase_ptr, m.rate, 0) AS ptr
  ```
- Replace `COALESCE(p.mrp, m.mrp, 0) AS mrp` with:
  ```sql
  COALESCE(p.mrp, l.mrp, m.mrp, 0) AS mrp
  ```

---

## Verification Plan
1. **Live Query Verification**:
   - Query `GET /api/pharmarack/distributor-medicines/2940` (and other distributor IDs).
   - Verify it returns `200 OK` with items and zero SQLite errors in logs.
2. **Guardrails & Knowledge Graph**:
   - Run `npm run guardrails` (Clean TypeScript compilation `tsc --noEmit`, Database schema & integrity `OK`, 0 violations).
   - Run `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracking

- [x] **Task 1: Fix SQL column reference in `src/routes/pharmarack.ts`**
  - Replaced invalid `m.ptr` with `COALESCE(p.ptr, l.rate, m.last_purchase_ptr, m.rate, 0) AS ptr` and `COALESCE(p.mrp, l.mrp, m.mrp, 0) AS mrp` in both the primary query and union query of `GET /api/pharmarack/distributor-medicines/:storeId`.
- [x] **Task 2: Test `GET /api/pharmarack/distributor-medicines/:storeId` live**
  - Tested `http://127.0.0.1:5174/api/pharmarack/distributor-medicines/2940` via live HTTP request. Received HTTP 200 with 75 mapped items and zero SQLite errors.
- [x] **Task 3: Run Guardrails & Auto-Update Knowledge Graph**
  - Ran `npm run guardrails` — clean TypeScript compilation (`tsc --noEmit`), DB schema integrity OK, PASS with 0 violations.
  - Ran `node scripts/quick-update.mjs` — knowledge graph synchronized successfully.
