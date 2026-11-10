# CRM → QA Selective Refill & Live Cart Flow Plan

## Goal
Enforce the 6 user rules for CRM → QA → Pharmarack Live Cart and fix Mr. NIDGE's 8-day refill cycle resurrection and partial-completion bugs:
1. **CRM is the source:** Only medicines explicitly selected through that patient's Refill to Live Cart workflow enter this refill's QA queue.
2. **QA is selective:** The CRM popup displays all medicines in the patient's refill with live statuses and editable quantities, and sends **only** the selected medicines + edited quantities to QA.
3. **Reopening CRM is supported:** User can reopen CRM later to select remaining eligible pending medicines while previously processed medicines remain visible with their statuses (`In QA`, `In Live Cart`, `Ordered`, `Needs Link`, `Out of Stock`, `Fulfilled`).
4. **No cross-patient mixing:** Refill records and QA selections stay strictly isolated by `(customer_id / phone, refill_id, cycle_due_date, medicine_id)`. Never wipe `cart_*` across all patients, never overwrite another patient's/order's Pharmarack line qty, and never collide job/group keys by `patientName` or raw `patient_phone` alone.
5. **No automatic QA additions:** Normal orders, direct live-cart additions, sibling due-soon medicines, and other patients' refills never silently enter a patient's QA selection.
6. **Final approval:** Only clicking **Add to Cart** inside QA triggers the actual Pharmarack Live Cart write.

## Schema & Backend Changes (`src/database.ts`, `src/routes/refills.ts`, `src/services/refillCartService.ts`, `src/services/refillService.ts`)
1. **Bump `CURRENT_SCHEMA_VERSION` (`85` → `86`)** in `src/database.ts`, updating both `CREATE TABLE IF NOT EXISTS patient_refills` and `ensureRefillCartLinkSchema`:
   - `qa_cart_qty INTEGER DEFAULT NULL` (edited qty staged from CRM; keeps `quantity_needed` untouched)
   - `qa_staged_at TEXT DEFAULT NULL` (shop-local timestamp when staged from CRM)
   - `cart_cycle_due_date TEXT DEFAULT NULL` (cycle due date saved with the live-cart identity)
   - `updated_at DATETIME DEFAULT NULL` (ensure column exists without silent swallow)
   - Index `idx_patient_refills_qa_staged ON patient_refills(is_active, qa_cart_qty)`
2. **New Endpoints in `src/routes/refills.ts` (before `/:id` routes):**
   - `POST /api/refills/qa-stage`: validates `{ items: [{ refill_id, qty }] }`, saves `qa_cart_qty = qty`, `qa_staged_at = localNow`, `cart_status = 'qa_queued'`. Zero Pharmarack writes.
   - `POST /api/refills/qa-unstage`: validates `{ refill_ids }`, clears `qa_cart_qty = NULL`, `qa_staged_at = NULL`, restores `cart_status` (`'added'` if `cart_store_name` else `'pending'`). Zero Pharmarack writes.
3. **Fix `GET /api/refills/panel`:**
   - Remove the `OR pr.patient_phone IN (SELECT pr2.patient_phone ...)` cross-medicine phone bleed.
   - Use interval-aware lead window `MIN(?, MAX(1, CAST(COALESCE(pr.refill_interval_days, 30) / 3 AS INTEGER)))` + cooldown check so short cycles (e.g. Mr. NIDGE `8` days) do not bounce back the next day, while `pr.qa_cart_qty > 0` always surfaces CRM-staged items in QA.
   - Group by `customer_id ? 'c:' + customer_id : 'p:' + normalizedPhoneOrRaw + '|' + lowerName`.
   - Preserve each refill's own `cart_qty` (expose `live_cart_total_qty` separately if present, never overwriting `cart_qty` with another patient's shared line total).
4. **Fix `src/services/refillCartService.ts`:**
   - Remove the blanket `UPDATE patient_refills SET cart_* = NULL WHERE medicine_id = ?` in `saveMedicineLinks` (and remove phantom `cart_item_id`).
   - Add an in-process single-flight cart mutex around `processRefillCartItem` read-modify-write.
   - When `hit` is another patient's/manual cart line (`!mine`), compute `total = hit.qty + qty` (never overwriting `hit.qty` with `opts.qty`) and store `cart_qty = qty` (this refill's own delta) + `cart_cycle_due_date`.
   - On `'added'` / `'in_cart'`, clear `qa_cart_qty = NULL`, `qa_staged_at = NULL`, set `cart_status = 'added'`. On `'needs_link' | 'linked_oos' | 'not_found' | 'failed'`, keep `qa_cart_qty` and set `cart_status = res.status` so QA retains the item for retry/linking.
