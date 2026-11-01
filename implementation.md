# Implementation Plan: Surgical App Hardening — Background Mutex Hygiene, Matcher Parity & Stock Pool Safety

## Problem Statement
Following the EGM architectural review (`consolidated_review_report.md`), three critical areas of technical debt and breaking points were resolved surgically:
1. **Background Worker Concurrency**: `stockCalculatorWorker.ts` and `autoMatchWorker.ts` executed database updates without wrapping them in `dbManager.runWithPriority('BACKGROUND', ...)` and used oversized write chunks (up to 200 rows), which could delay high-priority counter POS checkout transactions.
2. **Order Matcher Tokenizer Parity**: Divergence between `src/utils/orderNameMatcher.ts` (backend) and `frontend/src/utils/orderFuzzyMatcher.ts` (frontend) in stop words (`10`, `20`, `30` stripped as stop words on frontend, but preserved as strength tokens on backend) and glued strength unit normalization (`40mg` -> `40`).
3. **Dispensing & Verification Safety**: Ensure loose unit dispensing validation in POS strictly requires solid oral dosage form verification (`TABLET`, `CAPSULE`, `STRIP`) without blocking discrete single-unit items (`pack_size = 1` for syrups, drops, inhalers, surgicals).

---

## Architecture Decisions
1. **Background Mutex Hygiene**:
   - Wrapped `stockCalculatorWorker.ts` recalculation cycles and `autoMatchWorker.ts` in `dbManager.runWithPriority('BACKGROUND', async () => { ... })`.
   - Reduced write chunk sizes in `stockCalculatorWorker.ts` from 200 to 25 items, with an asynchronous event-loop yield (`await new Promise(r => setImmediate(r))`) between chunks so waiting `VIP` transactions (POS sales) acquire the write lock with `< 50ms` latency.
   - Preserved `busy_timeout = 30000;` in `src/database/connection.ts`.
2. **Order Matcher Tokenizer Parity**:
   - Harmonized `PACKAGING_STOP_WORDS` and token extraction across `src/utils/orderNameMatcher.ts` and `frontend/src/utils/orderFuzzyMatcher.ts`.
   - Implemented identical `normalizeToken` (collapsing `40mg` -> `40`) in both matchers.
   - Retained 85 pts max for title match, 15 pts max for distributor link, and 75 pts match threshold.
   - Added unit test verification in `tests/matcherParity.test.ts`.
3. **Dispensing Verification**:
   - In `src/routes/sales.ts`, verified that loose unit sales requiring `pack_size` are strictly triggered only when `soldLoose > 0`. Non-loose unit sales with `pack_size = 1` (syrups, drops, inhalers) proceed cleanly without obstruction.

---

## Files Modified
1. `src/worker/stockCalculatorWorker.ts`:
   - Wrapped calculations in `dbManager.runWithPriority('BACKGROUND')`.
   - Chunked inserts into batches of 25 with `setImmediate` yields.
2. `src/worker/autoMatchWorker.ts`:
   - Wrapped `runScan()` in `dbManager.runWithPriority('BACKGROUND')`.
3. `frontend/src/utils/orderFuzzyMatcher.ts`:
   - Aligned token normalization with `src/utils/orderNameMatcher.ts` (`normalizeToken`, harmonized packaging stop words).
4. `tests/matcherParity.test.ts`:
   - Created parity test cases asserting identical matching behavior for frontend and backend tokenizers.
5. `jest.config.js`:
   - Added `tests/matcherParity.test.ts` to `testMatch`.

---

## Tasks & Progress Tracking

- [x] **Task 1: Background Worker Mutex Hygiene (`stockCalculatorWorker.ts`, `autoMatchWorker.ts`)**
  - Wrapped `recalculateTargetedStockMetrics` and `recalculateStockLimits` in `dbManager.runWithPriority('BACKGROUND', ...)`.
  - Reduced batch insertion chunks from 200 to 25 rows and added `await new Promise(r => setImmediate(r))` between batches.
  - Wrapped `autoMatchWorker.runScan()` in `dbManager.runWithPriority('BACKGROUND', ...)`.

- [x] **Task 2: Harmonize Frontend & Backend Order Matcher Tokenizers**
  - Updated `frontend/src/utils/orderFuzzyMatcher.ts` to include `normalizeToken` (collapsing `40mg` -> `40`).
  - Removed strength numbers (`10`, `15`, `20`, `30`, `50`, `100`, etc.) from packaging stop words so active dosage strengths are preserved during scoring.

- [x] **Task 3: Create & Run Parity Unit Tests (`tests/matcherParity.test.ts`)**
  - Created `tests/matcherParity.test.ts` testing strength unit collapsing, number preservation, exact and high-similarity match scoring (>= 75), and mismatch rejection (< 75).
  - Executed tests via Jest: 4 passed out of 4 tests (100% PASS).

- [x] **Task 4: Run Guardrails and Synchronize Knowledge Graph**
  - Ran `npx tsc --noEmit` — clean TypeScript compilation (0 errors).
  - Ran `npm run guardrails` — PASS with 0 violations.
  - Ran `node scripts/quick-update.mjs` — knowledge graph synchronized successfully.
