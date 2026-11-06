# IMPLEMENTATION PLAN: Refill Live Cart "Refill Not Found" & Electron Fast-Reopen Crash Fix

## Plan Name
`REFILL_LIVE_CART_AND_ELECTRON_FAST_REOPEN_CRASH_FIX_PLAN`

---

## 1. Problem Formulation & Scope

### Defect 1: CRM Refill → Live Cart Fails with "Refill not found" & Medicine ID Misalignment
- **Symptom**: When attempting to auto-add or manually add a refill (e.g. `LEVIPIL 750MG STRIP OF 10 TABLETS` for Mr. Vishal Bhise) to the Pharmarack Live Cart, the modal immediately shows `Failed` with error message `"Refill not found"`.
- **Root Cause**:
  1. `src/services/refillCartService.ts` executed an `INNER JOIN medicines m ON m.id = pr.medicine_id`. When `pr.medicine_id` was null, 0, or pointed to an invalid/orphan ID, the query returned nothing and threw `Refill not found` (HTTP 404).
  2. In `frontend/src/pages/CRM/RefillsSection.tsx`:
     - `handleOpenAddModal` mapped `existingPat.medicines` using `medicineId: m.medicine_id || m.id`. Here `m.id` is the primary key of `patient_refills`, NOT `medicines.id`.
     - `searchLocalInventory` used `item.medicine_id || item.id`, where `item.id` was `inventory_master.id`.
     - This caused corrupted foreign keys in `patient_refills.medicine_id`.
  3. `LEVIPIL 750MG` (`medicine_id: 1139614`) had 0 stock in inventory and 0 distributor links in `medicine_distributor_links`. The patient's actual recorded prescription was for `LEVIPIL 1GM TABLET` (`medicine_id: 1139610`), so switching/searching 750mg left the cart runner unable to find a distributor or validate the row.
  4. In `frontend/src/components/LiveCartAddModal.tsx`, searching a new medicine reset `activeSourceRefillId` to `undefined`, disconnecting manual live cart adds from the patient refill schedule.

### Defect 2: App Crashes / Vanishes When Closed and Reopened Within 5–10 Seconds
- **Symptom**: If the user closes the app and immediately double-clicks the desktop shortcut to re-open within 5–10 seconds (or <5s), the app appeared for a second and vanished, or crashed with a startup error.
- **Root Cause**:
  1. In `electron/main.ts`, `app.on('window-all-closed')` requested graceful backend shutdown via `/api/system/client-exit` and armed a 5-second grace watchdog timer (`GRACE_MS = 5000`).
  2. If reopened within 5 seconds, Instance #2 lost the single-instance lock (`app.requestSingleInstanceLock()`) because Instance #1 was still executing its shutdown grace wait. Instance #2 sent `second-instance` to Instance #1 and exited immediately.
  3. Instance #1 received `second-instance` and executed `createWindow()`. **However**, Instance #1 never cancelled `forceTimer`, never unset `finish()`, and the backend was already instructed to terminate.
  4. As soon as the backend child process terminated, `proc.once('exit')` fired `finish()` -> `app.quit()`, instantly destroying the newly opened window.
  5. Furthermore, if reopened right as the process died, port 5175 in Windows socket `TIME_WAIT` or `data/app.db` WAL cleanup locks caused the new backend to exit prematurely during initialization.

---

## 2. Technical Architecture & File Ownership

### Backend Services
- [`src/services/refillCartService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillCartService.ts)
  - Changed `JOIN medicines m` to `LEFT JOIN medicines m`.
  - Fall back to `pr.medicine_name` if `m.name` is null.
  - Auto-resolve `medicine_id` by matching `pr.medicine_name` against `medicines.name` if missing or orphan.
  - Return `medicineId` in `RefillCartResult` so UI can link distributors without getting stuck.
- [`src/routes/refills.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/refills.ts)
  - Verified `medId` exists against `medicines` table; auto-inserts into `medicines` if a newly typed medicine lacks a master catalog ID.

