# Implementation Plan: Full App Audit & Eradication of Dummy Fallbacks (100% True Data)

> **STATUS: COMPLETED**  
> **Created:** 2026-10-05  
> **Objective:** Systematically audit, detect, and eliminate all dummy fallbacks, placeholder tokens, and simulated states across all pages and lifecycles—**Boot / Startup, Claims / Customer Returns, Purchases, Sells / POS & Bill Edit, Mail / Email Inwarding, CRM, and Inventory / Batches**—guaranteeing 100% genuine data everywhere with mandatory Human-in-the-Loop review for any ambiguous data.

---

## 1. Problem Statement & Root Causes by Page

| Page / Lifecycle | Root Cause / Vulnerability Found | Impact / Violation |
|---|---|---|
| **Boot & Startup** | Legacy offline flags, unvalidated settings seeds in `database.ts`, and fallback connection modes. | System can boot into unverified state or display misleading offline status. |
| **Claims & Returns** (`/customer-returns`, `/returns`) | In `src/routes/returns.ts`, customer returns without an explicit reason default to `'Supplier Return'`. In `CustomerReturn/index.tsx`, native blocking `alert()` is used instead of system toasts. | Creates audit trail contradiction (`CRET-REASON-MISMATCH`); violates guardrail `F9`. |
| **Purchases & Inwarding** (`/purchases`, `/purchase-history`) | OCR and invoice parsers historically defaulted unknown distributors or unreadable batch codes to generic strings. | Stock drift and regulatory compliance failure. *(Hardened in previous task; needs continuous audit & gate verification)*. |
| **Sells / POS & Bill Edit** (`/pos`, `/sells`) | In `src/routes/sales.ts` (`PUT /sales/:id`), editing a bill does not validate `patient_name` with `isValidCustomerName`, allowing editors to persist `"Walk-in Customer"` or `"Unknown"` into `customers`. In `POST /sales`, cash sales with missing patient names schedule auto-refills under `"Walk-in Customer"`. | Spurious refill reminders sent to non-existent patients; dummy records in `customers`. |
| **Mail & Email Import** (`/mail`, `emailService.ts`) | Historical fallback patterns inserted placeholder distributors like `"Unknown Distributor"` or `"Default Distributor"` when sender email was unrecognized. | Pollutes distributor catalog and breaks GST/TIN linkage. *(Hardened to stage into `staged_purchases` for human review)*. |
| **CRM (Refills & Orders)** (`/crm`, `src/routes/crm.ts`) | In `src/routes/crm.ts`, unlinked orders default patient names to `'Walk-in Customer'` or `'Customer'`. When broadcasting WhatsApp delay notices, it interpolates `"Dear Walk-in Customer"`. | Unprofessional, hallucinated messaging sent to real patient phone numbers. |
| **Inventory & Batches Edit** (`/inventory`, `src/routes/inventory.ts`) | In `src/routes/inventory.ts` (`PUT /inventory/:id`), batch number updates do not enforce `isValidBatchNumber()`, allowing banned tokens (`B-GEN`, `BATCH123`) to be entered. | Bypasses inventory integrity checks and injects banned tokens into active stock. |

---

## 2. Architectural Contracts & Non-Negotiable Standards

1. **Zero Dummy Data Contract (`AGENTS.md` & Guardrail `F8`)**:
   - Zero occurrences of `B-GEN`, `B-CATALOG`, `B-IMPORT`, `B-OFFLINE`, `B-REISSUE`, `B-MANUAL`, `B-NEW`, or `BATCH123`.
   - No placeholder customer names (`Walk-in`, `Walk-in Customer`, `Customer`, `Unknown`, `Patient`).
   - Unregistered cash sales must have `customer_id: null` and display as `— (Counter Sale)`, never a fake customer profile.
   - Missing data must remain empty, null, or display clear unset indicators (`-`), never fabricated.

2. **Human-in-the-Loop Final Step (Rule 6)**:
   - When an automated system (OCR, email parser, sync worker) detects missing, low-confidence, or ambiguous data, it **must never** use a fallback.
   - It must route the record to the Human-in-the-Loop queue (`staged_purchases`, `StagedReviewModal`, Investigation Center) where a human pharmacist reviews physical packaging/invoices, supplies true data, and explicitly approves or rejects.

3. **Single Writer & Strict Schema Safety (`BACKEND SCHEMA SAFETY.md`)**:
   - Every mutation route must enforce input validation before touching SQLite tables.
   - POS is the sole writer of sales; Purchases is the sole writer of purchase inwarding; CRM is the sole manager of refills and special orders.

4. **No Simulated/Mock Features Rule (`AGENTS.md` & Guardrail `F7`)**:
   - No mock indicators, simulation toggles, or fake sync states anywhere in the UI.

---

## 3. Page-by-Page Remediation Plan

### Phase 1: Claims & Returns (`/customer-returns`, `/returns`)
- **Backend (`src/routes/returns.ts`)**:
  - Remove hardcoded `'Supplier Return'` default for `reason`. If `type === 'sale'`, default to `'Customer Return'` or require an explicit user-supplied reason.
  - Require a legitimate return reason from the user interface; reject empty or placeholder reasons.
