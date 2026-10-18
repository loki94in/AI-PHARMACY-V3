# Implementation Plan: Fix Saving Existing/Old Bills with Missing Expiry

**Goal:**
Allow users to edit and save existing purchase bills (including historical bills from 1-2 years ago) in place without being blocked by missing expiry validation ("expiry is required for [Medicine]. Enter it from the distributor bill before saving"). Ensure that existing bills are always updated directly via `api.updatePurchase(editPurchaseId, ...)` and never created as new bills.

---

## 1. Problem & Root Cause Analysis

1. **Strict Client-Side Expiry Block in Edit Mode**:
   - In `frontend/src/pages/Purchases/index.tsx` (`validateBeforeVerification` / `collectBillForSave`), lines 2552-2563:
     `!String(item.expiry_date || '').trim() ? 'expiry'`
     When editing an existing historical bill (`editPurchaseId` active), if any row lacks an expiry date (e.g. historical data lacked expiry, or product details/medicines were changed on an old bill), the validator aborts with:
     `expiry is required for "${name}". Enter it from the distributor bill before saving.`
   - Because the distributor bill was received 1-2 years ago, the physical bill is not at hand. The user is trapped and unable to save edits.

2. **`selectMedicine` Wipes Existing Row Data**:
   - In `frontend/src/pages/Purchases/index.tsx` (`selectMedicine`), lines 2074-2082:
     When a user corrects a wrong medicine on an old bill by selecting a replacement (e.g. `"DIPSALIC F OINTMENT 20GM"`), if the row did not meet `hasParsedBillData`, it wiped `item.batch_no = ''` and `item.expiry_date = ''`.
   - When editing an existing bill row, the row's existing batch, expiry, rate, and MRP should be preserved rather than cleared.

3. **Ensuring Existing Bill In-Place Update (Never as New Bill)**:
   - When `editPurchaseId` is active, `handleSaveBill` / `confirmVerifiedSave` already targets `api.updatePurchase(editPurchaseId, ...)`, which issues `PUT /purchases/:id/full`.
   - We must guarantee `editPurchaseId` is preserved throughout verification and submission so it updates the existing bill without creating a new bill.

---

## 2. Solution Architecture & Changes

### A. Non-Blocking Expiry with Fallback in Edit Mode (`frontend/src/pages/Purchases/index.tsx`)
1. In `collectBillForSave` / `validateBeforeVerification`:
   - If `editPurchaseId` is present:
     - Missing `expiry_date` is non-blocking.
     - Auto-assign a safe fallback: if `cleanInvoiceDate` or `invoiceDate` exists, compute `invoiceDate + 2 years` (e.g. `MM/YY`); otherwise fallback to `'12/99'`.
     - Set both `item.expiry_date` and `item.expiry` to this formatted fallback so the bill saves seamlessly.
   - For fresh manual purchases (`!editPurchaseId`), keep the standard strict validation requirement.

### B. Preserve Row Details in `selectMedicine` (`frontend/src/pages/Purchases/index.tsx`)
1. When `editPurchaseId` is active, do not wipe `item.batch_no`, `item.expiry_date`, `item.rate`, or `item.mrp` if they already hold values.
2. If `item.expiry_date` was empty on that row, auto-fill it from the bill's invoice date (`+2 years`).

---

## 3. Verification Plan

1. **TypeScript Typecheck**:
   - `npx tsc -p frontend/tsconfig.app.json --noEmit` (exit code 0)
   - `npx tsc --noEmit` (exit code 0)
2. **Performance Guardrails**:
   - `npm run guardrails` (zero violations)
3. **Knowledge Graph Sync**:
   - `node scripts/quick-update.mjs`

---

- [x] Task 1: Update `collectBillForSave` in `frontend/src/pages/Purchases/index.tsx` to allow non-blocking fallback expiry in edit mode
  - *Completed:* When `editPurchaseId` is active, missing `expiry_date` is no longer a blocking validation error; it automatically calculates a fallback expiry from the invoice date (+2 years) or defaults to `12/99` so historical bills can be saved immediately.
- [x] Task 2: Preserve existing row batch/expiry details during medicine replacement in `selectMedicine`
  - *Completed:* When replacing a medicine on an existing bill row, the row's existing batch, expiry, rate, and MRP are preserved rather than wiped, and any missing expiry is auto-filled from the invoice date.
- [x] Task 3: Verify TypeScript compilation, performance guardrails, and update knowledge graph
  - *Completed:* Verified frontend `tsc -p frontend/tsconfig.app.json --noEmit` (0 errors), backend `tsc --noEmit` (0 errors), and performance guardrails `npm run guardrails` (0 violations). Knowledge graph updated.
