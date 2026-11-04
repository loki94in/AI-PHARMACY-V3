# DISTRIBUTOR CONTACT SINGLE SOURCE OF TRUTH (EGM REDESIGN PLAN)

## 1. Problem Statement & Multi-Source Audit
The user reported that upon refreshing the Dispatch page, email addresses (e.g. `New Mahalaxmi Agency <newmahalaxmiagency2017@gmail.com>`, `primeayurved539@gmail.com`) and strange 2-to-4 digit numbers (e.g. `2009`, `19`, `025`) appeared in the "Contact Phone" column.

### Multi-Connection Architectural Conflict:
A single UI spot (`CONTACT PHONE` in Dispatch & Cart) currently has **5 divergent data sources** and **6 uncoordinated fallbacks**:
1. **Source 1: `distributors.phone`** — Contaminated during legacy data import (Postgres `pg_dump`) where `row['contact']` held emails and was copied to `phone`. (50 distributors in `data/app.db` currently have emails in `phone`).
2. **Source 2: `distributors.contact`** — Duplicated from `phone` via legacy migrations (`UPDATE distributors SET contact = phone ...`).
3. **Source 3: `distributor_dispatch_reminders.distributor_phone`** — Parallel cache column populated at reminder creation time, which drifts when distributor contacts change.
4. **Source 4: `pharmarack_distributor_mappings.phone`** — Parallel mapping table.
5. **Source 5: `contacts.phone`** — Secondary general contact table.
6. **Rogue Sanitization Fallbacks**: In `distributorDispatchReminderWorker.ts` (lines 248, 441, 1250), ad-hoc regex `.replace(/\D/g, '').slice(-10)` stripped letters from email strings, converting:
   - `devagency2009@gmail.com` $\rightarrow$ `2009` (4 digits)
   - `bajajpharma19@gmail.com` $\rightarrow$ `19` (2 digits)
   - `aarupharma025@gmail.com` $\rightarrow$ `025` (3 digits)
   Because there was no `length === 10` guard, these partial numbers were displayed as valid phone numbers.

---

## 2. Target Single Source of Truth Architecture (Shop Data-Flow Tree Compliance)
Per `AGENT_DATA_FLOW_TREE.md`, every business entity must have **one canonical writer and one single source of truth**:
* **Canonical Entity**: `distributors` table in SQLite.
* **Canonical Field**: `distributors.phone` (strictly 10 digits: `^[6-9]\d{9}$` or 10-digit landline).
* **Strict Email Isolation**: `distributors.email` stores email addresses. `distributors.phone` and `distributors.contact` MUST NEVER store email characters (`@`, `<`).
* **Unified Validation Authority**: `src/utils/phoneValidation.ts` (`normalizePhoneDigits` and `validate10DigitPhone`). Rogue inline `.replace(/\D/g, '')` calls without length checks are strictly prohibited.
* **Truthful UI Fallback**: If `distributors.phone` is missing or not exactly 10 digits, the UI MUST render the amber **`+ Missing Phone`** button. Never display partial numbers, email usernames, or synthetic IDs.

---

## 3. Step-by-Step Implementation Plan

### Step 1: Database Contact Sanitization Migration
* Scan `distributors` in SQLite:
  - If `phone` or `contact` contains `@` or `<`:
    - If `distributors.email` is empty or null, rescue the clean email address into `distributors.email`.
    - Set `phone = ''` and `contact = ''`.
  - If `phone` or `contact` is not empty and has fewer than 10 digits (e.g. `19`, `2009`, `025`):
    - Set `phone = ''` and `contact = ''`.
* Scan `distributor_dispatch_reminders`:
  - If `distributor_phone` contains `@` or `LENGTH(distributor_phone) < 10`:
    - Set `distributor_phone = ''`.
* **Verification Check**: Run SQL query verifying `COUNT(*) === 0` for any `distributors.phone` or `distributor_dispatch_reminders.distributor_phone` containing `@` or with `length < 10`.

### Step 2: Unify Worker & Helper Validation to `src/utils/phoneValidation.ts`
* In `src/services/distributorDispatchReminderWorker.ts`:
  - Replace line 248, 441, 1250 raw `.replace(/\D/g, '').slice(-10)` with `normalizePhoneDigits(val)`.
  - Guard every assignment with `if (digits.length === 10)`.
  - Fix double backslash regex bug on line 441 (`replace(/\\D/g, '')` $\rightarrow$ `normalizePhoneDigits(md.phone)`).
