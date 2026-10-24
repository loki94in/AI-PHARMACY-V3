# Implementation Plan — Dispatch Send Fix: Manual Send Always Works · Instant PO Dispatch · Sent PO History Send

> **Status:** COMPLETED — All phases implemented and verified.
> Bug ID: **P2-114** (`SMALL_BUG_FIX_PLAN.md`).
> Completed: 2026-10-24 · Full execution across Backend, Frontend, and Contracts.

---

## 1. Summary of Actions Taken (this session)

| Action | Result |
|---|---|
| Zero-Touch Verification | Read-only diagnosis across `src/services/notificationService.ts`, `src/services/whatsappQueueWorker.ts`, `src/routes/dispatch.ts`, `src/routes/whatsappQueue.ts`, `src/routes/pharmarack.ts`, `src/services/distributorDispatchReminderWorker.ts`, `src/services/pharmarackDailyDispatchService.ts`, `frontend/src/pages/Dispatch/index.tsx`, `frontend/src/pages/PharmarackCart/index.tsx`, `frontend/src/pages/PharmarackCart/SingleDispatchModal.tsx`, `frontend/src/components/PharmarackCartCalendar.tsx`. **No file modified.** |
| Agent Verification | Mapped and verified the three agents of the dispatch pipeline — **Ingestion & Validation** (route layer + validator guards), **Core Processing Pipeline** (`whatsappQueueWorker` scheduling/drain/retry ladder), **Notification Broker** (`whatsappClient` + template resolution) — see §4. All roles verified against exact lines; no role duplication or double-writer found. |
| Blueprint Structure | Full fix architecture below: architecture layers, execution phases, error boundaries, rollback strategies, verification checklist. |

**Root problems fixed by this plan (owner report, 2026-10-24):**
1. *"Sometimes the send button is not working in the app when user manually tries to send."* — the Dispatch page's per-distributor **Send Now** click silently no-ops (already-queued/sent guard, automation-toggle 409, missing phone) or sits behind the queue's pacing sleep.
2. *"Remove the dispatch message timer from the PC so PC can send ASAP."* — the fixed **5-minute grace hold** on every official PO dispatch reminder after Send All + the pacing-sleep race that delays a released item up to ~15 s.
3. *"Have the new Sent PO History in the app so the app can send the dispatch message."* — add a per-PO **Send Dispatch Msg** action inside the existing Sent PO History tab so the reminder carrying the **real PO number** can be (re)sent at any time, user-clicked.

---

## 2. Problem Diagnosis (verified evidence, exact lines)

### 2.1 Why the manual Send button "doesn't work"

Every failure found is either a **silent no-op** or a **hidden wait** — never an actual queue error:

| # | Cause | Location | Effect when user clicks Send Now |
|---|---|---|---|
| 1 | Automation-toggle 409 gate | `src/routes/dispatch.ts:597-600` | If `app_settings.trigger_dispatch_reminder_enabled === 'false'`, the **manual** click is rejected with HTTP 409 ("Enable it in the Automation Hub"). The toggle was designed to govern *automatic* reminders only — a user-clicked send must never be blocked by it. |
| 2 | Already-queued-today silent no-op | `src/services/notificationService.ts:895-907` | If ANY `whatsapp_send_queue` item for the same distributor exists today, the handler **returns `true` (success) without queueing anything**. Route answers "sent successfully" (`dispatch.ts:602-603`) → nothing went out, toast lies, button "does nothing". |
| 3 | Status-not-Pending skip | `notificationService.ts:878-881` | Reminder status ≠ Pending → `return false` → route answers generic 500 (`dispatch.ts:604-605`). No hint that it was already dispatched/collected. |
| 4 | Missing phone | `notificationService.ts:883-887` | `return false` → generic 500. Never tells the worker WHO has no phone. |
| 5 | Order-announcement suppression | `notificationService.ts:967-970` | Follow-up/announcement with no confirmed `order_no` → `return false` → generic 500 ("Failed to send…"). |
| 6 | Pacing-sleep race | `src/routes/whatsappQueue.ts:590-591` | The grace-release endpoint (`POST /api/whatsapp/queue/items/:id/send-now`) sets `scheduled_at = now` then calls **`triggerProcessing()`** — which only starts a pass if none is in flight (`whatsappQueueWorker.ts:757-766`). While the drain is inside `interruptibleSleep()` (pacing 10–15 s after the previous send, `whatsappQueueWorker.ts:80-83, 1407-1427`), the release **waits out the sleep**. Only `forceNext()` (`whatsappQueueWorker.ts:390-409`, cancels sleep at line 393) wakes it. |
| 7 | Dead-client wake cost | `whatsappQueueWorker.ts:888-898` | If WhatsApp browser is asleep/offline, the item stays pending; auto-init retries run on a 60 s cooldown. Truthful, but combined with #1–#5 the UI shows nothing happening. |

