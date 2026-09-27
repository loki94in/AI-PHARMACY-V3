# Implementation Plan: Fix PrefillMed Rate Type Safety in POS

## Problem Summary
The TypeScript compiler flags an error in `frontend/src/pages/POS/index.tsx` at lines 1606, 1607, and 1610:
`Property 'rate' does not exist on type 'PrefillMed'.`

In `frontend/src/pages/POS/index.tsx`, when populating an unallocated cart row from prefill state (e.g. from Website Orders where `rate` is provided):
```typescript
mrp: Number(med.mrp || med.sell_price || med.rate || 0),
sell_price: Number(med.sell_price || med.mrp || med.rate || 0),
unitPrice: Number(med.sell_price || med.mrp || med.rate || 0),
```
`med` is typed as `PrefillMed`, but `interface PrefillMed` is missing the optional `rate?: number | string;` declaration.

## Planned Changes
- [x] Task 1: Add `rate?: number | string;` to `interface PrefillMed` in `frontend/src/pages/POS/index.tsx`. (Completed: line 312 added).
- [x] Task 2: Verify with `npm run guardrails` (`tsc --noEmit`). (Completed: 0 errors, PASS).
- [x] Task 3: Update knowledge graph via `node scripts/quick-update.mjs`. (Completed).

## Completion Summary
- Declared `rate?: number | string;` on `interface PrefillMed` in [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx#L290-L317).
- Resolved IDE problem with `Property 'rate' does not exist on type 'PrefillMed'`.
- All TypeScript compiler checks (`tsc --noEmit`) and performance guardrails pass cleanly with 0 errors.
