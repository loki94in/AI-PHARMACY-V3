# Implementation Plan: Fix 15s Timeout Cascade on Modal & Page Mount

## 1. Problem Statement & Root Cause Analysis
- **Symptom**: User encountered widespread `AxiosError: timeout of 15000ms exceeded` across multiple endpoints:
  - `LiveCartAddModal.tsx`: `/purchases/reconciliation`, `/pharmarack/cart`, `/pharmarack/session-status`, `/ignored-words`, `/pending-refills`.
  - `PharmarackCart/index.tsx`: `/orders`, `/purchases/batch-last-purchase`, `/automation/notifications/daily-summary`, `/settings`.
  - Diagnostics error logged: `[Verification Layer] Diagnostics: Backend & DB healthy — endpoint-specific issue on: ...`.
- **Root Cause**:
  1. `POST /purchases/batch-last-purchase`: Called on mount by `PharmarackCart/index.tsx` without debouncing for up to 100 medicine names. The handler in `src/routes/purchases.ts:1808` ran 100 sequential unindexed `LIKE '%name%'` full table scans across 40,000+ medicines with 4-table joins, locking SQLite and blocking the single-threaded Node event loop for 10-20 seconds.
  2. `GET /purchases/reconciliation`: Called on `LiveCartAddModal` open (`fetchReconOrders`). In `src/routes/purchases.ts:2124`, it loaded up to 200 emails and synchronously executed `emailService.extractOrderInfo` which called `medicineService.resolveMedicineNameMultiTier` for every single line of every email body. This ran hundreds of fuzzy SQL scans across 40,000 catalog entries during an interactive GET request, locking the event loop for 36 seconds.
  3. `cleanupProfileLocks` in `src/whatsappClient.ts:530`: Spawned a heavy `powershell -Command "Get-CimInstance Win32_Process ..."` child process with an 8-second timeout on WhatsApp client init or reconnect (`/messaging/qr`), consuming CPU and delaying requests.
  4. Cascading Axios Timeout: All concurrent requests from the frontend queued up behind the heavy SQLite table scans and attachment processing. After 15,000ms, Axios timed out. The error interceptor in `api.ts:145` caught the timeout (`ECONNABORTED`), tested `/api/verification/health` (which passed once the lock briefly freed), and logged the diagnostic warning.

---

## 2. Implementation Tasks

### Task 1: Optimize `POST /purchases/batch-last-purchase` (`src/routes/purchases.ts`)
- [x] **1.1 Fast Indexed Name Matching**: Replaced sequential unindexed `LIKE '%name%'` scans with fast indexed exact matches (`WHERE name = ? LIMIT 1`) using `idx_medicines_name_nocase`, falling back to indexed prefix match (`WHERE name LIKE 'prefix%' LIMIT 5`).
- [x] **1.2 Batch Query Execution**: Batched medicine ID lookups and recent purchase item queries instead of executing 100 sequential 4-table joins in a loop.
- [x] **1.3 In-Memory LRU/Micro-Cache**: Added a 60-second in-memory cache (`batchLastPurchaseCache`) with single-flight deduplication.

### Task 2: Optimize `GET /purchases/reconciliation` (`src/routes/purchases.ts`)
- [x] **2.1 Remove Synchronous Disk Attachment Parsing from GET Handler**: Removed all blocking calls to `emailService.extractOrderInfo` and synchronous attachment extraction from the interactive GET route.
- [x] **2.2 In-Memory Pre-Fetched Maps & Regex**: Pre-fetched distributor emails into an in-memory map (<1ms). Extracted invoice numbers and candidate medicines via instant regex and pure string cleaning without catalog fuzzy scans.
- [x] **2.3 Asynchronous SQLite Updates**: Converted all `UPDATE emails` database writes into background unawaited promises (`void db.run(...).catch(...)`).
- [x] **2.4 Enforce 50-Email Limit**: Reduced email scan limit from 200 to 50 items.
- [x] **2.5 In-Memory Response Cache**: Added a 15-second TTL in-memory cache (`reconciliationCache`) and in-flight promise deduplication (`inFlightReconciliationPromise`).

