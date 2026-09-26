# Generic Production Architecture — Removal of All Hardcoded Store Names & Strings

## Problem Analysis & Root Cause

In [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts), lines were added attempting to delete or filter specific hardcoded names:
```typescript
AND TRIM(value) != 'TANMAY MEDICAL'
AND TRIM(value) != 'Tanmay Medical'
AND (value = 'XYZ MEDICAL' OR value = 'XYZ Pharmacy' OR value = 'TANMAY MEDICAL' OR value = 'Tanmay Medical')
WHERE id = 1 AND (name = 'TANMAY MEDICAL' OR name = 'Tanmay Medical' ...)
```

### Why Having These Strings in the Code is an Anti-Pattern:
1. **Source Code Pollution**: A generic, white-label production application should NEVER have customer-specific names (like `"Tanmay Medical"`) or legacy placeholder names (`"XYZ Medical"`) hardcoded into SQL queries or filtering logic.
2. **Brittle Architecture**: Blacklisting specific string literals in SQL queries (`WHERE value != 'XYZ' AND value != 'TANMAY'`) fails when a user legitimately names their store something else, or if another test name is used.
3. **Professional Quality**: In production or when releasing the software to multiple independent pharmacies, the source code should be completely clean, neutral, and generic.

---

## Proposed Generic Solution

Instead of hardcoding specific names/strings to blacklist or delete, the system should follow clean architectural principles:

1. **Clean Store Seed**:
   - Default Store #1 is initialized strictly as:
     `INSERT OR IGNORE INTO stores (id, name, code, address, phone, is_central, is_active) VALUES (1, 'AI Pharmacy', 'STORE-A', '', '', 1, 1)`
   - If a custom store name is configured in `app_settings` (`shop_name`, `store_name`, `pharmacy_name`), Store #1's name updates to match the user's configured setting.
2. **Remove All Blacklist Strings from SQL Queries**:
   - Remove `'TANMAY MEDICAL'`, `'Tanmay Medical'`, `'XYZ MEDICAL'`, and `'XYZ Pharmacy'` from [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts), [src/services/storeSettingsService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/storeSettingsService.ts), and [src/utils/auditEngine.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/auditEngine.ts).
   - In [src/services/storeSettingsService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/storeSettingsService.ts), store name resolution simply returns the user-configured value if present, or defaults cleanly to `'AI Pharmacy'`.
3. **Remove Hardcoded Phone Numbers & Regex Sanitizers**:
   - Remove any specific phone literals (`8080888041`, `918080888041`), specific addresses (`SHINDEWADI`), GSTINs, or emails from code.
4. **Remove Scratch/Temporary Scripts**:
   - Delete any leftover scratch scripts like `scripts/sanitize_identity.mjs`.

---

## Step-by-Step Implementation Tasks

### Task 1: Clean [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts)
- [x] Remove hardcoded string blacklists (`!= 'XYZ MEDICAL'`, `!= 'TANMAY MEDICAL'`) from `customNameRow` query.
- [x] Remove specific hardcoded UPDATE / DELETE statements referencing `TANMAY MEDICAL`, `8080888041`, `SHINDEWADI`, etc.
- [x] Keep generic default initialization: Store #1 defaults to `'AI Pharmacy'` with blank address and phone.

### Task 2: Clean [src/services/storeSettingsService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/storeSettingsService.ts) & [src/utils/auditEngine.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/utils/auditEngine.ts)
- [x] Remove all hardcoded string checks (`XYZ MEDICAL`, `XYZ Pharmacy`) from `getConfiguredPharmacyName` and `getStoreMedicalName`.
- [x] Remove hardcoded legacy name filters from `auditSettings` in `src/utils/auditEngine.ts`.
- [x] Simply check `TRIM(value) != ''`. If configured, return it; otherwise return generic fallback `'AI Pharmacy'`.

### Task 3: Remove Leftover Files
- [x] Delete `scripts/sanitize_identity.mjs` and all temporary test scripts.

### Task 4: Automated Verification
- [x] Verified zero occurrences of `TANMAY`, `8080888041`, `XYZ MEDICAL`, `XYZ Pharmacy` in `src/` and `frontend/src/`.
- [x] Run `npm run guardrails` to verify zero violations (PASS).
- [x] Run `node scripts/quick-update.mjs` to refresh the knowledge graph (DONE).
