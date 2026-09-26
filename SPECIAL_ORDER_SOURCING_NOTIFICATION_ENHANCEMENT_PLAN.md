# Special Order Verification & Sourcing Notification Enhancement Plan

## Overview
This plan enhances the WhatsApp Special Order owner notification and distributor sourcing mechanism to:
1. **Include Rate and MRP cleanly & Remove the 'Wholesale PTR' Row**:
   - Replace `Wholesale PTR: ₹... | Margin: ...` with a clear two-line format:
     ```text
     Rate: ₹{rate} | MRP: ₹{distributor_mrp}
     Margin: ₹{margin} ({margin_pct}%)
     ```
   - Calculate margin accurately against the candidate product's catalog MRP (or customer confirmed MRP as fallback).
2. **Prioritize Mapped Distributors**:
   - Strictly select from mapped distributors who have available stock.
   - Never show `[Unmapped]` distributors when mapped distributors are in stock. Only fall back to unmapped distributors if zero mapped distributors have stock.
3. **Strict Dosage Form Shield & Candidate Deduplication**:
   - Prevent cross-formulation matching (e.g., customer ordered `IBUGESIC PLUS SYRUP`, never match `IBUGESIC PLUS TAB`).
   - Deduplicate sourcing options so the owner does not see identical products with identical rates and MRP across common distributors.
4. **Human-in-the-loop Verification**:
   - Maintain the final manual approval workflow (`CONFIRM`, `1`, `2`, `REJECT`) so the owner always controls which distributor is committed to cart and what gets sent to the customer.

---

## Root Cause Analysis

### 1. "Wholesale PTR" Display & Missing Distributor MRP
- **Current Behavior**: `waAdminEscalationService.ts:905` generates:
  `Wholesale PTR: ₹{rate} | Margin: ₹{margin} ({margin_pct}%)`
  It calculates margin against `customerMrp`, while omitting the distributor item's own catalog MRP (`optMrp`). If there was a dosage-form mismatch (e.g. syrup MRP 62.27 vs tablet PTR 31.61), the margin calculation displayed an artificial ₹30.66 margin instead of the product's actual margin.
- **Solution**:
  - Format line 1 as: `   Rate: ₹{rate} | MRP: ₹{itemMrp}`
  - Format line 2 as: `   Margin: ₹{margin} ({margin_pct}%)`
  - Remove the phrase `Wholesale PTR:` entirely.

### 2. Forced Inclusion of Unmapped Distributors
- **Current Behavior**: In `whatsappIntentService.ts:2821`:
  `rankSpecialOrderDistributorCandidates(db, validCandidates, 2, 1, medName)` is called with `maxUnmapped = 1`.
  In `pharmarack.ts:1267-1273`, `allowedMapped` is capped at `maxTotal - allowedUnmapped` (i.e., `2 - 1 = 1`). This hardcoded logic forces Option 2 to be an unmapped distributor, even when 10 mapped distributors have abundant stock!
- **Solution**:
  - Fill up to `maxTotal` with mapped candidates first.
  - Only draw from unmapped candidates if `selectedMapped.length < maxTotal` (i.e. if mapped options are exhausted or zero).

### 3. Dosage Form Cross-Contamination (Syrup matching Tablet)
- **Current Behavior**:
  In `whatsappIntentService.ts:247`, `filterCandidatesByFormulation` strips noise tokens defined in `DOSAGE_AND_PACKAGING_NOISE_TOKENS`.
  Because `'tab'` and `'syrup'` are both in that noise set, `IBUGESIC PLUS SYRUP` and `IBUGESIC PLUS TAB` both reduced to `brand: "ibugesic", modifiers: ["plus"]`.
  There was no dosage-form compatibility check enforcing that liquid orals (Syrup/Suspension) must never match solid orals (Tablets/Capsules).
