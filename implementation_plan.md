# Implementation Plan — Refill "Today List" Truth, Owner Message Combining & WhatsApp Queue Power-Cut Resilience

> **Created:** 2026-10-24 · **Status:** Approved plan, ready for build agent execution
> **Source:** Owner-reported issues during a live defect session (verified root causes in code, see evidence table)
> **Proposed bug-register IDs (to register in `SMALL_BUG_FIX_PLAN.md` when implemented):**
> - **P2-108** — Fix A: Owner "today list" purity (no completed patients, ever)
> - **P2-109** — Fix B: Combine the owner's own WhatsApp messages into ONE send (daily briefing stays separate)
> - **P2-110** — Fix C: WhatsApp queue power-cut resilience + truthful retry/attempt report

---

## 0. Zero-Touch Verification

At planning time **no existing source code, configuration files, or runtime modules were touched or modified**. The only file created by this session is this document (`implementation_plan.md`). All findings below come from read-only research of `src/services/whatsappQueueWorker.ts`, `src/services/refillService.ts`, `src/services/refillCartService.ts`, `src/services/collectionReminderWorker.ts`, `SMALL_BUG_FIX_PLAN.md`, and the governing AGENTS.md contracts.

**Agent roles mapped and verified for the build:**

| Role | Scope in this plan |
|---|---|
| **Ingestion & Validation** | Reproduce all three defects on a shop-DB copy baseline (Phase 1); add regression tests before changing behavior |
| **Core Processing Pipeline** | `whatsappQueueWorker` boot recovery, dispatch loop, enqueue merge engine (Phases 2–4) |
| **Notification Broker** | Owner-facing digest builders (`refillService` briefing/staged, `refillCartService` summary) and the frontend truth report (Phases 5–6) |

---

## 1. Owner-reported problems (user answers confirmed)

1. **Completed patients still appearing in owner lists.** User saw already-completed patients in (a) the ☀️ Morning briefing and (b) the refill cart list message. Requirement: the owner's message must contain **only persons not yet complete**, so it is a true "today list".
2. **Owner receives many separate WhatsApp sends.** Requirement: combine the queue messages addressed to the pharmacy owner/shop itself into ONE message. **User decision: the ☀️ daily briefing always goes alone** (never merged, never receives merges).
3. **PC power cut mid-queue ruins the queue.** After a hard shutdown, queued messages end up stuck/failing with no automatic retry. Requirement: on next boot, automatically try to send everything queued **today**; if still failing, record and show **how many times it was attempted, when, and with what error** — a truthful report with clear "things to do" in the app.

---

## 2. Verified root-cause evidence (file:line, current code)

| # | Finding | Where |
|---|---|---|
| 1 | Briefing re-admits completed patients: refill preview is a **7-day forward window** (`next_refill_date <= now + 7 days`) AND the early re-admit clause `today >= last_refill_date + MAX(7, interval) - 7 days` re-adds a completed patient the moment their next cycle is within 7 days (instantly reappears for intervals ≤ 7 days) | `src/services/refillService.ts:666–697` (aggregate) and `:700–729` (detail), clause at `:683` |
| 2 | Briefing "🔔 Staged Reminders" count reads raw staged rows **without re-checking current refill status** | `src/services/refillService.ts:802–808` |
| 3 | Staged-alert message (`notifyAdminStagedReminders`) same: no current-status join at read time | `src/services/refillService.ts:1134–1141` |
| 4 | `purgePendingCustomerReminders` cleans queued items for name-only callers but **skips staged-notification cleanup** unless `refillIds` are empty-and-nameless (`last10 && !medNames && !refillIdStrs && !orderIdStrs` condition) | `src/services/refillService.ts:530–618`, gate at `:604` |
| 5 | Refill cart summary prints **exactly the rows the popup run sent**, no re-check of current refill status; a completed patient that still entered a run is reported | `src/services/refillCartService.ts:610–655` |
| 6 | Send-time fulfillment gate exists and works (completed/canceled refills are auto-skipped as `skipped_already_fulfilled`) — patient-side protection unchanged by this plan | `src/services/whatsappQueueWorker.ts:995–1077` |
| 7 | Boot recovery: pre-boot `pending`/`failed_offline` rows restored to pending **only** for `distributor_dispatch_reminder` and `admin_morning_briefing`; **every other type → `review_required`** ("held for review"). Power-cut morning = everything looks stuck | `src/services/whatsappQueueWorker.ts:684–733` |
| 8 | Rows stuck in `sending`: outbox/Sent Register match → `sent`; else `review_required` (honest — keep as-is) | `src/services/whatsappQueueWorker.ts:644–653` |
| 9 | Stale backlog guard (>24h → `skipped_offline`) — protects old DB imports; keep | `src/services/whatsappQueueWorker.ts:656–667` |
| 10 | Retry truth gaps: only `retry_count` (cap 3 → `failed_perm` at `:1313–1317`) + one `error_message`; no attempt timestamps/history | `src/services/whatsappQueueWorker.ts:866–874, :1313–1317` |
| 11 | Worker is LAZY-started; after recovery only the distributor-restore branch calls `triggerProcessing()` — other restored items wait for an unrelated enqueue | `src/services/whatsappQueueWorker.ts:735–738` |
| 12 | `whatsapp_send_queue` schema is registered in THREE places (DDL, fast-boot DDL, alterStatements guard) — any new column must touch all three or upgrades/fresh installs crash | `src/database.ts:2449–2467` (DDL), fast-boot duplicate at `~:4195`, register at `~:4281` |
| 13 | Unclean-shutdown flag already exists from the self-healing spec (`last_clean_shutdown` in `app_settings`, set `'false'` at boot, `'true'` on graceful exit) | `src/server.ts` boot/shutdown tracking contract in `src/AGENTS.md` |
| 14 | Sent Register (`whatsapp_sent_register`, 48h/72h dedupe basis; `recordDelivery` on real send) — the "did it actually send" ground truth to keep | `src/database.ts:2469–2485`; `src/services/whatsappQueueWorker.ts:1222, :1282` |
| 15 | ~19 owner-number producers exist with internal/admin types (briefing `:1113`, staged alert `:1156`, cart summary `:653`, order-mail check, mail/invoice/bounce alerts, escalations, monthly report, etc.) — combining targets exactly these | `refillService.ts`, `refillCartService.ts`, `emailService.ts:608–813`, `bouncedAlertService.ts:34–48`, `waAdminEscalationService.ts`, `notificationService.ts:1193–1230` |