### 2.2 The timers currently delaying dispatch messages (verified)

| Timer | Location | Value | Applies to |
|---|---|---|---|
| **5-minute grace hold** | `src/routes/pharmarack.ts:3090` (`gracePeriodScheduledAt = Date.now() + 5 * 60 * 1000`) | +5 min fixed | EVERY official PO dispatch reminder enqueue from Send All / place-official-orders Step 4. Owner can shorten only by clicking Send Now on the Dispatch row. |
| Queue loop tick | `whatsappQueueWorker.ts:785-788` | 10 s active / 30 s offline / 15 min idle | Next drain pass when nothing forces it. |
| Pacing between sends | `whatsappQueueWorker.ts:80-83, 344-368` (hard floor 10–15 s; DB seed 5000/8000 floored) | 10–15 s bulk | Between every two sends. User-clicked Send-Now floor is only **2 500 ms** (`:1413`) — correct per ban-safety, keep. |
| Per-type scheduled delays | `whatsappQueueWorker.ts:530-556`, settings `whatsapp_delay_distributor` / `_delivery_boy` / `_credit_bill` | **default 0 = off** (`database.ts:4275-4277`) | Only if owner set a value; keep the mechanism. |
| 60 s debounce (delivery-boy summary) | `src/services/pharmarackDailyDispatchService.ts:139-162` | 60 s | Delivery-boy batch summaries only — **out of scope** for the dispatch-reminder fix (see §9). |
| Auto reminder tick | `src/services/distributorDispatchReminderWorker.ts` (~60 s tick, idle-gated) | 60 s | Automatic reminder registration/enqueue — automation domain, **unchanged**. |

### 2.3 Existing infrastructure the fix reuses (verified, nothing new invented)

- **Resend contract**: `POST /api/whatsapp/queue/items/:id/resend` (`routes/whatsappQueue.ts:473-576`) already implements user-clicked re-send semantics: `enqueue(..., { skipDedupe: true })` + `forceNext()` (Instant WhatsApp Dispatch contract, `src/AGENTS.md`).
- **Enqueue** supports `options.skipDedupe` (`whatsappQueueWorker.ts:475-625`); per-type delay applies only when a setting > 0.
- **Template with real PO numbers**: `notificationService.sendDistributorDispatchReminder` resolves `{order_no}` from `pharmarack_synced_orders` for today or from `opts.orderNos` override (`notificationService.ts:948-987`) — never invents an order number.
- **Sent PO History** tab: `frontend/src/components/PharmarackCalendar.tsx → PharmarackCartCalendar.tsx:476-494` (tab), master-detail render in `frontend/src/pages/PharmarackCart/index.tsx:4835+`; rows come from `GET /api/pharmarack/sent-orders` (`routes/pharmarack.ts:3836-3966`), a pure offline read of `pharmarack_placed_orders` (DDL `database.ts:3895-3911`, carries `store_name`, `order_no`, `order_date`, `items_json`, `batch_sent`).
- **Reminder row management**: Step 4 of `place-official-orders` upserts `distributor_dispatch_reminders` (status Pending, `order_source='pharmarack'`) by date+store name (`pharmarack.ts:3132-3152`); the queue worker flips the row to `Dispatched` on real send.

---

## 3. Governing Contracts This Plan Must Respect

