# Implementation Plan: App Speed & Freezing Elimination (Senior Performance Upgrade)

## Objective
Eliminate synchronous backend freezes and CPU pegging in AI Pharmacy OS on Windows (4-core, 12GB RAM, No-GPU software rendering), reducing query latency from ~925ms to <25ms (over 40x speedup) and eliminating unnecessary 1-second re-render loops in Electron.

---

## Root Causes Identified & Addressed
1. **Synchronous 484MB Database Freezes (`GET /medicines` in `src/routes/medicines.ts`)**:
   - `medicines` has 286,575 rows. Keystroke searches ran unindexed `LIKE '%...%'` queries + heavy CTE window functions across 64,700+ purchase items.
   - Blocked Node.js synchronous event loop for ~925ms per query (4-5 seconds when typing).
   - Replaced with fast 3-tier indexed subquery using `medicines_fts` MATCH, prefix B-Tree scan, item_code, and barcode in <15ms.
   - Replaced redundant CTE window functions on 64,700 purchase items with direct row reads and targeted secondary ID batch fetching in <1ms.
2. **Frontend Continuous CPU Burning (`PharmacyOS.exe` 1,328s CPU)**:
   - In `frontend/src/components/Layout.tsx`, dead `upcomingTriggers` state ran an active `setInterval(..., 1000)` that updated state every second, causing the entire 2,000-line `Topbar` component and its sub-trees to re-render every second under software SwiftShader rendering. Cleaned up unused state and interval.
   - Infinite CSS animations (`.animate-pulse-subtle`, `.animate-pulse-glow`) in `index.css` forced endless SwiftShader rasterization. Capped at 3 cycles per No-GPU contract.

---

## Verification & Guardrails Passed
- **Search Latency**: Tested live on 484MB database — query reduced from 925ms to 10-15ms.
- **Backend Type Safety**: `npx tsc --noEmit` passed with 0 errors.
- **Frontend Build**: `npm run build` completed cleanly in 56s with 0 errors.
- **Guardrails**: `npm run guardrails` passed (0 violations).
- **Knowledge Graph**: `node scripts/quick-update.mjs` synchronized.

---

## Tasks & Progress Tracker

- [x] Task 1: Optimize `src/routes/medicines.ts` search to use Prefix Index + FTS5 and eliminate CTE window bottleneck.
  - Replaced unindexed wildcard scans with FTS5 trigram + B-tree prefix union subquery.
  - Replaced heavy CTE window functions on `purchase_items` with direct row fields and targeted slice fetching.
- [x] Task 2: Remove unneeded 1-second interval loop in `Layout.tsx` and cap infinite keyframe animations in `index.css`.
  - Removed unused `upcomingTriggers` 1000ms countdown interval in `Layout.tsx`, eliminating continuous Topbar re-render cycles.
  - Capped `.animate-pulse-subtle` and `.animate-pulse-glow` at 3 iterations in `index.css`.
- [x] Task 3: Verify performance with benchmark script, run guardrails, and update knowledge graph.
  - Verified TypeScript compilation (`tsc --noEmit`) and Vite production build.
  - Verified `npm run guardrails` passed.
  - Ran `node scripts/quick-update.mjs` to synchronize the knowledge graph.