---

## 3. Fixes

### Fix A — P2-108: Owner "today list" purity

**A1. Morning briefing becomes a true TODAY list.** In `buildDailyOperationalBriefing` (`src/services/refillService.ts:666–729`), the WhatsApp briefing's refill section changes to:
- `next_refill_date <= today` (due today or overdue) — replaces the 7-day forward window in the message only.
- Keep `pr.status IN ('pending','notified','staged')`, `is_active = 1`, and the existing same-day/24h fulfillment NOT EXISTS guards.
- Effect: completing a patient today moves `next_refill_date` beyond today → the patient disappears from the briefing the moment they are complete and returns only on the day they are genuinely due.
- The full 7-day "upcoming" preview **stays in the app** (CRM → Refills tab) — only the WhatsApp message narrows.

**A2. Cart-run source guard.** `/refills/:id/add-to-cart` and the popup batch runner in `src/routes/refills.ts` / `src/services/refillCartService.ts` reject refills whose **current** status is `completed`/`canceled` (one `id IN (...)` status re-read per run, before any cart work). A completed patient can no longer enter a cart run at all; the response names them as skipped, never silent.

**A3. Cart-summary read filter.** `sendRefillCartSummary` (`refillCartService.ts:620–628`) additionally re-reads `status` with the existing `cart_*` id query and drops completed/canceled rows at build time (defense-in-depth).

**A4. Staged-count truth.** The staged rows queries for the briefing count (`refillService.ts:802–808`) and the staged alert (`:1134–1141`) gain an EXISTS re-check: only count staged rows whose linked `patient_refills` row is still `is_active = 1` and `status NOT IN ('completed','canceled')`. Cosmetic/unknown links (`reference_id` not a refill) keep current behavior.

**A5. Purge audit.** Walk every completion/cancel call site of `purgePendingCustomerReminders` (`routes/refills.ts` ×16, `routes/orders.ts` ×6, `routes/sales.ts` ×4, `routes/pharmarack.ts`, `whatsappIntentService.ts`) and fix the name-only callers to pass real `refillIds` so staged notifications are cancelled at close time (fixes the `:604` gate skipping cleanup).

**A6. Regression test.** "Refill staged → patient completed → assert all three owner surfaces produce ZERO lines for that patient" (`tests/` suite, isolated temp DB per the `WWEBJS_AUTH_DIR` test-safety pattern).

### Fix B — P2-109: Combine the owner's messages into ONE send

**B1. Central merge inside `whatsappQueueWorker.enqueue()`** (one writer — the ONE processor contract is not violated; no second consumer of `whatsapp_send_queue`):
- When ALL of these hold, the new message is APPENDED to an existing pending row instead of creating a second row:
  - recipient = resolved pharmacy owner number (`waAdminEscalationService.resolveAdminWhatsappNumber`, same resolution all 19 producers already use), OR the shop's own number;
  - `type ∈ OWNER_DIGEST_TYPES` (internal/admin types: `admin_morning_briefing` **excluded as merge TARGET or SOURCE** per user decision, `admin_staged_reminders`, `refill_cart_summary`, `order_mail_check`, invoice/mail arrival alerts, `admin_missing_distributor_phones`, bounce alert, non-media admin escalations, monthly report, AI-Rx briefing, queue-failure admin notes);
  - a pending owner row of a mergeable type already exists (created today, `status = 'pending'`, scheduled_at already due or NULL);
  - **neither** item carries media (`media_url` / `file_json` empty);
  - merged size under the cap.