5. **Fix `executeCloseRefillCycles` (`src/routes/refills.ts`) & `checkAllRefills` (`src/services/refillService.ts`):**
   - Reset `qa_cart_qty`, `qa_staged_at`, `cart_store_id`, `cart_product_name`, `cart_cycle_due_date`, `cart_status = 'pending'`, `batch_id`, `approval_status`, `approval_reason` on cycle close.
   - Apply the same interval-aware lead window + cooldown check in `checkAllRefills` and `syncStagedRefillNotificationForPatient`.

## Frontend Changes
1. **`frontend/src/utils/refillSettled.ts`:**
   - Export `effectiveRefillLeadDays(intervalDays, maxLead = 7)`.
   - Update `checkRefillCycleBooking` to use `effectiveRefillLeadDays` + cycle cooldown (`daysSinceDispense < intervalDays - leadDays`).
   - Add `isRefillQaStaged(m)` helper (`Number(m.qa_cart_qty) > 0 || m.cart_status === 'qa_queued'`).
2. **`frontend/src/components/RefillOrderModal.tsx`:**
   - Default `mode = 'crm_select'` (CRM → Continue to QA).
   - Fix line 110 tautology so already-staged (`qa_cart_qty > 0`), already in live cart, or already-fulfilled items default to `selected: false` with clear status chips (`In QA ×N`, `In Live Cart`, `Needs Link`, `Out of Stock`, `Fulfilled`), while eligible pending medicines are selectable with editable qty.
   - Primary button in CRM mode: **`Continue to QA (N)`** → calls `api.stageRefillsForQa(...)` (`POST /api/refills/qa-stage`) and does **not** call `startRefillCartJob`.
3. **`frontend/src/pages/CRM/RefillsSection.tsx`:**
   - Reroute per-row `+ Live Cart` and `Confirm & Cart` to stage via `POST /api/refills/qa-stage` (no direct Pharmarack writes from CRM).
   - Display `In QA ×N` status badge alongside `In Live Cart`.
4. **`frontend/src/components/QuickAssistSidebar.tsx` & `frontend/src/services/refillCartJobs.ts`:**
   - Key `refillCartJobs` and `groupedActionableRefills` by unique `patientKey` (`c:${customerId}` or normalized phone + lower name), never `patientName` alone.
   - Filter `actionableRefills` using `effectiveRefillLeadDays` (plus `isRefillQaStaged`).
   - Render a dedicated **QA Live Cart Selection** block on patient cards that have `qaQueuedMeds = group.medicines.filter(isRefillQaStaged)` showing **only** those selected medicines and their edited `qa_cart_qty`:
     - **`Add to Cart (N)`** (inside QA only!) triggers `startRefillCartJob` strictly for `qaQueuedMeds` with their `qa_cart_qty` — even if sibling medicines are already `ordered` or `ready`.
     - **`Cancel QA`** calls `POST /api/refills/qa-unstage` (no live-cart changes).
     - When `qaQueuedMeds.length === 0`, QA does **not** silently add unselected medicines to Live Cart; instead it offers **`Select in CRM`** (opens `RefillOrderModal` in `crm_select` mode).
   - Fix `handleCompleteRefillGroup` to pass `selectedIds` (when provided) instead of all `group.medicines`, and `handleBookRefillToPos` to prefill only `targetIds`.

## Tasks
- [x] Update `src/database.ts` (`CURRENT_SCHEMA_VERSION = 86`, `patient_refills` columns + index in both DDL & `ensureRefillCartLinkSchema`)
- [x] Update `src/services/refillCartService.ts`, `src/routes/refills.ts`, and `src/services/refillService.ts` (QA stage/unstage endpoints, panel isolation & lead window, cart mutex & delta tracking, cycle close reset)
- [x] Update `frontend/src/services/api.ts`, `frontend/src/utils/refillSettled.ts`, `frontend/src/services/refillCartJobs.ts`, `frontend/src/components/RefillOrderModal.tsx`, `frontend/src/pages/CRM/RefillsSection.tsx`, and `frontend/src/components/QuickAssistSidebar.tsx`
- [x] Add automated tests in `tests/crmQaSelectiveRefillFlow.test.ts` (fresh & existing DB migration, selective QA staging, iterative CRM reopen, cross-patient isolation, Mr. NIDGE 8-day cooldown) and register in `jest.config.js`
- [x] Run Jest tests, `npm run build`, `npm run build:client`, `npm run guardrails`, `node scripts/quick-update.mjs`, and update DOX (`src/AGENTS.md`, `frontend/AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`)
