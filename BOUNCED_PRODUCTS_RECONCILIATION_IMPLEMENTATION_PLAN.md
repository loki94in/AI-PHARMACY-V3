# Bounced Products & Purchase Reconciliation Fix Implementation Plan

> Target: Fix root causes of false "Bounced" order statuses, ghost "Bounced (0)" labels, packaging token mismatches, and premature morning bounced alert notifications.
> Rule Reference: AGENTS.md, User Global Rules #5, #6, #7, #9, #10, #11.
> Status: **COMPLETED & VERIFIED** (All 6 Tasks Passed)

---

## 🔍 Root Cause Analysis & Resolutions

1. **Ghost `Bounced (0)` Status (`src/routes/purchases.ts:3038-3050`)**:
   - **Cause:** `status` was set to `'Bounced'` before filtering `displayMedicines` against `ignoredSet`. When all terms were in `ignoredSet`, `displayMedicines` became empty `[]`, but `status` remained `'Bounced'`, rendering `Bounced (0)`.
   - **Resolution:** Pre-filter with `ignoredSet` before matching. In addition, enforced the invariant: if `displayMedicines.length === 0`, status MUST be `'Matched'`. `Bounced (0)` is now impossible.

2. **Cross-Order Contamination (`src/routes/purchases.ts:2882-2895`)**:
   - **Cause:** A buggy block queried `SELECT medicine_name, product FROM special_orders WHERE LOWER(distributor) LIKE ...` and dumped up to 20 past special orders from other days into *today's email order*. Today's invoice naturally didn't have those past items, so they all falsely showed up as Bounced.
   - **Resolution:** Completely removed the cross-order contamination block. Only items present in the actual email/attachment are reconciled.

3. **Packaging & Strength Form Noise in `tokensMatchFuzzy` (`src/utils/reconciliationMatcher.ts`)**:
   - **Cause:** Packaging stop words (`tab`, `strip`, `mg`, `10's`, manufacturer in parentheses) caused genuine arrivals (e.g., `TELMA 40MG TAB 10'S` vs `TELMA 40`) to fail fuzzy matching.
   - **Resolution:** Created `src/utils/reconciliationMatcher.ts` with `stripPharmaNoise` and `tokensMatchFuzzy`. Strips forms, pack counts, tube weights (`20gm`), bottle volumes (`60ml`), parenthetical manufacturer tags, while strictly guarding against different strengths (e.g. `40` vs `80`, `2.5` vs `5`) and combination suffix bleeding (e.g. `Pan-D` vs `Pan 40`).

4. **Premature Delivery Alert in `bouncedAlertService.ts:115-128`**:
   - **Cause:** When an email had no matching purchase check-in (`!matchedPurchase`), the morning cron falsely declared the entire order as 100% bounced (`Ordered X, Received 0 (BOUNCED) ❌`).
   - **Resolution:** Separated unchecked orders into a **`Pending Deliveries (Awaiting Check-in)`** section. True bounced/short alerts are reserved strictly for checked-in invoices where items were shorted or omitted. Removed schema bug (`loose_quantity` on `purchase_items`). Dynamically resolved recipient to `'Admin / Store Owner'` instead of hardcoded `'Dinesh'`.

5. **Frontend Purchase History UI Polish (`frontend/src/pages/PurchaseHistory/index.tsx`)**:
   - **Resolution:**
     - Prevented `Bounced (0)` badge display: if `recon.medicine_names` is empty, badge displays `Matched`.
     - Distinct badges: `Matched` (green), `Reconciled` (green), `Bounced (N)` (yellow, N > 0), and `Pending Check-in` (amber).
     - Added 1-click **Mark as Reconciled** button (`CheckCircle`) directly on each row in the reconciliation table for instantaneous pharmacist action without needing to open the modal.

---

## 📋 Task Checklist & Execution Log

- [x] **Task 1: Eliminate Ghost `Bounced (0)` & Align Status State (`src/routes/purchases.ts`)**
  - **Completed:** Pre-filters `ignoredSet` before matching.
  - Added invariant guard: `if (displayMedicines.length === 0 && status === 'Bounced') status = 'Matched'`.
  - Reconciled orders return clean `displayMedicines: []` and `status: 'Matched'`.