- Merge format: numbered sections with a one-line divider, e.g.
  `🔹 *2/5 · Refill cart — Ramesh*` + existing body, so each block keeps its own title. Blocks are never truncated silently — the cap creates a new row instead.
- Cap: ≤ 8 sections or ≤ 5,000 chars total; beyond that the item goes out as its own send.
- Failure isolation: if the append (re-read + UPDATE) fails for any reason, fall back to a normal standalone enqueue — worst case is the old behavior (two messages), never a dropped user message.

**B2. Never combined** (unchanged routing, anti-ban pacing preserved): patient-addressed reminders/collections, distributor and delivery-boy messages, `distributor_dispatch_reminder` (own merge contract from the Pharmarack order-sync — do not entangle), anything with media, chatbot conversational types, and the ☀️ `admin_morning_briefing` (goes alone).

**B3. `skip_dedupe` and `forceNext` semantics unchanged**: a user-clicked send that merges still force-dispatches immediately; the Sent Register dedupe keeps working because the merged message is one real sent text.

### Fix C — P2-110: Power-cut resilience + truthful retry report

**C1. Schema (additive only).** New columns on `whatsapp_send_queue`:
- `last_attempt_at TEXT` (shop-local SQL datetime via `utils/localTime.ts` — never UTC `toISOString`, guardrail B4),
- `attempts_log TEXT` (JSON array, capped at the last 10 entries: `{ ts, result, error }`).
Registered in **all three** schema spots: full DDL block, fast-boot DDL duplicate, and the `ensureSchema` alterStatements guard list (`src/database.ts` **~2449–2467, ~4195, ~4281**) — BACKEND SCHEMA SAFETY rule. Old DBs upgrade on boot; fresh installs get them from CREATE.

**C2. Boot recovery rewrite** (`cleanupOldSentItems`, `whatsappQueueWorker.ts:684–733`):
- Pre-boot `pending`/`failed_offline` items created within the last 24 h are restored to `pending` for **ALL types** (retry budget preserved; `failed_offline` keeps its `retry_count`).
- Before restoring, each item is cross-checked against the Sent Register; proven already-delivered rows are marked `sent` automatically (no double sends after a power-cut retry).
- Items older than 24 h keep the existing stale-backlog skip (`skipped_offline`) — no old-backlog blasts.
- Genuinely ambiguous `sending` rows keep the existing treatment (`sent` on register match, else `review_required` with the truthful "App restarted during send" wording).
- The `last_clean_shutdown` flag may refine messaging in error text, but resume logic is driven by item age (per user decision: everything queued **today** resumes), not by guessing at crash type.

**C3. Auto-kick after recovery.** `triggerProcessing()` is called whenever ANY items were restored (currently only distributor restores kick it). The worker's own gating (dispatch only when WhatsApp ready; silent restore backoff) already prevents burning retries mid-boot-restore — nothing else needed.

**C4. Attempt recording.** Every dispatch attempt writes `last_attempt_at` and appends `{ts, result, error}` to `attempts_log` (failures: `failed_offline`/`failed_perm`/`review_required`; skips and sends recorded once with final result). Write failures are caught and ignored — recording must never break a send.

