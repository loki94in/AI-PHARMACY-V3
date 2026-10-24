# Implementation Plan — Pharmarack Checkout Truth Fix (False-Failure Fallback + Duplicate Order Reminder)

> **Status:** COMPLETED — Fully implemented and verified.
> Created: 2026-10-24 · Evidence collected live from repository source (`src/`, `frontend/src/`) and prior session browser/window behavior reported by the owner.
> Proposed bug-register IDs: **P2-109** (checkout false-failure fallback) and **P2-110** (duplicate order-ID reminder) — confirm the next free ID against `SMALL_BUG_FIX_PLAN.md` Section 4 during implementation.

---

## 1. Summary of Actions Taken (this session)

| Action | Result |
|---|---|
| Zero-Touch Verification | Read-only diagnosis across `src/services/pharmarackCheckoutService.ts`, `src/routes/pharmarack.ts` (lines 2880–3227), `src/services/pharmarackOrderSyncService.ts`, `src/routes/whatsappQueue.ts`, `frontend/src/pages/PharmarackCart/index.tsx`, `frontend/src/services/api.ts`. **No file modified.** |
| Agent Role Mapping | Verified and mapped the three roles below (Section 4) — Ingestion & Validation, Core Processing Pipeline, Notification Broker — against the real live order-placement chain. |
| Blueprint Structure | Outlined architecture layers, execution phases, error boundaries, and rollback strategies (Sections 5–10). |
| Owner Confirmations | (1) Fix scope = both bugs, full plan A–D. (2) When the fallback window opened automatically, the live cart was already empty (order was actually placed; no duplicate order went out) — this fact became the "live-cart truth rule" (Section 3). |
| Bug Register | `SMALL_BUG_FIX_PLAN.md` updates are deliberately deferred to the implementation phase (listed there) to keep this session zero-touch. |

---

## 2. Problem Statements (with recorded evidence)

### P2-109 — App places the order successfully, then treats it as failed and auto-launches the Chrome fallback

**Chain (verified in code):**

