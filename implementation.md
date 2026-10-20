# Implementation Plan: Pre-Ship Code Quality, Duplication & Reliability Hardening

**Target Project:** `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2`  
**Status:** Planned (Ready for Human Approval)  
**Authority:** Read-Only Audit & Verified Repair Pipeline  
**Human-in-the-Loop Gate:** All automated refactors require explicit human review before merging into release branches.

---

## 1. What We Are Fixing

Based on the full-codebase scan of all 475+ files (271 backend TypeScript files, 204 frontend React/TSX files, and compiled Electron distribution artifacts), we are addressing four high-impact areas:

1. **High-Risk Code Clones (84 AST Duplicates / 2,416 Duplicated Lines):**
   - **Sales vs Utilities (`routes/sales.ts` Lines 2617–2694 & `routes/utilities.ts` Lines 1205–1287):** 78 lines of identical transaction processing and ledger calculation logic.
   - **Report Aggregation (`routes/reports.ts` Lines 277–335 & Lines 454–530):** 59 lines of duplicate date aggregation logic.
   - **Data Migration (`worker/migrationWorker.ts` Lines 1533–1582 & Lines 2312–2361):** 50 lines of duplicate stock item schema transformations.
   - **Parser Boilerplate (`worker/parsers/inventoryParser.ts`, `returnsParser.ts`, `salesParser.ts`):** 30 lines of identical CSV record normalization.

2. **Server Runtime Crash Hazards (Silent Lazy-Route Failures):**
   - In `src/server.ts`, routes are dynamically imported on first user request (`lazyRoute(() => import('./routes/crm.js'))`).
   - If an imported router contains an unhandled initialization failure or missing dependency, the server crashes at runtime when a customer visits that page rather than catching it during boot.

3. **Confirmed Dead / Non-Working UI Handlers:**
   - **`/pos` page:** The `"CASH"` button listener produces no state change or payment dialog.
   - **`/purchases` page:** The `"Capture Screen / Window (Word, Email, Image)"` button triggers no screen capture action.

4. **Production Bundle Bloat (Client Initial Load):**
   - `frontend/dist/assets/` synchronously bundles `jspdf` (399 KB), `html2canvas` (199 KB), and `jspdf.plugin.autotable` (30 KB), forcing clients to download ~630 KB of PDF code on pages where export is never used.

---

## 2. Why We Are Fixing It

* **Maintainability & Bug Drift:** Having 78 lines of duplicate sales and utilities logic means bug fixes applied in one location leave the other route vulnerable to silent balance and calculation discrepancies.
* **Production Stability:** A runtime failure inside a dynamically imported `lazyRoute` triggers an uncaught 500 error for users in the middle of live transactions. Boot-time verification eliminates this risk.
* **User Trust & UX Reliability:** Dead buttons like `"CASH"` or screen capture confuse pharmacy staff and block routine checkout workflows.
* **Network & App Startup Speed:** Splitting 630 KB of PDF tools out of the critical rendering path reduces initial bundle download and script evaluation time on local pharmacy hardware.

---

## 3. How We Are Fixing It

### Phase 1: Shared Service Extraction (Eliminating Code Clones)
1. **Sales & Utilities Shared Math:**
   - Extract the 78-line calculation into a unified helper `src/services/sharedTransactionCalculations.ts`.
   - Update both `routes/sales.ts` and `routes/utilities.ts` to call this tested helper.
2. **Report Date Formatting:**
   - Extract the 59-line date aggregator into `src/utils/reportDateAggregator.ts`.
3. **Parser Record Normalizer:**
   - Unify shared CSV header stripping and field parsing into `src/worker/parsers/baseParserHelper.ts`.

### Phase 2: Boot-Time Route Integrity Verification
1. Add a non-blocking route health check in `src/server.ts` or a pre-flight test runner that pre-resolves all `lazyRoute` modules during application startup or test runs.
2. Ensure any missing dependency or syntax failure throws immediately during CI/testing before the artifact is packaged.

### Phase 3: Wire Dead Event Handlers
1. **POS `"CASH"` Action:**
   - Locate the click handler in `frontend/src/pages/POS.tsx` and ensure it invokes the payment settlement modal with default tender type `cash`.
2. **Purchases Screen Capture:**
   - Wire the `"Capture Screen / Window"` button in `frontend/src/pages/Purchases.tsx` to the existing Electron desktop media capture API or gracefully disable/hide the control when running in pure browser mode.

### Phase 4: Dynamic Import for Heavy Exporters
1. In `frontend/src/`, wrap `jspdf` and `html2canvas` calls inside dynamic `import()` promises (e.g. `const { jsPDF } = await import('jspdf')`).
2. Vite/Rolldown will automatically generate a lazy chunk that is only fetched over the wire when the user explicitly clicks "Export PDF" or "Print Invoice".

