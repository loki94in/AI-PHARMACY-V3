# Implementation Plan — Safely Fix Database Indexing and Verified "Not Found" Bugs

**Target Repository**: AI-PHARMACY-V3  
**Status**: COMPLETED  
**Governing Documents**: `AGENT_BUG_FIX_RULEBOOK.md`, `AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`, `BACKEND SCHEMA SAFETY.md`

---

## 1. Executive Summary of Audit Findings & Results

| Category | Component / Area | Status | Verified Root Cause & Fix |
|---|---|---|---|
| **FTS5 Trigram Tokenizer** | `/inventory/catalog-search` & `src/services/productNameFilterService.ts` | **RESOLVED & VERIFIED** | `medicines_fts` with `tokenize='trigram'` ignores tokens $< 3$ characters. Fixed by adding Pass 2c bounded word-boundary fallback (`D3 %`, `% D3 %`, `% D3`) for short tokens when earlier passes return $< 15$ matches, preventing substring pollution (`IND3X`) and full table scans. |
| **OCR Trigram Safety** | `src/services/productNameFilterService.ts` | **RESOLVED & VERIFIED** | When all query tokens are $< 3$ chars, FTS5 `MATCH` threw syntax/empty-token errors. Fixed by cleanly bypassing FTS5 (`fts5Used = false`) and proceeding to exact, alias, and fuzzy matching. |
| **Customer Search Performance** | `/crm/patients` & POS customer lookup | **RESOLVED & VERIFIED** | Uncollated index forced full table scans on prefix matching. Added `COLLATE NOCASE` index on `customers(name COLLATE NOCASE)`. Query plan transitioned from `SCAN customers` (4ms) to `SEARCH customers USING INDEX idx_customers_name_nocase` (0ms). |
| **Medicine Alternatives Scan** | `GET /medicines/:id/quick-details` (`src/routes/medicines.ts`) | **RESOLVED & VERIFIED** | `LOWER(m.generic_name) = LOWER(?)` invalidated indexes, triggering full scans across 286,501 rows. Replaced with `COLLATE NOCASE` equality and added `idx_medicines_generic_name_nocase` and `idx_medicines_api_ref_nocase`. Query plan transitioned from `SCAN m` to `SEARCH m USING INDEX` (0ms). |
| **Database Index Declarations** | `src/database.ts` (Fast Boot vs Migrations) | **RESOLVED & VERIFIED** | Redundant duplicate index declarations within the single migration block consolidated. Fast Boot (lines 1108–1150) and schema v84 preserved. |

---

## 2. Verified Before & After Query Plans

### Task 1: Short-Token Search Query Plan (`src/routes/inventory.ts`)
- **Query**: Multi-token name prefix search (`AARCAL%D3%`)
  - **Plan**: `SEARCH medicines USING COVERING INDEX idx_medicines_name_nocase (name>? AND name<?)`
  - **Execution Time**: $< 3\text{ ms}`
  - **Fallback**: Bounded word boundary `ORDER BY name ASC LIMIT 20` avoids scanning non-matching prefixes.

### Task 3: Customer Search Query Plan (`customers` table)
- **Before**:
  ```sql
  EXPLAIN QUERY PLAN SELECT id, name, phone FROM customers WHERE name LIKE 'A%' LIMIT 20;
  -- Output: SCAN customers (~4 ms on large datasets)
  ```
- **After** (with `idx_customers_name_nocase`):
  ```sql
  EXPLAIN QUERY PLAN SELECT id, name, phone FROM customers WHERE name LIKE 'A%' COLLATE NOCASE LIMIT 20;
  -- Output: SEARCH customers USING INDEX idx_customers_name_nocase (name>? AND name<?) (~0 ms)
  ```

### Task 4: Alternatives Lookup Query Plan (`medicines` table)
- **Before**:
  ```sql
  EXPLAIN QUERY PLAN SELECT id, name FROM medicines WHERE LOWER(generic_name) = LOWER('paracetamol');
  -- Output: SCAN medicines (Full table scan over 286,501 rows)
  ```
- **After** (with `idx_medicines_generic_name_nocase`):
  ```sql
  EXPLAIN QUERY PLAN SELECT id, name FROM medicines WHERE generic_name = 'paracetamol' COLLATE NOCASE;
  -- Output: SEARCH medicines USING INDEX idx_medicines_generic_name_nocase (generic_name=?) (~0 ms)
  ```

---

## 3. Implementation Checklist & Verification Log

- [x] **Task 1: Short-Token Search Fallback** (`src/routes/inventory.ts`)
  - *Completed*: Added Pass 2c bounded word-boundary query (`${token} %`, `% ${token} %`, `% ${token}`) triggered when earlier passes return $< 15$ items.
  - *Verification*: Tested multi-token `AARCAL D3`, standalone `D3`, `B6`, `CV`, `H1`, and verified prevention of word-boundary pollution (`IND3X` / `WORD345`).
- [x] **Task 2: Safe OCR Short-Token Bypass** (`src/services/productNameFilterService.ts`)
  - *Completed*: Query builder checks `cleanedWords.length === 0`; sets `fts5Used = false` cleanly and falls through to exact/alias/fuzzy matching without throwing SQLite trigram errors.
  - *Verification*: Verified with test suite asserting no errors on 1-2 letter OCR inputs.
- [x] **Task 3: Customer Search Query Plan & Index Alignment** (`src/database.ts`)
  - *Completed*: Added `idx_customers_name_nocase` to both Fast Boot and Migration DDL paths.
  - *Verification*: Verified prefix index scan transition and full preservation of CRM search semantics.
- [x] **Task 4: Alternatives Query Optimization** (`src/routes/medicines.ts` & `src/database.ts`)
  - *Completed*: Replaced `LOWER()` function wrappers with `COLLATE NOCASE` matching and added `idx_medicines_generic_name_nocase` + `idx_medicines_api_ref_nocase`.
  - *Verification*: Tested NULL handling, empty string guards, case insensitivity, and verified 0ms index scan.
- [x] **Task 5: Consolidate Repeated Index Declarations** (`src/database.ts`)
  - *Completed*: Removed intra-block duplicate declarations (lines 2165–2168, 2372–2374, 3631–3632) in favor of their consolidated equivalents. Kept Fast Boot block intact.
  - *Verification*: Fresh database initialization (`ensureSchema`) and fast boot verified on isolated test DBs.
- [x] **Task 6: Regression Testing Suite & Guardrails**
  - *Completed*: Ran all targeted test suites:
    - `tests/shortTokenSearch.test.ts`: PASS (6/6 tests)
    - `tests/ftsRepair.test.ts`: PASS (5/5 tests)
    - `tests/indexingFunctionalFixes.test.ts`: PASS (5/5 tests)
    - Total: 16/16 tests passing across 3 test suites.
  - *Guardrails*: `npm run guardrails` passed with Exit Code 0 (`tsc --noEmit` OK, database schema & integrity OK, 0 performance violations).
  - *Knowledge Graph*: Updated via `node scripts/quick-update.mjs` (1277 nodes, 866 edges).

---

## 4. Verification and Rollback Guidelines

- **Schema Version**: Preserved at v84 (`TARGET_SCHEMA_VERSION = 84`). No destructive migrations or version bumps.
- **Rollback Procedure**: In the unlikely event of rollback:
  `git checkout HEAD~1` (or revert commit).
  Indexes created with `IF NOT EXISTS` are backward-compatible with all earlier versions of the application.