### Task 3: Debounce `fetchBatchLastPurchases` in `PharmarackCart/index.tsx`
- [x] **3.1 Debounce Mount Effect**: Added a 400ms debounce to the multi-dependency `useEffect` in `frontend/src/pages/PharmarackCart/index.tsx` so it does not fire multiple concurrent requests when candidate arrays initialize.
- [x] **3.2 In-Flight Deduplication**: Added `inFlightBatchNamesRef` to prevent duplicate concurrent network requests.

### Task 4: Optimize `cleanupProfileLocks` in `src/whatsappClient.ts`
- [x] **4.1 Lockfile Pre-Check**: Added pre-check for Chrome profile lockfiles (`SingletonLock`, `SingletonCookie`, `SingletonSocket`, `lockfile`). If no lockfiles exist, returns immediately in <1ms without spawning PowerShell.
- [x] **4.2 Fast Process Termination**: If lock files exist, PowerShell runs with non-blocking execution.

### Task 5: Modal Resilience in `LiveCartAddModal.tsx`
- [x] **5.1 Independent Settled Handlers**: Wrapped `fetchReconOrders` error handling to log warnings rather than throwing fatal modal-blocking errors.

### Task 6: Verification & Guardrails
- [x] **6.1 Backend Compilation**: `npx tsc --noEmit` passed with 0 errors.
- [x] **6.2 Frontend Compilation**: `npm --prefix frontend run build` (`tsc -b && vite build`) passed with 0 errors.
- [x] **6.3 Performance Guardrails**: `npm run guardrails` passed with 0 violations ("PASS — no guardrail violations. Speed architecture intact.").
- [x] **6.4 Auto-Knowledge Graph**: `node scripts/quick-update.mjs` completed in 5.3s (1,192 nodes, 798 edges).
- [x] **6.5 Endpoint Latency Benchmarking**: Verified concurrent execution of all 9 reported endpoints simultaneously on live backend.

---

## 3. Execution Log & Benchmark Metrics

### Endpoint Latency Comparison (9 Concurrent Requests)
| Endpoint | Method | Before Optimization | After Optimization (Cold) | After Optimization (Warm) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/purchases/reconciliation` | GET | **35,951 ms** (Timed out @ 15s) | 3,693 ms | **46 ms** | **200 OK** |
| `/api/purchases/batch-last-purchase` | POST (12 meds) | **2,400–12,000 ms** (Timed out @ 15s) | 3,701 ms | **85 ms** | **200 OK** |
| `/api/purchases/ignored-words` | GET | **Queued / Timed out** | 1,762 ms | **105 ms** | **200 OK** |
| `/api/pharmarack/session-status` | GET | **Queued / Timed out** | 4,940 ms | **102 ms** | **200 OK** |
| `/api/automation/notifications/daily-summary` | GET | **Queued / Timed out** | 1,756 ms | **102 ms** | **200 OK** |
| `/api/settings` | GET | **Queued / Timed out** | 1,953 ms | **312 ms** | **200 OK** |
| `/api/orders?status=PENDING` | GET | **Queued / Timed out** | 1,954 ms | **97 ms** | **200 OK** |
| `/api/messaging/qr` | GET | **8,000+ ms (CIM proc scan)** | 3,684 ms | **314 ms** | **200 OK** |
| `/api/purchases/price-history` | GET | **Queued / Timed out** | 2,308 ms | **311 ms** | **200 OK** |

### Summary of Results:
- **Zero 15,000ms timeouts**: All requests resolve concurrently in under 320ms when warm and under 4s on cold startup.
- **SQLite WAL concurrency preserved**: No blocking table scans or synchronous loop updates holding SQLite write locks.
- **Event loop unblocked**: Removed heavy CPU-bound disk attachment extraction and multi-tier fuzzy catalog loops from the HTTP request thread.
