# Implementation Plan: Distributor Selection Accuracy & Non-Fabricated Verification

## Problem Statement
In WhatsApp ordering (e.g. `SO-TMSA-6`), when a customer selects a specific medicine option (e.g. Option 4: `GLIMIDIB M2 SR 15TAB` with MRP ₹177.19 from `BETTER LIFE PHARMA`), the system replaces the distributor with `SINHAGAD PHARMA` in the database, and then sends the admin a completely re-queried and re-ranked list of different distributors (`AMIT MEDICO` and `PRO SUCCESS PHARMA`) with differing MRPs (₹126 and ₹214.31). The app must preserve the exact selected row from live search with 100% truthfulness and zero fabrication across customer, database, admin verification, and live cart addition.

## User Constraints & Decisions
1. **Strict Single Choice**: Admin only sees and confirms the exact distributor selected by the customer (no alternatives / no late-stage swaps).
2. **Manual Override Allowed Later**: User/admin can manually change the distributor later in the UI if desired, but automated bot messaging must strictly use the selected product and distributor.
3. **No Fabricated Search Results / Stock Badges**: Do not fabricate results, alter sequence, or re-sort by arbitrary high/low stock or lowest price heuristics.
4. **Human-in-the-Loop**: Admin explicitly approves (`CONFIRM`) or rejects (`REJECT`) before the customer is prompted for payment.

---

## Tasks Checklist

- [x] Task 1: Preserve Complete Item Metadata in Live Search Flow
  - Target: `src/services/whatsappIntentService.ts`
  - Added `MedicineSearchCandidate` interface and ensured `mappedCatalogHits`, `mappedRows`, and `newMappedHits` capture `distributor`, `storeId`, `productId`, `productCode`, `rate`, `stock`, `packaging`, and `mrp`.
  - Upgraded deduplication key to `${cleanName}::${distStr}::${packStr}` so differing distributors and packagings are never dropped or suppressed.

- [x] Task 2: Retain Selected Distributor Without Overwriting in Confirmation Flow
  - Target: `src/services/whatsappIntentService.ts`
  - In `awaiting_selection` step, extracted `chosenDist` and `chosenStoreId` directly from the chosen option.
  - Strictly gated `resolveSingleDistributorForMedicine` so it only runs if no distributor is attached to the candidate, preventing the frequent-distributor overwrite bug.

- [x] Task 3: Direct Procurement Hand-Off Without Re-Querying or Swapping Products
  - Target: `src/services/whatsappIntentService.ts` (`proceedWithConfirmedProcurement`)
  - Retrieved `selectedCandidate` from `options_json` matching the confirmed selection.
  - When present, populated `special_orders` with exact `pharmarack_rate`, `distributor_name`, `pharmarack_distributor`, `pharmarack_store_id`, `pharmarack_product_id`, and `pharmarack_product_code`.
  - Dispatched directly to `notifyOwnerOfSpecialOrderPharmarackResults` with `pharmarackOptions: [exactOption]`, completely bypassing the truncated re-query (`word2 = "GLIMIDIB M2"`) and re-ranking.

- [x] Task 4: Clean Admin Verification Display for Strict Single Choice
  - Target: `src/services/waAdminEscalationService.ts` (`notifyOwnerOfSpecialOrderPharmarackResults`)
  - For single option verification, display `🚚 Selected Distributor (From Live Search):` without `[Best Rate]` or `[High Stock]` badges.
  - Configured prompt to strictly offer `Reply CONFIRM (or 1) to approve & send payment QR to customer` or `REJECT`.

- [x] Task 5: Verification & End-to-End Test
  - TypeScript compilation: `npx tsc --noEmit` exited with code 0 (clean).
  - Performance Guardrails: `npm run guardrails` passed with 0 violations across all 11 changed files.
  - Jest test suite: `tests/specialOrderNotification.test.ts` passed 4/4 tests.
  - Auto-Knowledge Graph: `node scripts/quick-update.mjs` executed.
  - Bug register: Updated `SMALL_BUG_FIX_PLAN.md` under Section 8.