- [x] **Task 2: Remove Cross-Order Contamination (`src/routes/purchases.ts`)**
  - **Completed:** Removed lines 2847-2864 in `src/routes/purchases.ts`.
  - No past `special_orders` rows are injected into fresh email order payloads.

- [x] **Task 3: Upgrade `tokensMatchFuzzy` with Pharmaceutical Form Normalization (`src/utils/reconciliationMatcher.ts`)**
  - **Completed:** Created shared utility `src/utils/reconciliationMatcher.ts`.
  - Implemented `normalizeInvoiceNo`, `stripPharmaNoise`, and `tokensMatchFuzzy`.
  - Normalizes dosage forms (`tab`, `cap`, `syp`, `inj`), packaging sizes (`10's`, `15s`, `3s`), weights/volumes (`60ml`, `20gm`), manufacturer parens (`(GLENMARK)`).
  - Enforces numeric strength protection (rejects `40` vs `80`, `2.5` vs `5`) and combination suffix protection (rejects `Pan-D` vs `Pan 40`).

- [x] **Task 4: Fix `bouncedAlertService.ts` Logic & Schema Safety (`src/services/bouncedAlertService.ts`)**
  - **Completed:** Removed non-existent `(item as any).loose_quantity` on `purchase_items`.
  - Excludes already-reconciled orders (`AND (is_saved IS NULL OR is_saved = 0)`).
  - Uses `normalizeInvoiceNo` to match purchase invoices reliably.
  - Distinguishes between **Pending Deliveries** vs **True Bounced Items**.
  - Replaced hardcoded `'Dinesh'` with dynamic `'Admin / Store Owner'`.

- [x] **Task 5: Frontend UI Polish in Purchase History (`frontend/src/pages/PurchaseHistory/index.tsx`)**
  - **Completed:** Updated table badges to cleanly differentiate `Matched`, `Reconciled`, `Bounced (N)` (only when N > 0), and `Pending Check-in`.
  - Added direct 1-click **Mark as Reconciled** action button on each row.
  - Updated investigation modal status banner to never show "Bounced" when medicine count is 0.

- [x] **Task 6: Verification & Guardrails**
  - **Completed:** Created and executed `tests/bouncedReconciliation.test.ts` (15/15 tests passed).
  - Verified backend TypeScript compilation (`npx tsc --noEmit` -> Exit 0).
  - Verified frontend TypeScript compilation (`npx tsc --noEmit -p frontend/tsconfig.json` -> Exit 0).
  - Ran performance guardrails scanner (`npm run guardrails` -> PASS, Exit 0).
  - Updated knowledge graph (`node scripts/quick-update.mjs` -> Updated in 4.2s).

---

## 🧪 Verification Test Results

```
--- Running Bounced & Reconciliation Verification Tests ---
Testing normalizeInvoiceNo...
✔ normalizeInvoiceNo passed all test cases
Testing stripPharmaNoise...
✔ stripPharmaNoise passed all test cases
Testing tokensMatchFuzzy matching & safeguards...
✔ tokensMatchFuzzy passed all test cases
Testing Bounced (0) invariant...
✔ Invariant test passed

All 15 verification tests passed successfully!
```

---

## 📁 Files Modified / Created

1. [`src/utils/reconciliationMatcher.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/reconciliationMatcher.ts) — New canonical pharmaceutical matcher and invoice normalizer.
2. [`src/routes/purchases.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/purchases.ts) — Removed cross-order contamination, imported canonical matcher, and fixed `Bounced (0)` status.
3. [`src/services/bouncedAlertService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/bouncedAlertService.ts) — Fixed schema, noise stripping, separated pending deliveries, removed hardcoded names.
4. [`frontend/src/pages/PurchaseHistory/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PurchaseHistory/index.tsx) — Polished status badges, added 1-click Reconcile button, added `Pending Check-in` indicator.
5. [`tests/bouncedReconciliation.test.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/tests/bouncedReconciliation.test.ts) — Verification test suite for all matcher and invariant rules.
