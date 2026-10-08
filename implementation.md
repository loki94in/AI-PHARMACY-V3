# Implementation Plan: Install tester-army/e2e & Live On-Screen Walkthrough of All 24 Primary Pages

## 1. Objective
Install and integrate **`tester-army/e2e`** (`https://github.com/tester-army/e2e`) with `@e2e-dev/web` into the AI Pharmacy project.
Configure a 100% deterministic, zero-token-cost E2E testing pipeline that opens a visible browser window on the screen (`--headed` mode) and executes an interactive walkthrough across all 24 primary application pages and global modals.

---

## 2. User Selections & Scope
- **Framework & Engine**: `e2e` (v0.18.0) + `@e2e-dev/web` (v0.13.0) via Playwright Chromium.
- **Mode Selected**: Deterministic E2E Suite (Zero AI API key required, zero token cost, 100% reliable on-screen live automation).
- **Target Scope**: All 24 Primary App Pages on-screen walkthrough + interactive POS and global modal flows.
- **Server Target**: Live backend & SPA at `http://127.0.0.1:5174` (with `reuseExisting: true`).
- **Display Mode**: Visible Chromium desktop window (`--headed --workers 1`, `1366x768` viewport) so the user can watch tests live on their screen.

---

## 3. Architecture & File Structure
1. **`package.json`**:
   - Install `e2e` and `@e2e-dev/web` as `devDependencies`.
   - Add scripts:
     - `"test:e2e"`: `"e2e run"`
     - `"test:e2e:headed"`: `"e2e run --headed --workers 1"`
     - `"test:e2e:live"`: `"e2e run --headed --workers 1"`
2. **`e2e.config.ts`**:
   - Root E2E config targeting `http://127.0.0.1:5174`.
   - Setup for deterministic testing without mandatory AI models.
   - Configured viewport and launch timeouts.
3. **`tests/` Test Suites**:
   - `tests/all-pages-live.e2e.ts`: Walks through all 24 primary pages, asserting header/DOM rendered, no ErrorBoundary crashes.
   - `tests/pos-live.e2e.ts`: Interactive POS billing flow (medicine fast search, cart rows, total pricing).
   - `tests/modals-live.e2e.ts`: Global interactive modals (Quick Order `Alt+O`, Quick Assist `Alt+A`, Shortcuts `?`).
4. **Guardrails & Knowledge Graph**:
   - Automated guardrail checks (`npm run guardrails`).
   - Sync knowledge graph (`node scripts/quick-update.mjs`).

---

## 4. Verification & Success Criteria
1. Dependencies `e2e` and `@e2e-dev/web` install cleanly without package conflicts.
2. `e2e.config.ts` loads with `satisfies E2EConfig`.
3. `npx e2e list` detects all test files without errors.
4. `npm run test:e2e:headed` launches a real visible Chromium browser window on screen, executes all test steps live, and passes with 100% success.
5. All 24 primary pages are verified live without ErrorBoundary or page crashes.
6. `npm run guardrails` exits 0.
7. `node scripts/quick-update.mjs` finishes with updated graph nodes and edges.
8. Human-in-the-loop verification completed.

---

## 5. Tasks & Progress Tracker
- [ ] **Task 1: Install `e2e` and `@e2e-dev/web` Dependencies**
  - **Status**: Pending
  - **Details**: Run `npm install --save-dev e2e @e2e-dev/web`.
- [ ] **Task 2: Configure `e2e.config.ts`**
  - **Status**: Pending
  - **Details**: Create root `e2e.config.ts` declaring web target on `http://127.0.0.1:5174`.
- [ ] **Task 3: Implement Live On-Screen Test Suites in `tests/`**
  - **Status**: Pending
  - **Details**: Create `tests/all-pages-live.e2e.ts`, `tests/pos-live.e2e.ts`, and `tests/modals-live.e2e.ts`.
- [ ] **Task 4: Add NPM Scripts to `package.json`**
  - **Status**: Pending
  - **Details**: Add `"test:e2e"` and `"test:e2e:headed"` / `"test:e2e:live"`.
- [ ] **Task 5: Execute Live Headed Test Run on Screen & Verify Results**
  - **Status**: Pending
  - **Details**: Run `npm run test:e2e:headed` and observe visible execution.
- [ ] **Task 6: Performance Guardrails & Knowledge Graph Synchronization**
  - **Status**: Pending
  - **Details**: Run `npm run guardrails` and `node scripts/quick-update.mjs`.
- [ ] **Task 7: Human-in-the-Loop Review**
  - **Status**: Pending
  - **Details**: Present live test results, artifacts, and controls to user.