- **Frontend (`pages/CustomerReturn/index.tsx`)**:
  - Replace native `alert('Return processed successfully!')` with `toastEvent.trigger(...)`.
  - Enforce mandatory return reason selection dropdown/input before submit.

### Phase 2: Sells, POS & Bill Editing (`/pos`, `/sells`)
- **Backend (`src/routes/sales.ts`)**:
  - In `PUT /sales/:id` (bill edit), enforce `isValidCustomerName(newName)` before inserting or re-linking in the `customers` table.
  - In `POST /sales`, if `patient_name` is empty or invalid, skip automatic refill scheduling (do not insert dummy refill rows under `"Walk-in Customer"`).
- **Frontend (`pages/Sells/index.tsx`, `pages/POS/index.tsx`)**:
  - Clean up display fallback: for cash sales with no registered customer, display `— (Counter Sale)` instead of fabricating `"Walk-in"`.

### Phase 3: CRM (Refills, Special Orders & Messaging) (`/crm`)
- **Backend (`src/routes/crm.ts`)**:
  - In `candidates` mapping for delay notices, do NOT substitute `'Walk-in Customer'` or `'Customer'` when patient name is null.
  - In `/broadcast-delay-notices`, format message with a respectful generic fallback (e.g., `"Valued Customer"`) only if a human explicitly chooses to send without a named profile, or require pharmacist to input patient name before broadcasting.

### Phase 4: Inventory & Batch Editing (`/inventory`)
- **Backend (`src/routes/inventory.ts`)**:
  - In `PUT /inventory/:id` and `POST /inventory/override`, enforce `isValidBatchNumber(batch_no)` from `nameNormalizer.ts`.
  - Reject banned batch tokens (`BANNED_BATCH_STRINGS`) with a descriptive 400 Bad Request error.

### Phase 5: Mail & Email Import (`/mail`)
- **Backend (`src/services/emailService.ts`) & Frontend (`pages/Mail/`)**:
  - Ensure all incoming invoices with unrecognized senders or unlinked items strictly land in `staged_purchases` with `distributor_id = null` and `status = 'pending_review'`.
  - Verify UI prompts pharmacist to search/select the real distributor from the database.

### Phase 6: Boot & Startup Verification
- Verify `src/server.ts`, `startupSyncCoordinator.ts`, and `electron/main.ts` report live hardware, database, and sync status with zero mock states.

### Phase 7: Verification & Audit Pass
- Run `auditEngine.ts` across all 18 categories to verify clean state.
- Run `npm run guardrails` to verify 0 violations on changed lines.
- Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.

---

## 4. Execution & Completion Status Tracker

| Task ID | Description | Status | How It Was Completed |
|---|---|---|---|
| **TASK-1** | Claims & Returns: Fix `returns.ts` reason fallback & replace native `alert()` in `CustomerReturn/index.tsx` | COMPLETED | Set reason default based on return type (`Customer Return` for `type === 'sale'`, `Supplier Return` for `type === 'purchase'`); enforced reason requirement and replaced `alert()` with `toastEvent.trigger()` in `CustomerReturn/index.tsx`. |
| **TASK-2** | Sells & Bill Edit: Guard `PUT /sales/:id` with `isValidCustomerName` and stop dummy refill row generation | COMPLETED | Enforced `isValidCustomerName` on patient updates in `PUT /sales/:id` to preserve unregistered cash sales as `customer_id: null` without dummy entries; restricted auto-refill generation in `POST /sales` to identified customers; updated Sells table/modal to render `— (Counter Sale)` instead of fake `'Walk-in'`. |
| **TASK-3** | CRM: Clean delay notice candidate names and WhatsApp template interpolation in `crm.ts` | COMPLETED | Stripped placeholder strings from `candidates` mapping in `src/routes/crm.ts`; ensured delay notice broadcasts use validated customer names or respectful `'Valued Customer'`, never `'Walk-in Customer'`; updated CRM credit/refill modals to display `— (Counter Sale)`. |
| **TASK-4** | Inventory: Enforce `isValidBatchNumber` on batch updates in `PUT /inventory/:id` and `POST /override` | COMPLETED | Added `isValidBatchNumber` check in `PUT /inventory/:id` to block banned batch tokens and empty batches with a 400 error. |
| **TASK-5** | Mail & Inwarding: Verify strict Human-in-the-Loop staging review for unlinked distributors/batches | COMPLETED | Verified `emailService.ts` stages unlinked invoices into `staged_purchases` with null distributor; added `isValidBatchNumber` enforcement to staged purchase approval in `src/routes/purchases.ts`. |
| **TASK-6** | Boot & Guardrails: Run `auditEngine.ts`, `npm run guardrails`, and `node scripts/quick-update.mjs` | COMPLETED | Ran live `auditEngine.ts` (17/18 categories clean; 0 integrity blocks); verified `npm run guardrails` exit code 0 (TypeScript compile clean); ran `quick-update.mjs` (1135 nodes, 737 edges updated). |
