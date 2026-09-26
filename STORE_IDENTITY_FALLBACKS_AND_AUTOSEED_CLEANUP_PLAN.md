# Store Identity Fallbacks & Auto-Seed Cleanup Implementation Plan

## Problem & Root Cause Investigation

The user identified that when resetting or opening settings, personal/test store details (such as the store name **"TANMAY MEDICAL"**, phone number **"8080888041"**, address **"SHOP NO 1, LAXMI COMPLEX, SHINDEWADI"**, GSTIN, and owner WhatsApp number) reappeared or remained present. The application must be usable on **any PC** out of the box in production without leaking test data.

### Root Causes Discovered:

1. **Auto-Injection on WhatsApp Connection ([src/whatsappClient.ts#L1145-1161](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/whatsappClient.ts#L1145-1161))**:
   - When WhatsApp connected, if `owner_whatsapp_number` or `shop_phone` was empty in `app_settings`, the client automatically wrote the connected phone number (`8080888041`) into `app_settings.owner_whatsapp_number` and `app_settings.shop_phone`.
   - As a result, whenever the test WhatsApp session connected, it silently re-populated the test phone number into the settings!
2. **Hardcoded Fallbacks in Source Code**:
   - [src/whatsappClient.ts#L650](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/whatsappClient.ts#L650):
     `const storeName = (await getConfiguredPharmacyName(db)) || 'Tanmay Medical';`
   - [src/services/paymentQrService.ts#L183-185](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/paymentQrService.ts#L183-L185):
     `return row?.value || 'TANMAY MEDICAL';`
     `return 'TANMAY MEDICAL';`
3. **Hardcoded Address in Default Store Seed ([src/database.ts#L3674](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L3674))**:
   - `INSERT OR IGNORE INTO stores (id, name, code, address, phone, is_central, is_active) VALUES (1, 'Main Store', 'STORE-A', 'Main Pharmacy Counter', '', 1, 1)`
   - Injected `'Main Pharmacy Counter'` as address instead of an empty string `''`.
4. **Current Database Content in `data/app.db`**:
   - Contained historical test keys: `shop_name`, `shop_phone` (`8080888041`), `shop_address` (`SHOP NO 1,GR FLR,LAXMI COMPLEX, SHINDEWADI,MAHAD PHATA`), `shop_gstin` (`21521192000393`), `shop_dl_no` (`20-454028...`), `shop_email` (`tanmaymedical637@gmail.com`), and store name `'TANMAY MEDICAL'` in `stores`.

---

## Completed Tasks & Implementation Details

### Task 1: Disable Auto-Populating Store Phone & Owner Phone from Connected WhatsApp — COMPLETED
- [x] Removed lines in [src/whatsappClient.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/whatsappClient.ts) that automatically inserted the connected session phone number into `owner_whatsapp_number` and `shop_phone`.
- [x] `whatsapp_connected_number` is retained exclusively for internal connection diagnostics without polluting store profile settings.
- **How it was completed**: Removed the auto-injection block from `whatsappClient.ts` lines 1145-1161. Store phone and owner contact now strictly remain empty until human-configured.

### Task 2: Remove Hardcoded Store Names in Source Code — COMPLETED
- [x] In [src/whatsappClient.ts#L650](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/whatsappClient.ts#L650): Replaced `'Tanmay Medical'` fallback with dynamic `await getStoreMedicalName(db)`.
- [x] In [src/services/paymentQrService.ts#L183-185](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/paymentQrService.ts#L183-L185): Replaced `'TANMAY MEDICAL'` with dynamic `await getStoreMedicalName(db)`, falling back to `'AI Pharmacy'`.
- **How it was completed**: Replaced hardcoded strings with calls to `getStoreMedicalName(db)` in `whatsappClient.ts` and `paymentQrService.ts`.

### Task 3: Clean Default Store Seed & Add Auto-Purge of Test Data on Boot — COMPLETED
- [x] In [src/database.ts#L3674](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L3674): Changed default store seed address to `''` and default name to `'AI Pharmacy'`.
- [x] Added startup purge queries in [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts) that automatically wipe test store names (`TANMAY MEDICAL`), test phone numbers (`8080888041`), test addresses (`SHINDEWADI`), test GSTIN (`21521192000393`), test DL numbers, and test emails.
- **How it was completed**: Updated `src/database.ts` lines 3672-3715 and executed database sanitization on `data/app.db`.

### Task 4: Automated Verification & Guardrails — COMPLETED
- [x] Verified `data/app.db`: Store phone, owner phone, address, GSTIN, DL, and email are 100% clean and blank. Store #1 is named `'AI Pharmacy'` with blank address and phone.
- [x] Ran `npm run guardrails` — TypeScript compilation (`tsc --noEmit`) OK, 0 rule violations.
- [x] Ran `node scripts/quick-update.mjs` — Knowledge graph synchronized.
