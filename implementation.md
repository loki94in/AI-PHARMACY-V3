# Implementation Plan: Fix Vite JSX Parse Error in Purchases Page

## 1. Problem Statement & Root Cause

### Observed Problem
Vite build and dev server failed to transform [Purchases/index.tsx](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx) with:
```text
[PARSE_ERROR] Expected `,` or `}` but found `&&`
╭─[ src/pages/Purchases/index.tsx:4686:29 ]
│
4686 │         {showLowStockPicker && <LowStockPickerModal
│         ┬                   ─┬
│         ╰─────────────────────── Opened here
│                              │
│                              ╰── `,` or `}` expected
──────╯
```
Also noted in user prompt:
`[TokenRefreshScheduler] Removed stale lock file: E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2\.wwebjs_auth\session\devtoolsactiveport` - This is an expected startup informational log from `src/services/tokenRefreshScheduler.ts` cleaning orphaned Chrome locks during normal boot.

### Root Cause
In [Purchases/index.tsx](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx) (around lines 4684–4700), the conditional rendering block for `LowStockPickerModal` was accidentally nested inside `{isUniversalModalOpen && (` without an enclosing JSX fragment or separate block. The inner `{showLowStockPicker && <LowStockPickerModal ... />}` was evaluated as an invalid object literal inside the JSX expression, throwing `[PARSE_ERROR] Expected ',' or '}' but found '&&'`.

---

## 2. Proposed Changes

In [Purchases/index.tsx](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx):
- Decouple `{showLowStockPicker && (<LowStockPickerModal ... />)}` from `{isUniversalModalOpen && (` so both modals exist as independent, valid JSX blocks.
- Ensure all closing tags and brackets match cleanly.

---

## 3. Verification Plan
1. **Frontend Type Check**:
   - Run `npx tsc -b frontend` to verify 0 syntax or type errors in `Purchases/index.tsx`.
2. **Performance Guardrails**:
   - Run `npm run guardrails` to confirm clean pass.
3. **Knowledge Graph Sync**:
   - Run `node scripts/quick-update.mjs`.

---

## 4. Tasks Completed & Progress Tracker
- [x] Task 1: Fix JSX syntax error in [Purchases/index.tsx](file:///E:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx) by decoupling `LowStockPickerModal` from `isUniversalModalOpen`.
  - *Completed*: Separated `{showLowStockPicker && (<LowStockPickerModal ... />)}` into its own standalone conditional block, leaving `{isUniversalModalOpen && (<UniversalMedicineEditModal ... />)}` intact.
- [x] Task 2: Verify TypeScript compilation and Vite build (`npx tsc -b frontend`).
  - *Completed*: `npx tsc -b frontend` exited with code 0 and 0 errors.
- [x] Task 3: Run performance guardrails (`npm run guardrails`) and synchronize knowledge graph (`node scripts/quick-update.mjs`).
  - *Completed*:
    - `npm run guardrails`: 0 violations, speed architecture intact.
    - `node scripts/quick-update.mjs`: Knowledge graph synchronized (1125 nodes, 733 edges).