**C5. Truthful report in the app.**
- Extend `GET /whatsapp/queue/status` (`src/routes/whatsappQueue.ts`) to include per-item `retry_count`, `last_attempt_at`, and parsed attempt counts (+ today's rational summary strip: Sent / Failed / Pending / Review / Skipped counts).
- `frontend/src/components/WhatsAppQueuePopover.tsx`: per-item card shows "Tried 2× · last 10:32 · WhatsApp offline"; the report strip renders the counts. Existing **Retry All / Resend / Clear failed** actions and the Layout.tsx 15-minute failure-toast freshness guard stay untouched.
- Semantic Tailwind tokens only (`bg`, `bg2`, `bg3`, `text`, `muted`, `border`, `glass-*`) — no raw colors; no new polling timers (popover keeps its existing fetch + SSE model).

---

## 4. Architecture layers touched (knowledge-graph mapping)

| Layer | Files |
|---|---|
| `layer:service` (core processing pipeline) | `src/services/whatsappQueueWorker.ts`, `src/services/refillService.ts`, `src/services/refillCartService.ts` |
| `layer:api` (notification broker surface) | `src/routes/refills.ts`, `src/routes/whatsappQueue.ts` |
| `layer:data` | `src/database.ts` (2 additive columns × 3 registration spots) |
| `layer:presentation` | `frontend/src/components/WhatsAppQueuePopover.tsx` (+ `frontend/src/services/api.ts` typed wrappers) |
| `layer:testing` | new/extended jest suites |

---

## 5. Execution phases (build order, each phase independently verifiable)

- **Phase 1 — Ingestion & Validation (no code).** On a copy of the shop DB: (a) build the morning briefing for a patient completed yesterday with interval ≤ 7 days → shows the completed patient (repro); (b) run a cart popup against a completed refill → row reported (repro); (c) simulate crash with pending rows → boot → they land in `review_required` (repro). Snapshot baseline of related jest suites (known better-sqlite3 ERR_DLOPEN flakiness — compare per-suite, isolated runs only).
- **Phase 2 — Schema.** Add the two columns (both boot paths + guard list). Verify upgrade on a copy of the live DB and fresh-install CREATE. `tsc --noEmit`.
- **Phase 3 — Core pipeline (Fix C2–C4, B1).** Boot recovery rewrite + auto-kick + attempt recording + enqueue merge engine with unit tests (merge, cap, media exclusion, briefing exclusion, fallback-on-error, register cross-check).
- **Phase 4 — Owner-surface purity (Fix A).** Briefing today-list, staged-count filters, cart-run guard, cart-summary filter, purge call-site audit. `tests/` suite from A6.
- **Phase 5 — Frontend truth report.** Status endpoint fields + popover cards/strip. Manual check in Day & Night themes.
- **Phase 6 — Wrap-ups.** Re-run Phase 1 repros → all three pass as fixed. `npm run guardrails`, `node scripts/quick-update.mjs`, register P2-108/109/110 in `SMALL_BUG_FIX_PLAN.md` (Open → Fixed), 8-point data audit in the final report.

---

## 6. Error boundaries

| Boundary | Behavior |
|---|---|
| Merge (append) fails mid-write | Fall back to standalone enqueue — user message always goes out; never dropped, never blocked |
| `attempts_log` JSON write fails | Caught and ignored; send flow continues (recording is best-effort, send truth stays in `status/sent_at/register`) |
| Recovery query fails | Caught and logged; recovery falls back to the conservative old behavior (review_required) rather than mass-resending |
| Cart-run guard DB hiccup | Refusal ("cannot verify current status") over silent proceed — per Strict Legitimate Data contract, invalid/missing → reject, never invent |
| Empty owner number | Producers already answer `queued:false` + reason — unchanged; no fabricated recipient |
| Message with damaged/no section titles | Divider insertion is formatting-only; body text is passed through verbatim — no invented content |

## 7. Rollback strategies

1. **Per-phase commits** in that order; each phase reverts independently without stranding the others.
2. Schema is **additive only** — reverting code leaves two harmless unused columns; no data loss either direction. No destructive migration, no column removal.
3. The merge engine is a pure alternate path inside `enqueue()` bypassed by one predicate — rollback = restore the predicate/guard commit.
4. Boot-recovery rewrite preserves the old code path shape; rollback is a plain revert with no data fixtures to clean.
5. Before running Phase 1 on the shop DB copy, the standard pre-work backup applies (existing backup flow; `npm run drill` restorability proven elsewhere).
6. The user-sent truth (Sent Register, `sent_at`) is never deleted/rewritten by this plan, so a rollback cannot make the app less truthful about history.

## 8. What NOT to touch (regression shield)

- Timing floor 10–15 s and pacing config (bug P1-33); enqueue dedupe `skip_dedupe` semantics (P1-36/37); the ONE-processor rule (no second loop on `whatsapp_send_queue`); the Pharmarack order-sync merge contract and its `announce_result` audit; `collectionReminderWorker` (only its queued rows are affected by recovery, the worker itself is unchanged); media/file handling; chatbot conversational bypass; Layout.tsx failure-toast freshness guard; no-GPU rendering switches; `whatsapp_sent_register` writers; boot-phase timings (T+30s/T+45s/T+60s).

## 9. Acceptance criteria (mapped to the owner's words)

1. ☀️ Morning briefing lists **only people who are not complete and actually due today** — a completed patient never returns until their real due date (answers "only the person not complete message").
2. Refill cart list/briefing counts never contain completed patients (answers "cart list").
3. The owner getsrap **ONE combined message** for same-day admin queues (briefing always alone) (answers "combine in one message and send").
4. After a power cut, the app on next boot auto-resends everything queued today once WhatsApp is ready, records every attempt, shows per-item "tried N×, last error" and a today report — the owner sees the true state and the remaining to-dos in the app (answers "actual true report / things to do").