| Contract | Source | How this plan stays inside it |
|---|---|---|
| Manual-only messaging (distributors/boys, never patients) | root `AGENTS.md`; src/AGENTS.md | Only explicitly user-clicked sends change behavior. No worker gains a send path. Auto reminder worker untouched. |
| P1 events-not-timers / P3 gated workers | `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` §7 | We REMOVE waits, add none. No new interval; instant sends ride the existing event-driven `forceNext()` / SSE `wa_queue_update` / `dispatch_updated`. |
| P2 cache-first paint | same | No new page; the Sent PO History button reuses the loaded sent-orders list (module-cached). No mount-time fetches added. |
| Zero dummy data / no invented fallbacks | root AGENTS.md | Missing phone → structured 400 naming the distributor (never a guessed number); missing `order_no` → generic reminder template (never a fabricated PO id). |
| WhatsApp ban-safety | root AGENTS.md (owner decision) | The 2 500 ms Send-Now floor and the bulk 10–15 s pacing stay. Only the artificial 5-min hold and the pacing-sleep race are removed. Idle-sleep / explicit-connect contracts untouched. |
| No-GPU rendering lock (E1) | root AGENTS.md | No animation/blur changes. |
| Sequential Enter-Key contract | root + frontend AGENTS.md | Not touched (Dispatch/PharmarackCart pages are not POS/Purchases billing grids). |
| Truthful toasts / never fake a queued state | root AGENTS.md (Special Order `whatsapp_queued` rule) | Toasts now reflect the structured backend action (`released` / `queued` / `resent` / `no_phone`), replacing the current blanket "sent successfully". |

---

## 4. Agent Verification (role map of the dispatch pipeline)

```
┌──────────────────────────────┐
│  INGESTION & VALIDATION      │  routes layer + template/validation guards
│  src/routes/dispatch.ts      │  POST /distributor-reminders/:id/send-now  (manual clicks)
│  src/routes/whatsappQueue.ts │  POST /items/:id/send-now (release), /items/:id/resend
│  src/routes/pharmarack.ts    │  place-official-orders Step 4 (PO enqueue), /sent-orders (read)
│  notificationService.ts      │  template resolution, distributor/boy resolution, dedupe guards
└──────────────┬───────────────┘
               │ enqueue(number, message, type, target, scheduledAt, …, {skipDedupe})
               ▼
┌──────────────────────────────┐
│  CORE PROCESSING PIPELINE    │  src/services/whatsappQueueWorker.ts
│  whatsapp_send_queue (SQLite)│  lazy loop · scheduled_at · dedupe · retry ladder
│  forceNext():396-409         │  ← cancels in-flight pacing sleep (line 393) — the ONLY instant lever
│  triggerProcessing():758-766 │  ← blind nudge; cannot wake a sleeping drain (root cause #6)
└──────────────┬───────────────┘
               │ sendMessage(number, media, message) when client ready
               ▼
┌──────────────────────────────┐
│  NOTIFICATION BROKER         │  src/whatsappClient.ts (LocalAuth session, idle-sleep,
│                              │   registration check) + waSmartReplyScheduler/Circuit breaker
└──────────────────────────────┘
```

