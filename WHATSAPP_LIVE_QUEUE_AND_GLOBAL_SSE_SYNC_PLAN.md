# Implementation Plan: WhatsApp Live Queue Controller Real-Time In-Memory Updates & Global SSE Pipeline Fix

## Purpose
Fix the issue where the WhatsApp Live Queue Controller popover and 22+ pages across the application did not update live on screen while messages were actively sending in the background, requiring closing and reopening or manual navigation to see updated statuses and timestamps.

---

## Root Causes Identified
1. **Global SSE Burst Throttle Dropping Custom Events (`useGlobalSseInvalidation.ts`):**
   An early `return;` inside `if (now - last < 1500) return;` at the query invalidation stage aborted the `onmessage` handler entirely, preventing all subsequent DOM CustomEvents (`sse-wa-queue-updated`, `app-wa-queue-updated`, `refresh-special-orders`, `refresh-refills`, `refresh-pharmarack-cart`, etc.) from being dispatched during message sending bursts.
2. **Stale Cache Fallback in `WhatsAppQueuePopover.tsx`:**
   `fetchStatus` defaulted to `forceBypassCache = false`, which picked up stale 2.5s cached responses from background polling instead of querying fresh database truth on user actions and popover mount.
3. **Missing Instant In-Memory State Transitions:**
   `WhatsAppQueuePopover.tsx` lacked optimistic in-memory mutators for active items. As items transitioned from pending -> sending -> sent / failed, the rows in `recentItems` waited solely on async HTTP round-trips rather than updating the UI at 0ms latency.

---

## Proposed Changes

### Task 1: Fix SSE Dispatch Pipeline in `frontend/src/hooks/useGlobalSseInvalidation.ts`
- Eliminate early `return;` on the 1500ms query dedupe.
- Wrap query cache invalidation in `if (now - last >= 1500)` while allowing the remainder of the handler (`ensureCompactInventoryReady()`, sales sync evictions, and `SSE_CUSTOM_EVENTS` dispatching) to execute unconditionally for every SSE frame.

### Task 2: Implement Instant In-Memory Reactive State in `frontend/src/components/WhatsAppQueuePopover.tsx`
- Change `fetchStatus(forceBypassCache = true)` by default.
- In `messageSendEvent.subscribeSendProgress`: extract queue item ID from `detail.id` (e.g. `queue-123`) or match recipient, and immediately update item status to `'sending'` in `queueState.recentItems`, incrementing `counts.sending` and decrementing `counts.pending`.
- Listen to `sse-wa-queue-updated`, `app-wa-queue-updated`, and `app-automation-hub-updated` with detail payload:
  - If `type === 'sent'` and `id`: instantly update item status to `'sent'`, set `sent_at = Date.now()`, decrement `counts.sending`, increment `counts.sent`, and update `todaySummary.sent`.
  - If `type === 'failed'` and `id`: instantly update item status to `'failed_perm'`, set `error_message`, decrement `counts.sending`, increment `counts.failed`.
  - If `type === 'deleted'` and `id`: instantly remove from `recentItems`.
- Update optimistic user action handlers (`handleDeleteItem`, `handleResolveItem`, `handleClearAllFailed`) and pass `forceBypassCache = true`.

### Task 3: Verification & Guardrails
- Run `npm run guardrails` to verify performance rules (P1 "events, not timers", no CPU hogging, no GPU rendering violations).
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
- Verify TypeScript compilation (`tsc --noEmit`).

---

## Tasks & Progress Tracking

- [x] Task 1: Fix SSE dispatch pipeline in `frontend/src/hooks/useGlobalSseInvalidation.ts`
  - *Completed*: Removed early `return;` on `now - last < 1500`. Scoped burst throttling strictly to React Query `invalidateQueries` / `refetchQueries`. All DOM CustomEvents (`sse-*`, `app-*`, `refresh-*`) now dispatch cleanly for every frame without getting dropped. Unpacked nested payloads so `CustomEvent.detail` contains both event type and action IDs.
- [x] Task 2: Implement instant in-memory reactive state and fresh fetching in `frontend/src/components/WhatsAppQueuePopover.tsx`
  - *Completed*: Defaulted `fetchStatus(forceBypassCache = true)` so popover queries live database truth without stale 2.5s cache. Connected `messageSendEvent` and `handleSse` to apply instantaneous in-memory mutations to `queueState.recentItems` and `queueState.counts` (Pending -> Sending -> Sent (timestamp) / Failed). Added optimistic item deletion.
- [x] Task 3: Run guardrails, update knowledge graph, and test compilation
  - *Completed*: `npm run guardrails` passed with 0 violations (`tsc --noEmit` OK, database schema & integrity OK). Knowledge graph updated via `node scripts/quick-update.mjs` (1617 nodes, 913 edges).