* In `src/utils/distributorSyncHelper.ts`:
  - Update `resolveDistributorContact` and `syncDistributorPhoneAcrossTables` to use `validate10DigitPhone` strictly.
* **Verification Check**: Run `npx tsx tests/distributorDispatchAllDirectory.test.ts` to ensure 100% pass rate.

### Step 3: Frontend Single-Spot Display Hardening
* In `frontend/src/pages/Dispatch/index.tsx`:
  - Replace raw `item.distributor_phone ? <span>...</span> : <button>Missing Phone</button>` with strict 10-digit check:
    ```tsx
    const isValidPhone = item.distributor_phone && /^[0-9]{10}$/.test(item.distributor_phone.replace(/\D/g, ''));
    ```
  - If invalid or containing email characters, immediately render the amber **`+ Missing Phone`** button.
* In `frontend/src/pages/PharmarackCart/index.tsx`:
  - Sanitize distributor option labels in modals so email text never displays in the phone slot.

### Step 4: Human-in-the-Loop Completion Gate (Rule 6)
* When a distributor phone is missing:
  - The UI presents the amber **`+ Missing Phone`** button.
  - Clicking opens the inline 10-digit editor.
  - Real-time duplicate phone validation alerts the store owner if another supplier shares that number (e.g. sister agencies with same delivery rep).
  - Human explicitly clicks "Confirm" / "Save" to commit.
  - The single writer updates `distributors.phone` and broadcasts `dispatch_updated` via SSE so all open tabs update in real time.

---

## 4. Verification & Testing Protocol
1. **Database Audit**:
   - `SELECT COUNT(*) FROM distributors WHERE phone LIKE '%@%' OR (phone != '' AND length(phone) < 10);` $\rightarrow$ must return `0`.
2. **Dispatch Screen Visual Verification**:
   - Verify `DEV AGENCY`, `BAJAJ PHARMA`, `AARU PHARMA`, `NEW MAHALAXMI AGENCY`, `PRIME AYURVED` all display clean yellow `+ Missing Phone` buttons (or verified 10-digit mobile numbers). Zero emails or short numbers.
3. **Automated Guardrails**:
   - `npm run guardrails` must pass with zero violations.

---

## 5. Task Completion Log
- [x] Task 1: Database Contact Sanitization Migration
  - Added auto-healing sanitization queries in `src/database.ts` (`autoHealDistributorPhoneMappings`) for both fast boot and full schema boot.
  - Rescues any email addresses mistakenly sitting in `phone` or `contact` into `distributors.email`.
  - Clears invalid non-10-digit values and email strings from `distributors.phone`, `distributors.contact`, and `distributor_dispatch_reminders.distributor_phone`.
  - Patched legacy pg dump migration in `src/worker/importers/pgMasterImporter.ts` so future imports never map email strings into phone columns.
- [x] Task 2: Backend Phone Normalization Unification
  - Updated `src/services/distributorDispatchReminderWorker.ts` in lines 248, 441, 1250 to strictly enforce 10 digits (`length === 10 && !includes('@') && !includes('<')`).
  - Fixed double backslash regex bug on line 441.
  - Clears `r.distributor_phone` and `item.distributor_phone` if not exactly 10 digits.
- [x] Task 3: Frontend Display Hardening & Human-in-the-Loop Gate
  - Updated `frontend/src/pages/Dispatch/index.tsx` table cell: strictly checks that `item.distributor_phone` has exactly 10 numeric digits and zero `@` or `<` characters. If invalid, renders the amber `+ Missing Phone` button.
  - Updated `frontend/src/pages/PharmarackCart/index.tsx`: prevents display of emails in distributor dropdown options.
  - Preserved the full Human-in-the-Loop phone assignment modal with duplicate detection and confirmation.
- [x] Task 4: End-to-End Verification & Guardrails Run
  - Verified with Jest test suites: `tests/distributorDispatchAllDirectory.test.ts` (3/3 passed), `tests/directOrderDispatchFlow.test.ts` (5/5 passed).
  - TypeScript compilation and Vite build passed with zero errors (`tsc -b && vite build` in 51.58s).
  - Performance Guardrails passed: `PASS — no guardrail violations. Speed architecture intact.`
  - Knowledge graph updated via `node scripts/quick-update.mjs`.