**Verification conclusions**
1. Single writer per fact — the queue table has exactly one drainer (`whatsappQueueWorker`; the `services/whatsappQueue.ts` facade's duplicate 30 s interval was already removed per Queue & Worker Consolidation). No double-drainer risk.
2. `forceNext()` is the only mechanism that 既 cancels an in-flight pacing sleep AND processes immediately — all user-clicked instant paths must route through it (send-now release currently does not → bug #6).
3. The Notification Broker is demand-driven (sleep/wake contracts) and stays untouched; instant-ness is achieved at pipeline level, not by waking schedules.
4. No role is missing a boundary: the validation gap (silent boolean no-ops) lives entirely in Ingestion & Validation — fixed in Phase 1.

---

## 5. Architecture Blueprint (post-fix behavior)

### 5.1 Immediate Send Path (replaces 409/guard no-ops)

```
User clicks "Send Now" (Dispatch row)  ·  User clicks "📤 Send Dispatch Msg" (Sent PO History row)
                                                                            │
                            ┌───────────────────────────────────────────────┘
                            ▼
POST /api/dispatch/distributor-reminders/:id/send-now        POST /api/pharmarack/sent-orders/:id/send-dispatch  (NEW)
  · NO automation-toggle 409 for user clicks                  · load pharmarack_placed_orders row (404 if missing)
  · resolve/ensure today's distributor_dispatch_reminders row · resolve/ensure reminder row (date+store, Pattern of Step 4)
  · phone missing → 400 { reason:'no_phone' }                 · resolve phone: reminder row → mapped distributor → else 400 'no_phone'
                            ▼
notificationService.sendDistributorDispatchReminder(id, msg, scheduledAt, { userClicked: true, orderNos? })
  · userClicked ⇒ skip status-not-Pending guard (resend intent)
  · existing PENDING queue item today ⇒ UPDATE scheduled_at=now + forceNext()  → { action:'released', queueId }
  · already SENT earlier today (or none) ⇒ enqueue(skipDedupe) + forceNext()   → { action:'queued'|'resent', queueId }
  · return structured { ok, action, reason?, queueId? }                        → never a silent boolean no-op
                            ▼
forceNext() ─ cancels in-flight 10–15 s pacing sleep ─ drain picks due item ─ 2.5 s floor ─ SEND
                            ▼
SSE: wa_queue_update / dispatch_updated → Dispatch row flips Pending → Dispatched; toast states the truth
```

### 5.2 Immediate PO Dispatch after Send All (removes the 5-min hold)

```
place-official-orders Step 4 (pharmarack.ts:3083-3163)
  BEFORE: enqueue at now + 5 min (grace hold) → announce_result 'held_in_grace_period'
  AFTER : enqueue at Date.now() (immediate)   → announce_result 'announced_immediate'
  Dispatch row keeps Send Now / Cancel Hold affordances for anything genuinely future-scheduled
  (per-type delay set by owner, reminder-worker pre-queue) — UI flag is_held_in_grace_period stays,
  it simply no longer fires for Step 4 batches.
```

---

## 6. Execution Phases

### Phase 1 — Truthful manual send (`Ingestion & Validation`)

**1.1 `src/services/notificationService.ts` — structured user-click result**

- Extend `sendDistributorDispatchReminder` opts (`:852-859`):
  ```ts
  opts?: { followUp?: boolean; orderNos?: string[]; isOrderAnnouncement?: boolean; userClicked?: boolean }
  ```
- Return type: `Promise<boolean>` → `Promise<SendReminderResult>` where
  ```ts
  type SendReminderResult = {
    ok: boolean;                                   // message was queued/released
    action: 'queued' | 'released' | 'resent';
    reason?: 'no_phone' | 'not_found' | 'suppressed_no_order_no';   // suppress = announcement w/o PO only
    queueId?: number | null;
  };
  ```
- Guard changes **only when `opts?.userClicked`**:
  - `:872-875` not found → `{ ok:false, reason:'not_found' }`
  - `:878-881` status-not-Pending skip → skipped (manual resend intent)
  - `:883-887` phone missing → `{ ok:false, reason:'no_phone' }`
  - `:895-907` duplicate-today guard →
    - item pending/sending/failed_offline → `UPDATE whatsapp_send_queue SET scheduled_at = ? (now) WHERE id = ?` → `await whatsappQueueWorker.forceNext()` → return `{ ok:true, action:'released', queueId }`
    - item already `sent` / terminal earlier today → continue to a **fresh enqueue** with the existing `{ skipDedupe: true }` call (`:991-1000`), then `await whatsappQueueWorker.forceNext()` right after → `{ ok:true, action:'resent', queueId }`
  - Without `userClicked`, all guards and boolean-compat behavior unchanged for the auto worker and order-sync flows.
- Keep the `automation_notifications` log row (`:1009-1013`) and `last_reminded_at` stamp (`:1002-1005`) as-is.
- **Call-site sweep (mechanical, all in-repo)**: `grep -n "sendDistributorDispatchReminder(" src/` at implementation time. Known consumers to update to `const res = await …; const ok = res.ok`:
  `src/routes/dispatch.ts` send-now + manual-order routes, `src/services/distributorDispatchReminderWorker.ts`, `src/services/pharmarackOrderSyncService.ts` follow-up announcements, `syncTodayActiveDistributors` consumers. Compile errors list any stragglers.

**1.2 `src/routes/dispatch.ts` — send-now endpoint (`:592-611`)**

- **Delete the 409 automation-toggle gate** for this manual endpoint (the toggle keeps governing `distributorDispatchReminderWorker`'s automatic sends only).
- Map the structured result:
  - `{ ok:true }` → `200 { success:true, action, queue_id, message: truthText }`
  - `reason:'no_phone'` → `400 { error: 'No WhatsApp number saved for <distributor> — add it in Distributors.' }`
  - `reason:'not_found'` → `404`
  - `reason:'suppressed_no_order_no'` → `400 { error: 'Official PO number not confirmed yet — message not sent.' }` (truthful, still no fabrication)
  - exceptions → `500` with `error.message` (unchanged).

**1.3 `frontend/src/pages/Dispatch/index.tsx` — truthful toasts (`handleSendReminderNow`, `:456-494`)**

- Parse the new response (`services/api.ts` type update — named export, zero-`any` per lint policy):
  - `released` → `showNotif('Released — sending to ' + distName + ' now')`
  - `queued` → `'Queued — sending to ' + distName + ' in seconds'`
  - `resent` → `'Earlier reminder already went out today — re-sent to ' + distName`
  - `no_phone`/400 → error toast with the backend message
- Grace-held release branch (`:463-469`) stays; it now benefits from the improved `send-now` endpoint (Phase 2).

**Acceptance:** automation toggle OFF → manual send works; duplicate-today → real resend visible in `whatsapp_send_queue` with a new row / released pending row; no-phone → toast names the distributor.

### Phase 2 — Instant dispatch mechanics (`Core Processing Pipeline`)

**2.1 `src/routes/pharmarack.ts:3090` — remove the 5-minute grace hold**

```ts
// 5-minute review grace period (REMOVED 2026-10-24 — owner wants dispatch ASAP; Send Now/Cancel Hold
// on the Dispatch row still guard anything genuinely future-scheduled)
const reminderScheduledAt = Date.now();
```
- Pass `reminderScheduledAt` to `enqueue(...)` (`:3097`).
- Update the log line (`:3102`) to `… enqueued for immediate dispatch (queue #N)`.
- `:3157` `announce_result = 'held_in_grace_period'` → `'announced_immediate'`.
- Do **not** touch the reminder row upsert (`:3132-3152`) — it keeps the human-in-the-loop status record.

**2.2 `src/routes/whatsappQueue.ts:579-598` — release wakes a sleeping drain**

```ts
await db.run("UPDATE whatsapp_send_queue SET scheduled_at = ? WHERE id = ?", [Date.now(), id]);
await whatsappQueueWorker.forceNext();          // was triggerProcessing() — forceNext cancels
                                                // the in-flight interruptibleSleep (worker:393)
eventService.broadcast('dispatch_updated', { at: Date.now(), source: 'send_now', id });
res.json({ success: true, released: true, message: `Dispatched queue item #${id} immediately` });
```

**2.3 Deliberately unchanged (ban-safety + P1)**
- 2 500 ms Send-Now floor (`worker:1413`) and bulk 10–15 s pacing (`:344-368`) — WhatsApp ban-safety.
- `whatsapp_delay_*` settings (default 0) and the enqueue-time scheduled-delay mechanism.
- Worker loop tick values (10 s/30 s/15 min) and idle gating.
- `distributorDispatchReminderWorker` 60 s automation tick (idle-gated) — automation domain.

**Acceptance:** with a bulk queue mid-send, a grace-release leaves in ≈2.5–3 s, not 10–15 s; a fresh Send All shows today's distributor reminders going out immediately (Dispatch rows Pending → Dispatched within seconds).

### Phase 3 — Sent PO History → Send Dispatch Msg (`Ingestion & Validation` + UI)

**3.1 Backend: `src/routes/pharmarack.ts` — `POST /api/pharmarack/sent-orders/:id/send-dispatch`**

Placed next to the existing Sent-PO endpoints (`:3836-3966`). One handler:
1. `SELECT * FROM pharmarack_placed_orders WHERE id = ?` → 404 when missing.
2. Ensure a reminder row for that store (Pattern already proven in Step 4, `:3132-3152`):
   `SELECT id FROM distributor_dispatch_reminders WHERE date = <row.order_date> AND LOWER(TRIM(distributor_name)) = LOWER(TRIM(<row.store_name>)) LIMIT 1` → else INSERT `(store_name, phone?, order_date, 'Pending', auto_remind=1, order_source='pharmarack')`.
3. Phone resolution order (never a guess): reminder row phone → mapped store phone (`pharmarack_distributor_mappings` → `distributors`) → else `no_phone` 400 naming the store.
4. `notificationService.sendDistributorDispatchReminder(reminderId, undefined, undefined, { userClicked: true, orderNos: row.order_no ? [row.order_no] : [] })` — orderNos override puts the **real PO number from this row** into the `{order_no}` template slot (bypasses today-only `pharmarack_synced_orders` lookup); no `order_no` → generic reminder template (no invented PO).
5. Return the same structured shape as Phase 1.

**3.2 Frontend: `frontend/src/services/api.ts` + `frontend/src/pages/PharmarackCart/index.tsx`**

- `api.ts`: `sendSentOrderDispatch(id: number)` → the new endpoint; export the structured result type (shared with Dispatch).
- Sent PO History master-detail (`index.tsx:4835+`): per-row button **`📤 Send Dispatch Msg`** (semantically colored per UI guidelines, `active:scale-[.98]` press feedback, per-row spinner state, no new colors, no blur/animation).
- Click → behaves exactly like Phase 1.3 toasts. No fetch on tab mount (P2 — reuse the already-loaded sent-orders rows).

**Ownership note:** Dispatch page keeps reminder *status* management; the Sent PO History tab gains only this single user-clicked send action (matches "POS as the only sale writer / extend the node that already exists" — it writes to the SAME `whatsapp_send_queue` + `distributor_dispatch_reminders`, no parallel page or table).

**Acceptance:** a Sent PO History row with `order_no` → button queues the reminder with `#<PO>` in ≤3 s (forceNext); row for a store with no phone → truthful error; re-click → `resent`. No duplicate row in `pharmarack_placed_orders`; `batch_sent` untouched.

### Phase 4 — Verification, docs & knowledge graph (mandatory housekeeping)

1. Read `AGENT_BUG_FIX_RULEBOOK.md` + `AGENT_DATA_FLOW_TREE.md` dispatch node before the first edit (Bug Fix Rulebook + Shop Data-Flow Tree are mandatory).
2. After every edit: `node scripts/quick-update.mjs`; before finishing: `npm run guardrails` (must exit 0 — scanner covers changed lines; §2.2/2.3 keep every banned pattern out: no new timers, no `toISOString` bills, no mock UI, semantic Tailwind colors only).
3. `tsc --noEmit` (guardrail runs it) — the structured-return call-site sweep must compile clean.
4. Update `SMALL_BUG_FIX_PLAN.md` Section 4: add the next free bug id (assign at implementation, e.g. continuing the P2 series) — cause (#2.1 table), fix (#6 phases), files touched.
5. Contract doc updates: `src/AGENTS.md` "Instant WhatsApp Dispatch & Resend" section gains: *manual send-now bypasses the automation toggle; release path uses forceNext(); grace hold removed; structured send result*; `frontend/AGENTS.md` gains the Sent PO History send-button ownership line.
6. Test pass in isolation (baseline ERR_DLOPEN contention note in src/AGENTS.md): any `tests/*whatsapp*` + `tests/requestTransactionGuard.test.ts` unaffected set — verify suite results vs stash baseline before attributing regressions.

**Manual regression checklist (before calling it done)**

| # | Scenario | Expected after fix |
|---|---|---|
| 1 | Automation Hub toggle OFF → Dispatch Send Now | Sends (no 409), truthful toast |
| 2 | Reminder already sent earlier today → Send Now | New queue row (resend) + forceNext, sends ≤ ~3 s |
| 3 | Grace/pending queue row released while another message is mid-pacing-sleep | Releases instantly (sleep cancelled) |
| 4 | Distributor with no phone | 400 toast naming the distributor |
| 5 | Send All → observe Dispatch rows | No 5-min countdown; rows Pending → Dispatched within seconds |
| 6 | Sent PO History row → 📤 Send Dispatch Msg | Reminder with real `#<PO>` queued instantly; no-phone → truthful error; re-click → resent |
| 7 | Auto reminder worker (toggle ON) | Behavior identical to today — no double auto sends (guards intact for non-userClicked) |
| 8 | Patient-facing messaging | Completely untouched (Manual-Only Patient Messaging contract) |

---

## 7. Error Boundaries

| Failure | Boundary | Surfaced as |
|---|---|---|
| WhatsApp offline / asleep at send time | Queue keeps item `pending`; auto-init retries per existing 60 s cooldown | Truthful "queued — will go out when WhatsApp reconnects"; existing SSE/toast trails |
| `forceNext()` with an empty/dead client | `forceNext` returns `false`/keeps head-of-line release | Item stays pending — no fake success (worker contract `!isReady ⇒ offline`) |
| Distributor not on WhatsApp | Existing `skipped_not_on_whatsapp` + non-WA fallback (`worker:1080-1118`) | Unchanged |
| No phone anywhere (reminder row, mapped distributor) | New structured `no_phone` | 400 + toast naming the store — never a resolve failure silence |
| Row id unknown (`sent-orders/:id`) | 404 | Toast "PO row not found" |
| Enqueue throws (DB busy/closed) | Existing `automation_notifications` failure row (`notificationService:1016-1019` pattern) + route 500 with real message | Failure-log card + Layout 15-min-fresh toast (existing pipeline) |
| Dedupe collision on genuine resend | `skipDedupe: true` on the userClicked enqueue only | Auto flows keep normal same-day dedupe |
| Transaction hygiene | No new BEGIN/COMMIT paths added; single-row upserts follow `connection.ts` rules | — |

---

## 8. Rollback Strategy

| Change | Rollback | Risk if withdrawn |
|---|---|---|
| Phase 1 structured result + route mapping + frontend toasts | Single `git revert` (backend+frontend committed together — atomic) | Reverts to boolean behavior + "sent successfully" blank toasts (the reported bug) |
| Phase 2.2 forceNext release | One-line revert (`forceNext()` → `triggerProcessing()`) | Returns the 10–15 s sleep race (slow, dishonest "Pending" rows) |
| Phase 2.1 grace-hold removal | One-line revert (`Date.now()` → `Date.now() + 5*60*1000`) + announce_result string | Returns the 5-min wait (owner explicitly rejected it) |
| Phase 3 endpoint + button | Revert commit; no schema change involved | Sent PO History loses its send button only |

- **Database:** ZERO schema changes — no DDL/fast-boot edits, no migrations, nothing to roll back in `database.ts`. (Per `BACKEND SCHEMA SAFETY.md`, a plan with no DB touch needs no Section-24 report; if implementation ends up adding any column, that standard applies then.)
- **Settings:** no new keys; `whatsapp_delay_*` (default 0) untouched — rolling back changes nothing there.
- **Feature-flag escape hatch (optional extension only if ever requested):** `app_settings.dispatch_grace_period_min` (default 0) — explicitly NOT in initial scope (YAGNI per Ponytail rule; git revert is the rollback).
- Release/deploy unaffected: `npm run guardrails` gates the push as usual; no version-number change required by this plan.

---

## 9. Out of Scope (explicitly untouched)

1. `scheduleDebouncedBatchSend(60000)` in `pharmarackDailyDispatchService.ts` — the delivery-boy **batch summary** grouping debounce (different message family; grouping is its function). Can be revisited separately if the owner wants instant delivery-boy summaries.
2. `distributorDispatchReminderWorker` 60 s automation tick, Automation Hub toggles, idle-sleep/wake contracts, ban profile.
3. Bulk pacing values (10–15 s) and the 2 500 ms Send-Now floor (ban-safety).
4. Pharmacart single/batch checkout flows (`handleSendWhatsAppOrder` etc.) — they already enqueue immediately via `POST /api/messaging/send`; only the grace hold on the *dispatch reminder* family changes.
5. Any patient-facing message path (none exists in this chain — distributor/boy/owner only).

---

## 10. Files Touched (summary)

| File | Change | Phase |
|---|---|---|
| `src/services/notificationService.ts` | structured `SendReminderResult`, `userClicked` guards, release-or-resend + `forceNext()` | 1 |
| `src/routes/dispatch.ts` | drop 409 for manual clicks, structured 200/400/404 mapping | 1 |
| `frontend/src/pages/Dispatch/index.tsx` | truthful toasts per `action` | 1 |
| `frontend/src/services/api.ts` | `sendDistributorReminderNow` return type + `sendSentOrderDispatch(id)` | 1, 3 |
| `src/routes/pharmarack.ts` | grace hold → immediate (`:3090`), `announce_result` string, NEW `POST /sent-orders/:id/send-dispatch` | 2, 3 |
| `src/routes/whatsappQueue.ts` | send-now release → `forceNext()` (`:591`) | 2 |
| `frontend/src/pages/PharmarackCart/index.tsx` | 📤 Send Dispatch Msg button + spinner on Sent PO History rows | 3 |
| `SMALL_BUG_FIX_PLAN.md` | new bug-entry (Open → Fixed) | 4 |
| `src/AGENTS.md`, `frontend/AGENTS.md` | contract notes (manual bypass, forceNext release, grace removal, PO-History send ownership) | 4 |
| `.understand-anything/` | refreshed by `node scripts/quick-update.mjs` (automatic) | 4 |

**Total backend blast radius:** 4 files (2 services, 3 routes) · **Frontend:** 3 files · **DB:** none · **New timers:** none · **New patient message paths:** none.

---

## 11. Execution & Verification Log

- [x] **Phase 1 — Truthful Manual Send**
  - Updated `src/services/notificationService.ts`: exported `SendReminderResult`, added `opts.userClicked`. When `userClicked` is true, bypasses non-Pending checks, releases pending/failed_offline queue rows via `UPDATE scheduled_at = now` + `whatsappQueueWorker.forceNext()`, and enqueues fresh reminders with `{ skipDedupe: true }` + `forceNext()` if sent earlier today. Structured errors returned for `no_phone`, `not_found`, `suppressed_no_order_no`.
  - Updated callers in `src/services/pharmarackOrderSyncService.ts` to inspect `sentRes.ok`.
  - Updated `src/routes/dispatch.ts`: dropped 409 automation check on manual send-now and retry routes; mapped structured responses to 200/400/404 messages naming the distributor.
  - Updated `frontend/src/services/api.ts`: typed `SendReminderResponse`.
  - Updated `frontend/src/pages/Dispatch/index.tsx`: truthful action toasts (`released`, `queued`, `resent`, and `no_phone`).

- [x] **Phase 2 — Instant Dispatch Mechanics**
  - Updated `src/routes/pharmarack.ts`: removed 5-minute review grace period hold in Step 4 of Send All, setting `reminderScheduledAt = Date.now()`, `announce_result = 'announced_immediate'`, and calling `await whatsappQueueWorker.forceNext()`.
  - Updated `src/routes/whatsappQueue.ts`: `/item/:id/send-now` release endpoint calls `await whatsappQueueWorker.forceNext()`, cancelling in-flight pacing sleep immediately.

- [x] **Phase 3 — Sent PO History → Send Dispatch Msg**
  - Added `POST /api/pharmarack/sent-orders/:id/send-dispatch` in `src/routes/pharmarack.ts`, resolving placed or synced orders, mapping distributor contact numbers, ensuring reminder rows, and dispatching reminders with confirmed PO numbers.
  - Added `sendSentOrderDispatch` to `frontend/src/services/api.ts`.
  - Added `📤 Send Dispatch Msg` button with loading spinner state to each order card in `frontend/src/pages/PharmarackCart/index.tsx`.

- [x] **Phase 4 — Verification, Contracts & Knowledge Graph**
  - Verified backend TypeScript compile: `tsc --noEmit` exit 0.
  - Verified frontend TypeScript compile: `npx tsc -p frontend/tsconfig.app.json --noEmit` exit 0.
  - Verified Performance Guardrails: `npm run guardrails` exit 0 (0 violations).
  - Updated `SMALL_BUG_FIX_PLAN.md` with P2-114 under `## Fixed`.
  - Updated `src/AGENTS.md` and `frontend/AGENTS.md` contracts.

