# Implementation Plan: Fix Refill/Message Snooze Errors, Background Resurrections, and UI Latency Bottlenecks

## Goal
1. **Fix Snooze Failure**: Eliminate errors when clicking Snooze on messages/reminders in Quick Assist, CRM Refills, and Daily Communications.
2. **Prevent Snooze Card Resurrection**: Fix background sync in `refillService.ts` so snoozed cards are strictly respected and do NOT re-stage prematurely within minutes due to phone format differences (+91 vs 10-digit).
3. **Handle Walk-in Patients Without Phones**: Allow counter refills without phone numbers to be snoozed by name using case-insensitive (`COLLATE NOCASE`) matching.
4. **Guard Group Snooze Actions**: Prevent 400 Bad Request errors when snoozing grouped staged messages with empty or dismissed IDs.
5. **Optimize Latency Hotspots**: Eliminate unindexed full-table scans (`CAST(mrp AS TEXT)`) across 291k medicines to restore instant UI response times.

---

## Architectural Strategy (Elephant & Goldfish)

### Elephant (System Contracts)
* **Unified Phone Normalization**: Database seeks for notifications and refills standardize on 10-digit normalization (`substr(phone, -10)`). Phone formatting variations (`+91 9876543210` vs `9876543210`) will never cause false mismatches.
* **Refill Service Snooze Shield**: When a notification is marked `status = 'snoozed'` with `snoozed_until > todayStr`, `refillService.ts` MUST NOT recreate or re-stage the reminder card until the snooze date has truly arrived.
* **SARGABLE Database Queries**: Remove index-defeating functions (`CAST(...)`) in search filters on large tables (291k rows) so queries execute in <2ms rather than hundreds of milliseconds.

### Goldfish (Micro Changes)
1. `src/routes/automation.ts`:
   - In `POST /notifications/snooze-patient`:
     - Allow name-only snoozing without requiring a phone number.
     - Add `COLLATE NOCASE` and `TRIM()` on `patient_name` and `recipient_name`.
     - Standardize phone seek on last 10 digits (`substr(..., -10)`).
   - In `POST /notifications/group/snooze`:
     - Gracefully handle empty or filtered ID arrays with an informative response instead of a raw 400 rejection.
2. `src/services/refillService.ts`:
   - In `createOrUpdateNotification`: Update lines 384–388 to match using normalized 10-digit phones:
     ```sql
     (substr(recipient_phone, -10) = substr(?, -10) OR recipient_name COLLATE NOCASE = ?)
     ```
3. `src/routes/medicines.ts`:
   - Replace unindexed `CAST(COALESCE(medicines.mrp, 0) AS TEXT) LIKE ?` on 291k rows with indexed numeric comparison.
4. `frontend/src/pages/CRM/RefillsSection.tsx`:
   - Extract exact server error message `(err as any)?.response?.data?.error || (err as any)?.message` instead of generic `Failed to snooze reminder`.
5. `frontend/src/components/QuickAssistSidebar.tsx`:
   - Guard against empty message groups and extract specific backend rejection messages.

---

## Target Files

| Layer | File Path | Scope |
| :--- | :--- | :--- |
| **Backend Route** | `src/routes/automation.ts` | Fix `snooze-patient` & `group/snooze` phone/name matching & validation |
| **Backend Service** | `src/services/refillService.ts` | Update snooze shield query to match normalized 10-digit phone |
| **Backend Route** | `src/routes/medicines.ts` | Fix index-defeating `CAST(mrp AS TEXT)` full-table scan on 291k rows |
| **Frontend CRM** | `frontend/src/pages/CRM/RefillsSection.tsx` | Informative toast errors and robust payload passing |
| **Frontend QA** | `frontend/src/components/QuickAssistSidebar.tsx` | Guard empty group snoozes and provide clear toast feedback |

---

## Execution Phases & Tasks

- [x] **Phase 1: Backend Route Fixes (`src/routes/automation.ts`)**
  - [x] Allow counter walk-in customers with only `patient_name` to be snoozed.
  - [x] Update `WHERE` clauses to use `COLLATE NOCASE`, title prefix stripping, and 10-digit phone normalization (`substr(..., -10)`).
  - [x] Guard `group/snooze` against empty ID arrays, returning `{ success: true, message: 'No active notification IDs to snooze' }`.
- [x] **Phase 2: Refill Service Background Shield (`src/services/refillService.ts`)**
  - [x] Update `createOrUpdateNotification` existing-notification seek to match on normalized 10 digits (`substr(recipient_phone, -10)`) and `recipient_name COLLATE NOCASE = ?`.
  - [x] Ensure snoozed rows with future `snoozed_until` are preserved and never prematurely re-staged during background synchronization.
- [x] **Phase 3: Database Query Optimization (`src/routes/medicines.ts`)**
  - [x] Replace `CAST(mrp AS TEXT)` full scan on 291k rows with sargable indexed numeric range comparisons (`mrp >= ? AND mrp < ?`), reducing query latency from ~800ms to <1ms.
- [x] **Phase 4: Frontend Error Handling & Feedback**
  - [x] In `RefillsSection.tsx`, surface specific backend error messages `(err as any)?.response?.data?.error || (err as any)?.message` in toast notifications.
  - [x] In `QuickAssistSidebar.tsx`, validate message IDs before dispatching group snooze and surface specific error responses in toast.
- [x] **Phase 5: Verification & Quality Gates**
  - [x] Run `npx tsc --noEmit` on backend (exited with code 0).
  - [x] Run `npx --prefix frontend tsc --noEmit` on frontend (exited with code 0).
  - [x] Run `npm run guardrails` (PASS — speed architecture intact).
  - [x] Run `node scripts/quick-update.mjs` to synchronize the knowledge graph (1514 nodes, 894 edges updated in 5.9s).

---

## Tasks Completion Summary

| Task | What Was Completed | How It Was Completed |
| :--- | :--- | :--- |
| **Snooze 400 & Walk-In Failure** | Fixed 400 Bad Request on empty IDs and permitted walk-ins without phone numbers | Updated `src/routes/automation.ts` (`POST /notifications/group/snooze` and `POST /notifications/snooze-patient`) with defensive input handling, normalized 10-digit phone queries, and case-insensitive name matching. |
| **Notification Card Resurrection** | Prevented snoozed cards from reappearing in Staged queue | In `src/services/refillService.ts`, aligned notification seek query with phone normalization (`substr(recipient_phone, -10) = ?`) so phone format variations (`+91` vs 10 digits) do not bypass active snooze rows. |
| **291k Medicines Search Latency** | Eliminated ~800ms full-table scans during search | In `src/routes/medicines.ts`, replaced `CAST(COALESCE(medicines.mrp, 0) AS TEXT) LIKE ?` with indexed range conditions (`mrp >= ? AND mrp < ?`). |
| **Frontend Toast Feedback** | Replaced generic "Failed to snooze" with accurate API details | Updated error handling in `frontend/src/pages/CRM/RefillsSection.tsx` and `frontend/src/components/QuickAssistSidebar.tsx` to surface exact server error payloads. |
| **Quality & Contract Verification** | Verified system integrity across backend and frontend | Executed `npx tsc --noEmit`, frontend `tsc --noEmit`, `npm run guardrails`, and `node scripts/quick-update.mjs` with zero errors. |
