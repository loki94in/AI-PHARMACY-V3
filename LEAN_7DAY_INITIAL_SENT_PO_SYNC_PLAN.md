# Lean 7-Day Initial & Background Sent PO Sync Implementation Plan

## Problem Statement
On a new PC or first sync, fetching 30 to 60 days of historical orders triggers up to 100-250 sequential API requests to `pharmretail-api.pharmarack.com`. This causes unnecessary server load, risks 403/429/406 rate-limit rejections, and delays the initial sync experience.
For regular pharmacy operations (reorder checking, duplicate order prevention, dispatch reminders, today's deliveries), only the past 7 days (last week) of historical data is required.

---

## User Review Required

> [!IMPORTANT]
> The initial and automatic background historical sync will focus on the last 7 days (last week).
> Manual sync via the UI button will also default to 7 days for quick, ban-safe execution (< 3s), while still supporting an explicit deeper sync if needed.
> Past orders do not trigger WhatsApp notifications (WhatsApp notifications remain strictly gated to today's orders in `syncPharmarackOrders()`).

---

## Step-by-Step Changes

### Phase 1: Update Default Sync Window & Pacing in Backend
- File: `src/services/pharmarackOrderSyncService.ts`
  - Change default `days` parameter in `syncHistoricalPharmarackOrders(days = 7, force = false)` from 30 to 7.
  - In `syncPharmarackOrders()`, call `syncHistoricalPharmarackOrders(7, false)` instead of 30.
  - In `runHistoricalSync(days = 7)`:
    - Default `days` capped between 1 and 14 for automatic runs (max 30 if explicitly passed with `force=true`).
    - Add a polite 100ms-150ms delay between `fetchOrderLines` calls when multiple orders need lines populated.
    - Set app setting `pharmarack_initial_history_synced_at = Date.now()` once completed.
- File: `src/AGENTS.md`
  - Update line 303 contract description to reflect the 7-day initial/catch-up window.

### Phase 2: Update Backend Route Handler
- File: `src/routes/pharmarack.ts`
  - In `POST /api/pharmarack/sync-historical-orders`:
    - Default `days` to `7` instead of 30 (`parseInt(req.body?.days as string, 10) || 7`).

### Phase 3: Update Frontend Sync Button
- File: `frontend/src/pages/PharmarackCart/index.tsx`
  - In `handleSyncHistoricalOrders`, request `{ days: 7 }` by default for fast, safe sync.

### Phase 4: Verification & Guardrails
- Run `npm run guardrails` (`tsc --noEmit`, speed architecture rules).
- Verify in test script that 7-day sync runs smoothly in < 3s with zero errors.
- Run `node scripts/quick-update.mjs` to keep knowledge graph up to date.

---

## Tasks Progress

- [x] Task 1: Update `src/services/pharmarackOrderSyncService.ts` (default 7 days, polite line fetch pacing, settings stamp)
- [x] Task 2: Update `src/routes/pharmarack.ts` (`POST /api/pharmarack/sync-historical-orders` default 7 days)
- [x] Task 3: Update `src/AGENTS.md` contract
- [x] Task 4: Update `frontend/src/pages/PharmarackCart/index.tsx` (request 7 days)
- [x] Task 5: Verify via `npm run guardrails` and update knowledge graph via `node scripts/quick-update.mjs`
- [x] Task 6: Final Human-in-the-Loop review and report