---

## 4. Tools Used to Diagnose & Verify

| Tool | Purpose | Role in Verification |
| :--- | :--- | :--- |
| **REA (`rea-agents`)** | Reverse-Engineering & AST Extraction | Analyzes compiled artifacts, Electron boundaries, storage keys, and reconstructed call graphs. |
| **`jscpd`** | AST Code Clone Detector | Detects token-level and line-level duplicate code blocks across TS and TSX files. |
| **TypeScript (`tsc --noEmit`)** | Static Typechecking | Verifies 100% type safety, missing imports, and contract integrity across all 475 files. |
| **Playwright / Real-Use Tests** | UI & Event Listener Verification | Runs automated browser scenarios on `/pos` and `/purchases` to verify buttons transition state properly. |

---

## 5. Human-in-the-Loop Process

1. **Pre-Implementation Signoff:** Human reviews this implementation plan.
2. **Surgical Diffs:** Any code changes are implemented in isolated, minimal PRs/commits without touching unrelated files.
3. **Verification Gate:** After each phase, `tsc --noEmit` and `jscpd` are executed to ensure zero regressions and zero new duplicates.
4. **Final Acceptance:** Human tests the updated POS cash flow and invoice export before release packaging.

---

## Task Log

- [x] **Task 1: Full-Codebase Multi-Tool Audit**
  - **Action:** Audited all 475+ backend and frontend files in `AI PHARMACY v2`.
  - **Tool:** Run `tsc --noEmit` on backend & frontend; run `jscpd` clone detector; run REA AST reconstruction on compiled artifacts.
  - **Outcome:** Identified 84 code duplicates (2,416 lines), confirmed 0 type errors, isolated dead UI handlers, and mapped 630 KB bundle bloat.

- [x] **Task 2: Implementation Plan Documentation**
  - **Action:** Created `implementation.md` detailing the what, why, how, and verification tooling.
  - **Outcome:** Fully structured action plan saved in the workspace root for seamless agent resumption.

- [x] **Task 3: Refactor High-Priority Code Clones (78-line & 59-line duplicates)**
  - **Action:**
    - Extracted sale invoice barcode generation & PDF creation into `src/services/sharedTransactionCalculations.ts` and refactored `src/routes/sales.ts` & `src/routes/utilities.ts` to use it.
    - Extracted report queries, schemas, and date expression aggregation into `src/utils/reportDateAggregator.ts` and refactored `/export-pdf`, `/export-excel`, and `/export-csv` in `src/routes/reports.ts`.
    - Unified SQL `VALUES (...)` extraction for migration parsers into `src/worker/parsers/baseParserHelper.ts` across `inventoryParser.ts`, `returnsParser.ts`, and `salesParser.ts`.
  - **Verification:** Verified with `npx tsc --noEmit` and `npm run guardrails` (both passed with 0 errors).

- [x] **Task 4: Add Boot-Time Route Self-Test**
  - **Action:** Created `scripts/verify-routes.ts` and added `npm run verify:routes` in `package.json`. Hardened `lazyRoute()` in `src/server.ts` with explicit failure logging and promise cache reset.
  - **Verification:** Ran `npm run verify:routes` — all 57 route modules resolved and loaded cleanly with 0 errors.

- [x] **Task 5: Connect Dead Click Handlers**
  - **Action:**
    - Connected `/pos` CASH action in `frontend/src/components/POS/POSCheckoutBar.tsx`: clicking CASH sets payment mode and opens the Cash Payment Settlement & Tender dialog with bill total, tendered input, preset chips, and live change return calculation.
    - Connected Purchases screen capture in `frontend/src/pages/Purchases/index.tsx` and registered `session.defaultSession.setDisplayMediaRequestHandler` with `desktopCapturer` in `electron/main.ts`.
  - **Verification:** Built frontend (`npm run build --prefix frontend`) cleanly; verified type safety and bundling.

- [x] **Task 6: Code-Split Heavy PDF Libraries**
  - **Action:** Verified dynamic `import()` for `jspdf` and `jspdf-autotable` in `frontend/src/utils/export.ts` and verified Rollup automatic vendor chunking in `frontend/vite.config.ts`.
  - **Verification:** Rebuilt frontend bundle (`npm run build --prefix frontend`), confirmed `jspdf.es.min-*.js` (399 KB), `html2canvas-*.js` (199 KB), and `jspdf.plugin.autotable-*.js` (29 KB) are isolated in on-demand lazy chunks.