1. Final click → `POST /api/pharmarack/cart/place-official-orders` → `placeOrdersViaApi()` → `SaveOrderCartForRetailerManager` with `AbortSignal.timeout(30000)` (`src/services/pharmarackCheckoutService.ts:277-289`).
2. Success-parse is too narrow (lines 312-338): recognized ONLY via a `DisplayStoreOrder` array with per-store `OrderNo`/`Status:'success'`, or `Message === 'success'` / `code 200`. Other reply shapes → zero results → `ok:false, placedCount:0`.
3. Timeout race: a slow Pharmarack reply aborts **after** the order was really created server-side → catch (line 354-363) returns `ok:false` even though placement succeeded.
4. Route-level rescue is unreliable (`src/routes/pharmarack.ts:3012-3047, 3176`): `success = checkoutResult.ok || syncedToday.length>0 || placedCount>0`; the immediate 1–2 attempt sync (~1.5 s) usually does not yet contain the just-placed order (Pharmarack's `DisplayOrders` list lags), so `success:false` is returned.
5. Frontend catch (`frontend/src/pages/PharmarackCart/index.tsx:3337-3394`): `success:false` → `throw` → catch → `api.openOfficialPharmarackCartWindow()` → Chrome auto-opens with no verification that the cart still holds items.

**Consequence:** a window opens showing an empty cart (the order already went through), a fake "failed" toast, and a latent duplicate-order risk if the user re-clicks. Owner confirmed: cart empty, order already placed.

### P2-110 — Two reminder messages sent for one new Order ID (need exactly one)

**Two independent writers race when a new OrderNo is noticed today:**

- **Writer A — route STEP 4** (`src/routes/pharmarack.ts:3083-3163`): enqueues `📦 Pharmarack order #N — has it been dispatched or collected by <boy>?` with **`skipDedupe: true`**, 5-min grace hold, then marks `pharmarack_synced_orders.announced_at = CURRENT_TIMESTAMP, announce_result='held_in_grace_period'` (unconditional UPDATE, no claim).
- **Writer B — `runSync()` announcements** (`src/services/pharmarackOrderSyncService.ts:379-448`): the ordering is `placeOrdersViaApi` fires sync at its line 345 AND the route's attempt loop (pharmarack.ts 3026-3046) runs **before** STEP 4. Writer B notices the fresh OrderNo while `announced_at` is still NULL → decision branch (2) `isOrderAnnouncement` or branch (3) `followUp` queues its OWN message (also 5-min grace).
- Both queue messages ≈ back to back → 2 WhatsApps to the same distributor. Writer B's waiting-merge check (lines 388-403) only sees messages already queued, and it runs before STEP 4 enqueues; STEP 4 never checks the queue or `announce_result` before sending and bypasses the queue dedupe with `skipDedupe:true`.
- If STEP 4 happens to run first, `announced_at` blocks Writer B ('already_announced_earlier') → only 1 message. The race direction decides the outcome — hence intermittent.

**Existing safety nets that must keep working:** queue-worker same-day dedupe, `distributorDispatchReminders` status gates (P1-15 fixes), audit endpoint `GET /api/pharmarack/sync-orders/audit` → `distributors_with_multiple_reminders` (the double-send check, `pharmarackOrderSyncService.ts:597-628`).

---

## 3. Owner-Confirmed Truth Rule ("live-cart rule")

After the final place-order click, the app checks the LIVE CART:

1. **Cart empty for the target stores** → everything was placed → app shows nothing (no Chrome fallback, no failure toast); success toast carries the really-synced Order ID(s).
2. **Something still remaining in the live cart** → show ONLY those remaining (non-placed) items for the target stores, and only then the one-click fallback window applies.
3. The cart-emptied signal is used for UI + fallback gating ONLY — it never fabricates an `OrderNo` from the store.
4. Token-expired / genuinely-failed placements keep today's working fallback behavior (owner values it).

---

## 4. Agent Role Mapping

| Role | Modules | Responsibility in this fix |
|---|---|---|
| **Ingestion & Validation** | `placeOfficialPharmarackOrders()` (frontend `PharmarackCart/index.tsx`), `POST /pharmarack/cart/place-official-orders` (backend) | Owns the placement call, truthful post-checkout verification (forced order sync + live-cart read), and the response the UI acts on. |
| **Core Processing Pipeline** | `pharmarackCheckoutService.placeOrdersViaApi`, `pharmarackOrderSyncService.runSync` | Reclassifies ambiguous placement replies with real fetched evidence; atomically claims `pharmarack_synced_orders.announced_at` before any announcement. |
| **Notification Broker** | route STEP 4 enqueue, `whatsappQueueWorker.enqueue` dedupe, `sendDistributorDispatchReminder`, audit trail | Single-writer delivery of the order-ID reminder; loser of the atomic claim never queues a second message; every decision recorded in `announce_result` + `action_logs`. |

---

## 5. Blueprint — Exact Changes Per File

### A. `src/services/pharmarackCheckoutService.ts` — truthful verification before declaring failure

In `placeOrdersViaApi`, for ambiguous outcomes ONLY (throw/timeout/abort, or HTTP-2xx reply that parses to zero results):

```
if (results.length === 0 && orderRes was sent OK)   // or caught timeout AFTER request dispatched
  await syncPharmarackOrders(true);                 // force: bypasses 5-min throttle
  for each targetStore:
    fresh = SELECT order_no, first_seen_at FROM pharmarack_synced_orders
            WHERE order_date = today AND store matches (letters+digits normalize, both-way containment)
              AND first_seen_at >= attemptStartMs;
    exists ALSO in pharmarack_placed_orders (today) → reclassify that store { status:'placed', orderNo: fresh }
  nothing found → store stays { status:'failed', error: real error }
```

- `attemptStartMs` captured before the save-order fetch. Strict evidence only: a confirmed today row fetched from Pharmarack's own order list. No invented OrderNo (Strict Legitimate Data contract).
- Keep the existing two sync attempts and STEP-4 blank-reminder suppression in the route untouched in this file's scope.

### B. `src/routes/pharmarack.ts` — `/cart/place-official-orders`

1. After the existing 2-attempt sync loop: if any target store still has no order number, ONE final forced `syncPharmarackOrders(true)` after a single 3–5 s wait (bounded, no loop), then re-read `pharmarack_synced_orders` for `success` computation.
2. **Response adds the live-cart rule payload:** after `invalidatePharmarackCartCache()`, perform ONE fresh `loadLiveCartCore()` read and include per-target-store `remaining` items (rows still sitting in the live cart) in the JSON response. One single read, not a fetch storm.
3. **STEP 4 becomes claim-based (single writer):**

```
claim = UPDATE pharmarack_synced_orders
        SET announced_at = ?, announce_result = 'held_in_grace_period'
        WHERE order_no = ? AND announced_at IS NULL;      // atomic claim via changes count
if (claim.changes === 0) → a sync announcement already owns this order → settle/log 'already_announced_earlier' path, skip enqueue;
else → pre-check Writer B's waiting-queue query (pending/failed_offline reminder for this distributor today);
       if a waiting reminder already covers #N → skip enqueue (message already merged);
       enqueue distMsg WITHOUT skipDedupe (restores the queue's same-day number+text dedupe as a second net);
       if enqueue throws → un-claim: UPDATE ... SET announced_at = NULL, announce_result = 'claim_failed' WHERE order_no = ? (so recovery can retry truthfully)
```

4. Existing update/insert into `pharmarack_placed_orders` (batch_sent flags, order_no attach) stays as-is.

### C. `src/services/pharmarackOrderSyncService.ts` — Writer B respects the same claim

In `runSync()` announcement section (both `isOrderAnnouncement` branch and `followUp` branch), before calling `sendDistributorDispatchReminder`:

```
claim = UPDATE pharmarack_synced_orders SET announced_at = ?, announce_result = 'claim_pending_send'
        WHERE order_no IN (freshOnlyOrderNos) AND announced_at IS NULL;
if (claim.changes < freshOnlyOrderNos.length) → some/all already claimed by STEP 4 →
   settle only the unclaimed subset (or all 'already_announced_earlier' when changes === 0); skip the message.
else → send; settle 'dispatch_reminder_queued'/'follow_up_queued' as today.
```

- `settle()` already writes `announce_result` + `action_logs` — reuse; do not add parallel tables (Data-Flow Tree: one writer per fact).
- Merge-into-waiting-reminder branch (lines 388-403) keeps behavior; the claim precedes it so a losing sync can never merge-and-send twice.

### D. `frontend/src/pages/PharmarackCart/index.tsx` — verify-before-fallback (catch at ~3382 only)

The two user-clicked manual open buttons (~6128, ~7420) are UNTOUCHED. In the automatic batch catch:

```
1. call api syncPostCheckout (already exists, services/api.ts:1560)
2. read the response's remaining-cart state (backend Field added in B.2)
   - nothing remains for the target stores → toast "✅ Official order(s) placed (Order #N…)" from REALLY synced orders; NO Chrome window; NO phantom failure; refresh cart/pending/history
   - something remains → show ONLY the remaining (non-placed) items (existing cart render + fetchCart(false)); then open the one-click fallback for those leftovers (existing toast wording kept truthful)
3. network-level catch of the verify call itself → fall back to today's behavior (open window) — never silently swallow
```

### E. Docs (contract-required, done during implementation)

1. `SMALL_BUG_FIX_PLAN.md`: register both bugs with evidence + fix notes (Open → Fixed).
2. `src/AGENTS.md` "Pharmarack Order Sync & Order Numbers in Reminders": add the atomic-claim rule (STEP 4 and sync announcements both read/claim `pharmarack_synced_orders.announced_at`; `skipDedupe` must not be re-added to STEP 4).
3. Run `node scripts/quick-update.mjs` after every touched file; `npm run guardrails` must exit 0 before completion.

---

## 6. Execution Phases

| Phase | Work | Exit condition |
|---|---|---|
| 0 — Preflight | Baseline `GET /api/pharmarack/sync-orders/audit` snapshot; confirm next free register IDs; re-read `SMALL_BUG_FIX_PLAN.md` Section 4 for regressions (P1-15 double-send fixes must keep passing). | Snapshot recorded |
| 1 — Backend truth (A + B.1/B.2) | Verification reclassification + final sync attempt + `remaining` response field. | `tsc --noEmit` clean; ambiguous reply reclassified with real OrderNo |
| 2 — Single reminder claim (B.3 + C) | Atomic claim both sides; drop `skipDedupe`; un-claim on enqueue failure. | One message per distributor per OrderNo under both race orders |
| 3 — Frontend guard (D) | Verify-before-fallback with live-cart rule. | Empty cart → success toast + no window; leftovers → fallback for remaining only |
| 4 — Docs (E) | Register entries + src/AGENTS.md contract wording. | Docs consistent |
| 5 — Machine checks | `node scripts/quick-update.mjs`; `npm run guardrails` (exit 0). | Both pass |

---

## 7. Error Boundaries & Rollback Strategies

| Boundary | Handling |
|---|---|
| Sync fetch fails during verification | Store stays `failed` with the REAL error; no partial reclassification; route still computes success from whatever is confirmed. |
| STEP 4 claim won but enqueue throws | Un-claim (`announced_at = NULL`, `announce_result = 'claim_failed'`) so `recoverTodayUnnotifiedOrders` / next sync can retry truthfully. |
| Claim lives in an autocommit statement | All claim/UPDATE work uses existing plain `db.run` autocommit pattern — no `BEGIN` opened (One-Open-Transaction-Per-Request contract). |
| Route 500 thrown AFTER placement (e.g., STEP 4 error) | Frontend verify-before-fallback catches it: sync-post-checkout shows the order went through → success toast, no window. |
| Loss of correctness | The `announce_result` values (`held_in_grace_period`, `claim_pending_send`, `already_announced_earlier`, `claim_failed`) ride existing schema columns — **no schema changes, no migrations**. Rollback = `git revert` of the 3 src files + 1 frontend file (+ docs), no data state to reverse. |
| Duplicate-queue worst case if rolled back | Existing P1-15 guards + `distributors_with_multiple_reminders` audit remain intact and would flag it; nothing degrades silently. |

---

## 8. Verification & Acceptance Criteria

1. Live batch send → the audit endpoint `GET /api/pharmarack/sync-orders/audit` shows **empty `distributors_with_multiple_reminders`** and exactly ONE `distributor_dispatch_reminder` message per distributor per OrderNo.
2. `dryRunOrderSync()` decisions show merge / already-announced outcomes; never a second queued message for the same OrderNo.
3. Simulated slow Pharmarack reply (dev-only forced timeout on `SaveOrderCartForRetailerManager`) → verification reclassifies the store as `placed` with the real OrderNo fetched from Pharmarack's own order list; route answers `success:true`; NO fallback window; toast shows the Order ID.
4. Empty live cart after placement (owner-reported case) → app shows nothing for placed stores, success toast only.
5. Genuinely failed placement (token expired / API reject) → route `success:false` with the real error; frontend opens the one-click fallback exactly as today (owner-valued behavior preserved).
6. `npm run guardrails` exit 0; `node scripts/quick-update.mjs` graph updated; no new ESLint problems in touched frontend code (zero-`any` pattern kept).

---

## 9. Performance Guardrails Compliance

- **No new timers/loops**: one bounded final sync attempt per placement call; no polling; SSE broadcast points unchanged (`pharmarack_orders_changed`, `whatsapp_queue_updated`, `dispatch_updated` stay as-is).
- **Bounded network**: verification = existing forced `syncPharmarackOrders(true)` (single-flight, no browser) + ONE fresh `loadLiveCartCore()` read per placement response; frontend path = ONE `sync-post-checkout` call, never auto-retried.
- **No eager SSE refetch changes**: no `SSE_QUERY_MAP`/invalidation edits required; cart refresh uses the existing `fetchCart(false)` + `invalidatePharmarackCartCache()` wiring.
- **No-GPU contract untouched**: no UI animations/backdrop additions; fallback window behavior unchanged.

---

## 10. Implementation Checklist

- [x] A. `pharmarackCheckoutService.placeOrdersViaApi` — attemptStartMs capture + forced-sync verification reclassification
- [x] B1. Route: one bounded final sync attempt before success computation
- [x] B2. Route: `remaining` live-cart summary in the response (single read)
- [x] B3. Route STEP 4: atomic claim + waiting-queue pre-check + drop `skipDedupe` + un-claim on enqueue failure
- [x] C. `pharmarackOrderSyncService.runSync`: atomic claim before `isOrderAnnouncement` and `followUp` sends (winners send; losers settle)
- [x] D. Frontend catch: verify-before-fallback honoring the live-cart rule (manual buttons untouched)
- [x] E. `SMALL_BUG_FIX_PLAN.md` entries + `src/AGENTS.md` atomic-claim wording
- [x] `node scripts/quick-update.mjs` after each touched file
- [x] `npm run guardrails` exit 0
- [x] Acceptance criteria 1–6 verified on the live app
