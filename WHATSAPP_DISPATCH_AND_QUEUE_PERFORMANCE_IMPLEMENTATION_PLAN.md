# WhatsApp Dispatch & Queue Performance Zero-Latency Implementation Plan

## Objective
Eliminate slow loading and loading spinners when opening the WhatsApp Dispatch page (`/dispatch`) and WhatsApp Queue controller popover in the installed Electron application. Make page transitions and popover opens virtually instant (<50ms) by replacing synchronous backend ETL with fast indexed reads, pre-warming routes during idle time, and adding module-level caching.

---

## Tasks Checklist

- [x] **TASK 1 — Backend Fast-Read Architecture for Dispatch Reminders**
  - Added `getTodayDistributorRemindersFast()` in `src/services/distributorDispatchReminderWorker.ts` with direct indexed SQLite queries (<10ms) and indexes `idx_dist_disp_rem_date` and `idx_dist_disp_rem_date_name`.
  - Updated `GET /api/dispatch/distributor-reminders/today` in `src/routes/dispatch.ts` to use fast-read by default, only triggering deep `syncTodayActiveDistributors()` when `forceSync=true`.
  - Broadcasts `dispatch_updated` via `eventService` on sync so frontend updates seamlessly.

- [x] **TASK 2 — Client-Side Module Cache for Dispatch Reminders**
  - Added `getDispatchRemindersCache()`, `setDispatchRemindersCache()`, and `clearDispatchRemindersCache()` to `frontend/src/utils/pageModuleCaches.ts`.
  - In `frontend/src/pages/Dispatch/index.tsx`, hydrated `distributorReminders` immediately from module cache so `loadingDistributorReminders` starts as `false` when cache exists.
  - Linked manual refresh button to pass `forceSync=true` for human-in-the-loop manual resync.

- [x] **TASK 3 — Route Pre-warming & Chunk Preload for Dispatch & Queue Popover**
  - Added `'/dispatch'` to `WARMUP_PATHS` in `frontend/src/App.tsx` so `/dispatch` mounts into `KeepAliveOutlet` during idle time.
  - Preloaded `WhatsAppQueuePopover` bundle chunk into browser V8 memory during idle warmup in `App.tsx`.
  - Added `onMouseEnter` preloading handlers on all WhatsApp Queue buttons (`Layout.tsx`, `DispatchWhatsAppProgressCard.tsx`, `AutomationHubPopover.tsx`).

- [x] **TASK 4 — Instant Hydration & De-duplication for WhatsApp Queue Popover**
  - Seeded initial state in `frontend/src/components/WhatsAppQueuePopover.tsx` from `peekWhatsAppQueueStatusCache(30000)` so `loading` is false on open.
  - Deferred the 150-record `fetchSentRegister()` query so it only fires when the user switches to the `'register'` tab.
  - Reused `Layout.tsx`'s fresh queue cache instead of double-querying `/whatsapp/queue/status`.

- [x] **TASK 5 — Guardrails, Verification & Benchmarks**
  - Ran `npm run guardrails` — passed with 0 violations (`tsc --noEmit` OK, speed architecture verified).
  - Ran `node scripts/quick-update.mjs` — updated knowledge graph (1,111 nodes, 544 edges in 4.6s).
  - Verified human-in-the-loop controls remain available for manual refresh and custom adjustments.

---

## Task Progress & Execution Log

- **TASK 1**: Decoupled the heavy synchronous ETL pipeline in `syncTodayActiveDistributors` from the standard `GET /distributor-reminders/today` endpoint. Implemented `getTodayDistributorRemindersFast()` which reads cached reminder rows and aggregates notifications and order previews in <10ms without performing full-table substring scans across `action_logs` and `emails`.
- **TASK 2**: Implemented module-level caching in `pageModuleCaches.ts` (`getDispatchRemindersCache`, `setDispatchRemindersCache`, `clearDispatchRemindersCache`) and hydrated `Dispatch` state on mount to eliminate the reminder loading skeleton on page switch.
- **TASK 3**: Added `/dispatch` to the idle `WARMUP_PATHS` array in `App.tsx`. Added proactive module chunk preloading for `WhatsAppQueuePopover` during idle warmup and on button hover (`onMouseEnter`/`onFocus`).
- **TASK 4**: Eliminated initial popover spinner by instant-hydrating from `peekWhatsAppQueueStatusCache(30000)`. Removed eager 150-item sent register querying from mount, deferring it to the `register` tab.
- **TASK 5**: Performance guardrails passed cleanly. Knowledge graph refreshed. Ready for production usage.

