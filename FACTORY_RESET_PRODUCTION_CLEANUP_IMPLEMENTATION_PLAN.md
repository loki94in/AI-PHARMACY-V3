# Factory Reset & Default Settings Production Cleanup Implementation Plan

## Problem Summary & Root Cause Analysis
When executing a **Factory Reset** in the application, the system resets all tables and re-executes `ensureSchema()` in [src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts). During this initialization, specific development/test data was automatically seeded into the database, causing production users to see hardcoded links and numbers instead of a clean, unconfigured state.

### Identified Root Causes:
1. **Hardcoded Google Maps URL in Database Defaults**:
   - In [src/database.ts#L3767](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L3767):
     ```typescript
     await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('google_maps_url', 'https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8')");
     ```
     This seeded a specific testing/personal Google Maps link directly into the database on every fresh install or factory reset.
2. **Hardcoded Google Maps URL in Default WhatsApp Message Templates**:
   - In [src/database.ts#L4026](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L4026) and [src/database.ts#L4041](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts#L4041):
     The `Store Location & Directions` starter template contained hardcoded text:
     `'Hello {{name}}, our pharmacy is located at:\n📍 https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8\nWe look forward to serving you!'`
3. **Hardcoded UI Input Placeholder**:
   - In [frontend/src/pages/Settings/index.tsx#L701](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Settings/index.tsx#L701):
     Input placeholder was explicitly set to `placeholder="https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8"`.
4. **Hardcoded Legacy Phone Numbers & Fallbacks**:
   - In [src/routes/settings.ts#L138](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/settings.ts#L138) and [src/routes/settings.ts#L192](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/settings.ts#L192):
     `phone = "918080888041"` was hardcoded in SQL update queries.
   - In [src/services/cloudCatalogSyncService.ts#L44](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/cloudCatalogSyncService.ts#L44):
     `whatsapp: storeMap['pharmacy_whatsapp'] || '919876543210'` fell back to a dummy number.

---

## Completed Tasks & Implementation Details

### Task 1: Clean Up Database Default Seeds ([src/database.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/database.ts)) — COMPLETED
- [x] Changed `google_maps_url` default seed from `'https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8'` to `''` (empty string).
- [x] Added automated self-healing query on boot to clear out `'https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8'` from `app_settings` if present.
- [x] Updated starter template `Store Location & Directions` to remove the hardcoded URL and use `{{google_maps_url}}` dynamic variable.
- [x] Added automated template migration to replace legacy hardcoded links with `{{google_maps_url}}`.
- **How it was completed**: Modified `src/database.ts` lines 3767-3769 and lines 4026-4048. Sanitized existing records in `data/app.db`.

### Task 2: Clean Up Hardcoded Numbers in Backend Services — COMPLETED
- [x] In [src/routes/settings.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/settings.ts): Removed hardcoded `phone = "918080888041"` check; saving store phone now cleanly synchronizes with store #1 and updates all phone alias keys. Added complete address alias synchronization (`address`, `shop_address`, `store_address`, `pharmacy_address`).
- [x] Added `getStoreAddress(dbInstance?: any)` in [src/services/storeSettingsService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/storeSettingsService.ts).
- [x] In [src/services/cloudCatalogSyncService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/cloudCatalogSyncService.ts): Replaced fallback `'919876543210'` and `'Pune City Pharmacy'` with dynamic lookups from `storeSettingsService`.
- **How it was completed**: Modified `src/routes/settings.ts`, `src/services/storeSettingsService.ts`, and `src/services/cloudCatalogSyncService.ts`.

### Task 3: Clean Up Frontend Placeholders ([frontend/src/pages/Settings/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Settings/index.tsx)) — COMPLETED
- [x] Changed Google Maps placeholder from `'https://maps.app.goo.gl/g9qcbTXcycFqe8Zw8'` to clean neutral hint `placeholder="https://maps.app.goo.gl/your-store-location"`.
- [x] Synchronized `shop_address` and `store_address` in form initialization and payload save handlers (`handleSaveStoreProfile` and `handleApplyStudioSettings`).
- **How it was completed**: Modified `frontend/src/pages/Settings/index.tsx`.

### Task 4: Automated Verification & Guardrails — COMPLETED
- [x] Ran `npm run guardrails` — TypeScript compilation (`tsc --noEmit`) OK, 0 rule violations, performance and security verified.
- [x] Ran `node scripts/quick-update.mjs` — 3D Knowledge graph and audit documents refreshed cleanly.
