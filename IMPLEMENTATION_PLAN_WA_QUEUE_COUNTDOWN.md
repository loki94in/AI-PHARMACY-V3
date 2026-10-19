# Implementation Plan: WhatsApp Queue Next-Message Countdown

**Goal:** Show in the app a countdown of when the next queued WhatsApp message will go, after the present message was sent.

**Scope:** Frontend only. No backend changes. No code modifications to existing files. This plan document only.

---

## 1. What already exists (no work needed)

| Item | File | Already provides |
|------|------|------------------|
| Queue ETA / countdown | `src/services/whatsappQueueWorker.ts` (`getWorkerState()`) | `nextDispatchTimestamp`, `nextDispatchCountdownMs`, `nextDispatchCountdownSeconds` |
| Queue status API | `src/routes/whatsappQueue.ts` → `GET /api/whatsapp/queue/status` | Returns countdown fields + counts + `isProcessing`, `isPaused`, `sleeping`, `currentSendingItemId`, `activeTargetName`, `recentItems[]` |
| Frontend API client | `frontend/src/services/api.ts` | `api.getWhatsAppQueueStatus()`, `peekWhatsAppQueueStatusCache(2500ms)` dedupe cache, `WhatsAppQueueStatus` type |
| Live queue controller modal | `frontend/src/components/WhatsAppQueuePopover.tsx` | Full queue controller (pause/resume, send-next-now, flush, retry-failed, edit/delete, sent register) |
| Status polling | `frontend/src/components/Layout.tsx` | Polls queue status every 3s while queue active + tab visible; keeps `peekWhatsAppQueueStatusCache` warm |
| Live events | `src/services/eventService.ts` + `frontend/src/services/events.ts` | `wa_queue_update` SSE → `app-wa-queue-updated` / `sse-wa-queue-updated` DOM events |
| WhatsApp status bar | `frontend/src/components/ConnectedDevicesFooterBar.tsx` | Existing footer bar with WhatsApp sleeping/active/offline pill |

---

## 2. What to build (one thing)

A small, always-visible countdown chip/button showing **"Next message in Ns"** — the time remaining until the next queued WhatsApp message is dispatched after the current send finishes.

Placement: `ConnectedDevicesFooterBar.tsx` (right next to the existing WhatsApp status pill).

Behavior:
- Reads `nextDispatchCountdownSeconds` / `nextDispatchTimestamp` from `peekWhatsAppQueueStatusCache()` (reuses Layout's warm cache — no new poll).
- Subscribes to `sse-wa-queue-updated` / `app-wa-queue-updated` for instant updates (no second `EventSource`, no new network call).
- Ticks down locally from `nextDispatchTimestamp` (client-side countdown).
- Shows truthful states: `sending` (countdown visible), `paused`, `sleeping`, `disconnected`, `idle / no queue`.
- Clicking opens the existing `WhatsAppQueuePopover` modal (do not rebuild the controller).

---

## 3. Files to touch (implementation only — not this plan)

1. `frontend/src/components/ConnectedDevicesFooterBar.tsx` — add countdown chip + click-to-open popover.
2. `frontend/src/components/WhatsAppQueuePopover.tsx` — (optional) ensure countdown is clearly rendered (already partially exists).
3. `frontend/src/services/events.ts` — confirm `whatsappQueueEvent` subscription is available (already exists).

No backend files. No new routes. No new API endpoints.

---

## 4. Contracts to respect (from AGENTS.md)

- **Semantic Tailwind only** — use `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`, `bg-sky`, `text-emerald`, `bg-amber`, `text-amber`, etc. No raw `text-white`, `bg-black/20`, `bg-white/5`.
- **No poll-based WhatsApp wake** — reading queue status does not wake the sleeping browser.
- **Single global SSE connection** — reuse `wa_queue_update`; do not open a second `EventSource`.
- **No mock/simulated data** — real queue state only from the API.
- **No auto-messaging** — countdown is display-only; it does not send patient messages.
- **No second queue processor** — we only read status; we never touch the worker loop.

---

## 5. Verification steps (after implementation)

1. `npm run guardrails` — must pass (performance guardrails).
2. `node scripts/quick-update.mjs` — update the knowledge graph.
3. Manually confirm the countdown decrements and reflects `nextDispatchCountdownSeconds` from `GET /api/whatsapp/queue/status`.

---

## 6. Done definition

User can see in the app, in one always-visible place, the seconds remaining until the next queued WhatsApp message is sent after the current message finishes, with truthful paused/sleeping/disconnected states, and can open the full queue controller from it.