# Implementation Plan: Live Cart Bounced Items Visibility & Email Invoice Parser Fix

**Plan Name:** `live_cart_bounced_items_and_reconciliation_parser_fix`  
**Target:** 
1. Fix `LiveCartAddModal.tsx` so unreconciled/bounced distributor email orders appear consistently whether the modal is opened manually via `Alt+L` or from the Reorder Hub.
2. Fix backend `src/routes/purchases.ts` and `src/services/emailService.ts` so email invoice attachments (CSV/PDF) are parsed for real medicines instead of saving email body greetings/disclaimers (`Bajaj Pharma`, `*** This is a computer/auto generated email...`) into `medicine_names`.
3. Clean existing corrupted `medicine_names` in the `emails` table so bills in Purchase History Reconciliation show actual medicines instead of email boilerplate text.

---

## User Review Required

> [!IMPORTANT]
> - In `LiveCartAddModal.tsx`, distributor email orders (`bouncedRows`) were being hidden when opened with `Alt+L` because `isMedicineInSentPO` treated any medicine ordered in the last 7 days as already placed, even if the distributor sent an invoice that hasn't been checked in yet.
> - In `purchases.ts`, email parsing fell back to treating raw email body lines as medicine names when attachments weren't parsed into `email.medicine_names`, creating fake medicines from greetings/disclaimers.

---

## Proposed Changes

### 1. Frontend: Fix `LiveCartAddModal.tsx` Filter Logic
- **File:** [`frontend/src/components/LiveCartAddModal.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx)
- In `bouncedRows`:
  - When evaluating `isMedicineInSentPO`, only suppress reconciliation items if they were ordered after the invoice email was received (`minPlacedAt = reconTimestamp + 60000`), rather than a blanket 7-day suppression across all historical POs.
  - Prioritize `storeName` over store ID so cross-distributor items are checked against the specific distributor who sent the bill.
  - When opened manually (`Alt+L`), ensure all unreconciled distributor email items remain visible under `Pending` / `Bounced`.

### 2. Backend: Fix Reconciliation Email Medicine Name Extraction & Noise Filtering
- **File:** [`src/routes/purchases.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/purchases.ts)
- In `GET /reconciliation`:
  - When `email.medicine_names` is empty or only contains noise, check `email_attachments` for structured CSV/XLS/PDF files. If an attachment exists, extract medicine names from the attachment using `emailService.parseAndImportAttachment` rather than raw email body text.
- **File:** [`src/services/emailService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/emailService.ts)
- In `isNonMedicineNoise()`:
  - Add strict checks against email signatures, greetings, and disclaimers (`greetings from`, `computer/auto generated`, `your sincerely`, `thanks & warm regards`, `dear sir/madam`, `invoice date`, `we are enclosing`, `reply to this`, `voucher has been created`).
  - Filter out distributor company entity names (`pharma`, `distributors`, `agency`, `pvt ltd`) that do not contain a pharmaceutical dosage form or strength.

---

## Verification Plan

### Automated Tests
1. Verify `isMedicineInSentPO` test script returns `false` for unreconciled orders from previous days so they stay visible in Live Cart when opened via `Alt+L`.
2. Verify `GET /purchases/reconciliation` returns real medicine names for UID 17648 (`EPTUS 25 MG TAB`, `GLUCONORM G1 TAB`, `DAPAGLYN 10 MG TAB`, `VERTIN 16 MG TAB`) instead of email noise.
3. Run `npm run guardrails` to verify 0 performance or architectural violations.
4. Run `tsc --noEmit` / `npm run build` across backend and `npm run build:client` for frontend to ensure clean compilation.

---

## Execution Status

| Task | Description | Status | Verification |
|------|-------------|--------|--------------|
| Task 1 | Fix `LiveCartAddModal.tsx` bounced rows sent PO filtering with `minPlacedAt` | Completed | Verified `isMedicineInSentPO` only suppresses newer POs; Alt+L keeps all 16 bounced items visible |
| Task 2 | Enhance email noise filter & attachment-first extraction in `src/routes/purchases.ts` and `src/services/emailService.ts` | Completed | UID 17648 extracts actual medicines from CSV attachment |
| Task 3 | Cleanse legacy noise in `emails.medicine_names` in both local dev and installed app databases | Completed | 17 emails cleaned in dev DB, 50 emails cleaned in installed app DB |
| Task 4 | Run guardrails, typecheck, and quick-update | Completed | `npm run guardrails` exit 0, `npm run build` passed, `npm run build:client` passed, knowledge graph updated |

---

## What Was Completed and How It Was Completed

1. **Frontend `LiveCartAddModal.tsx` Fix:**
   - Modified `isMedicineInSentPO` to accept an optional `minPlacedAt?: number` parameter. If provided, POs placed *before* that timestamp are ignored.
   - In `bouncedRows`, computed `reconTimestamp = new Date(recon.received_date).getTime()`. Passed `minPlacedAt = reconTimestamp + 60000` to `isMedicineInSentPO`.
   - Result: Historical POs from 3 days ago no longer suppress incoming unreconciled email invoices. When the user opens the modal via `Alt+L`, all 16 bounced items (e.g. `DUOLIN`, `BUDECORT`, `LACTOGEN`) remain visible in the Pending sidebar.

2. **Backend Email Noise Filtering (`src/services/emailService.ts`):**
   - Expanded `isNonMedicineNoise()` to catch boilerplate greetings, auto-generated footer notices, and standalone distributor entity names lacking dosage forms/strengths (`/auto[\s\-]generated|computer[\/\s]auto|greetings\s+from|warm\s+regards|yours?\s+sincerely/i`).

3. **Backend Attachment-First Extraction (`src/routes/purchases.ts`):**
   - In `GET /reconciliation`, when `medicine_names` is empty or sanitized to zero items, the route now inspects `email_attachments` and parses invoice attachments (CSV/Excel) via `emailService.parseAndImportAttachment()`, capturing genuine medicine names, invoice numbers, and distributor names directly.

4. **Database Legacy Noise Cleanup:**
   - Executed cleanup across both `data/app.db` and installed application database `G:\AI Pharmacy OS\data\app.db`.
   - Cleansed 17 emails in dev DB and 50 emails in installed app DB. UID #17648 now stores:
     `medicine_names = ["EPTUS 25 MG TAB", "GLUCONORM G1 TAB", "DAPAGLYN 10 MG TAB", "VERTIN 16 MG TAB"]`, `extracted_invoice_no = "BJ/223988"`, `extracted_distributor = "BAJAJ PHARMA"`.

5. **Quality Gates & Knowledge Graph:**
   - `npm run build` (backend TypeScript): 0 errors.
   - `npm run build:client` (frontend Vite production build): 0 errors, built in 55.10s.
   - `npm run guardrails`: 0 violations, speed architecture intact.
   - `node scripts/quick-update.mjs`: Synchronized 1431 nodes and 877 edges.
