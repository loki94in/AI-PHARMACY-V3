# Implementation Plan: Daily Operational Briefing Noise & Blank Medicine Cleanup

## Overview
Removes redundant and unnecessary badges (such as `• in_store Order`) from the Morning Operational Briefing sent to the store owner's WhatsApp, streamlines external order channels (e.g. `• WhatsApp`), and ensures that empty/whitespace medicine names fall back cleanly to `medicine_name` or `'Unspecified Item'` so placeholders like `-  × 4 (Pending)` never appear.

---

## Tasks Checklist

- [x] **Task 1: Sanitize Order Source Resolution in `refillService.ts`**
  - Omitted `orderSource` badge when `rawSrc` is `'in_store'`, empty, or default.
  - Mapped external channels cleanly without redundant "Order" suffix (`'WhatsApp'`, `'Website'`, `'Online'`).
  - Rendered customer badge conditionally: `${itemCountLabel}${sourceSuffix}` in Detailed Template (`src/services/refillService.ts`).
  - Rendered customer badge conditionally in Compact Template: `${itemCountLabel}${srcTag}` (`src/services/refillService.ts`).

- [x] **Task 2: Fix Missing / Empty Medicine Name Resolution**
  - Updated `activeOrders` SQL query to select `medicine_name` alongside `product`.
  - Resolved medicine name safely: `(o.product || o.medicine_name || '').trim() || 'Unspecified Item'`.
  - Updated `pendingShortages` SQL query to select `medicine_name` alongside `product`.
  - Guaranteed shortage items never print empty leading text before `× qty`.

- [x] **Task 3: Automated Verification & Unit Test**
  - Tested both Detailed and Compact briefing generation with in-store orders, multi-item orders, WhatsApp orders, and empty `product` fields.
  - Verified with `npx tsx tests/runDailyBriefingVerification.ts` (All assertions passed).
  - Verified full TypeScript compilation: `npx tsc --noEmit` exited 0 with no errors.

---

## Progress Log
- **2026-10-02**: All tasks completed. `refillService.ts` cleaned up surgically without breaking any existing workflow or pipeline.