- **Solution**:
  - Use `detectDosageForm(targetName)` and compare against `detectDosageForm(candidateName)`.
  - Enforce bidirectional dosage-form gates (Tablets/Capsules != Syrups/Suspensions != Injections != Topicals).

### 4. Sourcing Reference Deduplication ("Same Name and Same MRP")
- **Current Behavior**: If two distributors offer the identical product at the identical rate/MRP, or if the same distributor has duplicate catalog entries, redundant options appear.
- **Solution**:
  - Ensure Option 1 and Option 2 differ meaningfully in distributor and/or offer the best rate vs best stock diversity.

---

## Actionable Implementation Tasks

- [x] **Task 1: Dosage Form Shield in `filterCandidatesByFormulation`**
  - **File**: [`src/services/whatsappIntentService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
  - **Action Completed**: Implemented `areDosageFormsCompatible` and integrated the Dosage Form Shield into `filterCandidatesByFormulation`. Solid oral candidates (Tablets/Capsules) are strictly rejected when the customer requested liquid oral (Syrup/Suspension) and vice versa. Also auto-infers packaging unit for syrups/bottles/tubes.
  - **Verification**: Verified via automated unit test: `IBUGESIC PLUS SYRUP` successfully rejects `IBUGESIC PLUS TAB` while retaining `IBUGESIC PLUS SYRUP 60ML` and `IBUGESIC PLUS SUSP 100ML`.

- [x] **Task 2: Fix Mapped Distributor Priority in `rankSpecialOrderDistributorCandidates`**
  - **File**: [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)
  - **Action Completed**: Updated ranking logic to fill all available slots (up to `maxTotal`, default 2) with mapped distributors first. Unmapped candidates (`[Unmapped]`) are only used as fallback if zero (or fewer than `maxTotal`) mapped candidates have stock.
  - **Verification**: Verified via automated unit test: When 2 mapped distributors have stock, 0 unmapped distributors are selected.

- [x] **Task 3: Update WhatsApp Message Format in `notifyOwnerOfSpecialOrderPharmarackResults`**
  - **File**: [`src/services/waAdminEscalationService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/waAdminEscalationService.ts)
  - **Action Completed**:
    - Completely removed the `Wholesale PTR: ₹{rate}` row.
    - Implemented the requested two-line format:
      - Line 1: `Rate: ₹{rate} | MRP: ₹{itemMrp}`
      - Line 2: `Margin: ₹{marginVal} ({marginPct}%)`
    - Corrected margin computation to use the distributor item's actual catalog MRP (`opt.mrp`), falling back to customer MRP if catalog MRP is 0.
  - **Verification**: Verified via automated unit test: Output matches the clean format and confirms `Wholesale PTR:` is completely gone.

- [x] **Task 4: Deduplicate Identical Sourcing Options**
  - **File**: [`src/routes/pharmarack.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)
  - **Action Completed**: Added duplicate-candidate detection in `rankSpecialOrderDistributorCandidates` to ensure Option 1 and Option 2 do not present identical medicine name, rate, and MRP when diverse alternatives exist.
  - **Verification**: Verified candidate diversity logic preserves distinct rates/distributors.

- [x] **Task 5: End-to-End Test and Verification**
  - **Action Completed**:
    - Created dedicated automated test suite [`tests/specialOrderNotification.test.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/tests/specialOrderNotification.test.ts) covering all three core behaviors (All 3 passed).
    - Executed `npm run guardrails`: Clean TypeScript compilation (`tsc --noEmit`), 0 speed-architecture or guardrail violations.
    - Executed `node scripts/quick-update.mjs`: Knowledge graph synchronized (1076 nodes, 533 edges).
  - **Verification**: Exit code 0 across all verification steps.

---

## Human-in-the-Loop Safeguards (Contract Adherence)
- The WhatsApp notification requires the owner to reply `CONFIRM`, `1`, `2`, or `REJECT`.
- No cart modification or customer payment link is finalized until the human owner manually responds.