### Frontend CRM & Live Cart
- [`frontend/src/pages/CRM/RefillsSection.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/CRM/RefillsSection.tsx)
  - Removed unsafe `|| m.id` and `|| item.id` fallbacks that corrupted `medicine_id`.
  - Autocomplete and selection handlers now preserve genuine `medicines.id`.
- [`frontend/src/services/api.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/api.ts) & [`frontend/src/services/refillCartJobs.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/refillCartJobs.ts)
  - Added `medicineId?: number` to `RefillCartResult` and patched rows with resolved `medicineId` so `canLink` is enabled on failed/not_found rows.

### Electron Lifecycle & Startup Guard
- [`electron/main.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/electron/main.ts)
  - Implemented `shutdownInProgress`, `shutdownForceTimer`, and `shutdownProcExitHandler`.
  - In `app.on('second-instance')`:
    - Checks if shutdown is in progress; if so, aborts shutdown, clears `shutdownForceTimer`, and detaches the process exit listener.
    - Focuses or recreates the window.
    - If the backend child is dead or unresponsive, cleans locks, reclaims the port, and restarts the backend process cleanly before loading the window.
  - In `app.on('window-all-closed')`:
    - `finish()` checks `if (!shutdownInProgress) return;` preventing aborted shutdowns from terminating revived windows.

---

## 3. Step-by-Step Implementation Instructions

### Step 1: Fix `refillCartService.ts` Query & Medicine Fallback
1. Changed `JOIN medicines m` to `LEFT JOIN medicines m`.
2. Extracted `medicineName` with fallback to `pr_medicine_name`.
3. Auto-resolved missing/orphan `medicine_id` against `medicines.name`.
4. Provided `medicineId` in `RefillCartResult`.

### Step 2: Fix Frontend ID Fallback in `RefillsSection.tsx` & API Types
1. Replaced `m.medicine_id || m.id` with `m.medicine_id || undefined`.
2. Replaced `item.medicine_id || item.id` with `item.medicine_id || 0`.
3. Added `medicineId` field to `RefillCartResult` in `api.ts` and updated `refillCartJobs.ts`.

### Step 3: Fix Electron Fast-Reopen & Shutdown Lifecycle in `electron/main.ts`
1. Added shutdown state flags: `shutdownInProgress`, `shutdownForceTimer`, `shutdownProcExitHandler`.
2. On `second-instance`, cancelled shutdown timers, detached exit handlers, and revived backend if needed.
3. Guarded `finish()` in `window-all-closed` so `app.quit()` is skipped if revived.

---

## 4. Verification & Testing Checklist

- [x] **Test 1: Refill with Missing/Mismatched Medicine ID**:
  - `refillCartService.ts` uses `LEFT JOIN` and falls back to `pr.medicine_name`, auto-recovering the medicine ID and returning `needs_link` rather than throwing `Refill not found (404)`.
- [x] **Test 2: CRM Refill Add to Live Cart UI**:
  - `RefillsSection.tsx` never leaks `refill.id` or `inventory_master.id` into `medicine_id`.
  - `RefillCartResult` carries `medicineId`, allowing `canLink` and `MedicineLinkModal` to function on any row.
- [x] **Test 3: Electron Fast Close & Reopen (< 5 seconds)**:
  - Second-instance cancels in-flight shutdown timer and detaches exit listener.
  - Backend child health check guarantees app never launches into an empty/crashed window.
- [x] **Test 4: Performance Guardrails**:
  - Ran `npm run guardrails`: Clean `tsc --noEmit`, exit 0, speed architecture intact.

---

## 5. Task Completion Log

| Task | Description | Status | Verification Result |
| :--- | :--- | :--- | :--- |
| **Task 1** | Rename existing `implementation.md` to `POS_LOOSE_MEDICINE_TRAILING_EMPTY_ROW_AND_ENTER_CHECKOUT_OPTION_B_PLAN.md` | Completed | Preserved POS loose medicine plan in root per Rule 10 |
| **Task 2** | Create new dedicated plan `REFILL_LIVE_CART_AND_ELECTRON_FAST_REOPEN_CRASH_FIX_PLAN.md` | Completed | Created and structured per Rule 5, 10 |
| **Task 3** | Fix `refillCartService.ts` `LEFT JOIN` and auto-resolution | Completed | Tested, `LEFT JOIN` prevents 404, auto-resolves name |
| **Task 4** | Fix `RefillsSection.tsx` ID fallbacks & `api.ts` / `refillCartJobs.ts` | Completed | Surgical diff, `medicineId` correctly propagated |
| **Task 5** | Fix `electron/main.ts` fast-reopen second-instance shutdown race | Completed | Shutdown abort, timer clear, backend revival |
| **Task 6** | End-to-end verification and guardrails check | Completed | `npm run guardrails` passed (exit 0) |
