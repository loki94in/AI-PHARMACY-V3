# Refill Complete Persistence Fix — Implementation Plan (PLAN ONLY, no code changed)

> **Status:** Open — plan only. No source file was modified to produce this document.
> **Priority:** P1 (daily workflow: completed refills reappear after app restart).
> **User symptom:** After clicking Fulfill Cycle / ✓ Complete / Complete, the app toasts success and the notification/history says the order was marked complete — but after restarting the app the same old refills are visible again.
> **Companion search rule (owner):** searching a medicine in the app must NEVER show any other/old order's data for that same medicine (stale order cache presented as current = fake data).

## 1. Binding contracts (read before implementing)

- Root `AGENTS.md`: DOX chain, `node scripts/quick-update.mjs` + `npm run guardrails` after changes, manual-only patient messaging, zero dummy-data + 8-point audit, single-writer data-flow rules.
- `AGENT_BUG_FIX_RULEBOOK.md` → this repo: `SMALL_BUG_FIX_PLAN.md` (bug register), `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` (page↔API↔table map).
- `AGENT_DATA_FLOW_TREE.md` §3/§6–§7: refill truth lives in `patient_refills` (writer = CRM refills tab, `GET/POST/PUT /api/refills`); Quick Assist shows the SAME rows (`api.getRefills()`); POS is the only sale writer via `location.state.prefill`. No second refill list, no second patient store.
- `src/AGENTS.md`: refill → live-cart contract, `/refills/panel` two-pass hot-path rule, POS sale fulfillment attach (`pos_opened`/`quick_assist_complete` → `pos_sale`, no double-advance).
- `frontend/AGENTS.md`: single global SSE, mark-stale-only invalidation, staged refill workflow, `getRefillStage()` ownership in `utils/refillSettled.ts`.
- Related plans (do not contradict): `REFILL_QUICK_ASSIST_COMPLETE_WORKFLOW_PLAN.md` (Complete closes cycle + opens POS; cycle stays closed even if POS bill never saved) and `QUICK_ASSIST_REFILL_COMPLETE_AUTO_REMOVE_PLAN.md` (POS banner suppression + linked special-order settlement). This plan covers what those two do NOT: **durability of the close across app restarts** + **search truthfulness**.
- `BACKEND SCHEMA SAFETY.md`: this plan needs NO migration (all tables/columns already exist on both boot paths). Verify only.

## 2. OLD behavior / OLD workflow (as-is, verified from code)

### 2.1 What "Complete" does today (backend)

1. `POST /api/refills/:id/fulfill` (`src/routes/refills.ts:1559`) — single medicine.
2. `POST /api/refills/patient/:phone/fulfill-all` (also `/patient/fulfill-all`, `/fulfill-all`) (`src/routes/refills.ts:1668`) — whole patient / `refill_ids` set, wrapped in `BEGIN TRANSACTION … COMMIT` (`:1715-1815`).
3. Status path `completed`/`fulfilled` (`src/routes/refills.ts:1884`, `handleRefillStatusUpdate`) — third write path doing the same job.
4. All three do: `INSERT INTO refill_fulfillments …` (history/audit row) + `UPDATE patient_refills SET next_refill_date = now + refill_interval_days, status='pending', is_ready=0, hold_for_stock=0, cart_*=NULL, reminder_*=reset …` (`:1602-1627`, `:1744-1769`, `:1929-1950`).

Key point: **the refill row is never closed/deleted — it stays `is_active=1, status='pending'` with a future `next_refill_date`.** The toast ("marked as fulfilled") and the fulfillment-history record (`GET /api/refills/patient/:identifier/history`, `:1846`) truthfully describe THAT cycle, while the row itself now represents the NEXT cycle.

### 2.2 What hides it today (frontend, in-memory only)

- Quick Assist `handleCompleteRefillGroup` (`frontend/src/components/QuickAssistSidebar.tsx:474-519`): adds `group.key` + phone + digits + name + medicine ids to `optimisticHiddenRefillKeys`, then calls `api.fulfillAllRefills` (`frontend/src/services/api.ts:1868`), then navigates to `/pos` with `prefill`.
- CRM `✓ Complete` (`frontend/src/pages/CRM/RefillsSection.tsx:631` → `POST /refills/:id/fulfill`) and `Fulfill Cycle` (`:647` → `fulfill-all`) rely on refetch only — no hide set at all.
- Quick Assist list filter (`QuickAssistSidebar.tsx:822-843`): keeps rows with `is_active===1`, `next_refill_date` present, `status NOT IN ('completed','fulfilled','canceled')`, and `diffDays <= 7`.
- **The status check never hides a fulfilled row** (backend reset it to `'pending'`). The ONLY thing hiding it is `diffDays <= 7` — i.e. only when `refill_interval_days` pushes the next date beyond 7 days.
- `optimisticHiddenRefillKeys` / `optimisticHiddenOrderIds` (`QuickAssistSidebar.tsx:81-82,1015-1033`) are React state: **lost on every app restart**.

### 2.3 What the list endpoints return after restart

- `GET /api/refills` (`src/routes/refills.ts:531-551`): returns up to 1000 rows with **no status/date filter**.
- `GET /api/refills/panel` (`src/routes/refills.ts:681-720`): without `upcoming_days` (neither Quick Assist nor CRM passes it) returns up to 1000 rows with **no status/date filter**.
- So after restart the just-fulfilled rows come back over the wire, the memory hide is gone, and the card reappears whenever ANY of these is true:
  a. `next_refill_date` did not actually persist (short-interval math, UTC-vs-local write skew — see §4.3 — or a partially applied write);
  b. `refill_interval_days` is short (e.g. ≤7), so the NEXT cycle is legitimately due within 7 days and looks identical to the old card;
  c. `fulfill-all` advanced only the requested `refill_ids` while sibling medicines of the same patient are still due — the patient group card returns with the remaining medicines and reads as "the old refills are back";
  d. boot-time `checkAllRefills` (`src/services/refillService.ts:19`) re-marks `is_ready=1` / recreates `quick_bill` / special-order / staged-notification rows for anything still inside the notice window.

### 2.4 OLD search behavior (fake-data risk)

- Refill/cart/search surfaces resolve products through several fallbacks today (first-hit, substring/`LIKE %name%`, other-distributor links, offline-catalog rows). Presenting **another order's or another cycle's stored product/qty/price** as the searched medicine's current data is fabricated business data (banned by root `AGENTS.md` §Strict Legitimate Data).
- This plan therefore locks the rule in §5 alongside the persistence fix: search may only render live-verified facts.

## 3. NEW behavior / NEW workflow (to implement)

```
Click Complete / Fulfill Cycle / ✓ Complete
  → backend closes THIS cycle durably (one tx, idempotent, local-time dates)
  → fulfillment-history row exists exactly once per cycle
  → row's next_refill_date is verifiably in the future
  → card disappears from every actionable surface immediately (no memory-only hide)
  → app restart changes nothing: card stays gone until the NEXT cycle
     enters the 7-day window, and then it renders as "Due <date>",
     never as the old cycle
  → fulfillment history keeps the audit trail (patient detail tab)
  → medicine search never renders another/old order's data as current
```

### 3.1 Durable close (backend, `src/routes/refills.ts` only)

1. Unify the three write paths (`/:id/fulfill`, `fulfill-all`, status `completed/fulfilled`) onto ONE helper (e.g. `closeRefillCycle(db, refillId, fulfilledVia)`): insert `refill_fulfillments` + advance `patient_refills` + close companion `special_orders` + `purgePendingCustomerReminders` + broadcasts — the fulfill-all body (`:1713-1832`) is the reference; single-fulfill (`:1559-1665`, currently autocommit without `BEGIN`) adopts its transaction shape.
2. Per-cycle idempotency: before inserting, check `refill_fulfillments` for an existing row with the same `refill_id` + `cycle_due_date` (= the row's pre-advance `next_refill_date` date part); if present, skip the insert and just ensure the schedule is advanced (double-click / retry / timeout-replay safe).
3. Keep `fulfilled_via` labels (`crm_complete`, `crm_single_complete`, `crm_batch_complete`, `quick_assist_complete`, `status_update`, `pos_opened` → `pos_sale`) — the POS 30-min attach (`src/routes/sales.ts`, per `src/AGENTS.md`) depends on them. No double-advance: attach path only stamps `invoice_id/invoice_no`.
4. Date correctness (B4): replace every `toISOString()` date write on these paths (`handleRefillStatusUpdate` `:1904-1905`, `PUT /:id` `:600`, `POST /:id/skip` `:655`) with `toLocalSqlDateTime()` from `src/utils/localTime.ts`. Bill/schedule dates are shop-local text; UTC writes skew the day boundary (same bug family as P1-71/P1-72).

### 3.2 Hide by durable fact, not by memory (frontend)

1. Quick Assist filter (`QuickAssistSidebar.tsx:822-843`) stays the single hide rule but gains a durable guard: a row whose `last_refill_date` is today (fulfilled this cycle) is excluded from the actionable list even if its next date falls back inside 7 days; it may surface only as a passive "Next due <date>" line, never as an actionable card. Keep `getRefillStage()` (`frontend/src/utils/refillSettled.ts`) as the only stage switch — extend it, don't fork it.
2. Prefer server filtering: pass `upcoming_days=7` to `GET /api/refills/panel` (already supported, `refills.ts:694-713`) for the Quick Assist query instead of fetching 1000 rows and filtering client-side. Keeps the hot-path two-pass rule intact (base query first, chunked ≤500 stock/link pass — `src/AGENTS.md`).
3. CRM tabs (`RefillsSection.tsx:1161-1199` Overdue/Lead-window logic): same durable guard — a cycle fulfilled today is not Overdue and not Lead-window regardless of date math edge cases. All/Active tabs keep showing the full schedule (that is their documented purpose); the fix is that a fulfilled cycle renders with its NEW next date, never the old one.
4. Remove dependence on `optimisticHiddenRefillKeys` as the hide mechanism (keep it only as instant paint until the refetch lands, with rollback on error as today).

### 3.3 Restart-proofing

- After any fulfill path: `refillEvent.triggerRefresh()` + existing SSE broadcasts (`refill_updated`, `app-refills-updated`, `order_updated`) stay the freshness mechanism (mark-stale-only; never eager `refetchQueries({type:'active'})` per `frontend/AGENTS.md`).
- Boot `checkAllRefills` must not resurrect a cycle fulfilled today: skip rows with `last_refill_date` = today when creating `quick_bill` / special-order / staged-notification side effects (`src/services/refillService.ts:92-173`).

## 4. Files the future implementation may touch (NOT touched by this plan)

| # | File | Change |
|---|------|--------|
| 1 | `src/routes/refills.ts` | Unified `closeRefillCycle` helper; tx for single-fulfill; idempotency check; local-time dates; `checkAllRefills` same-day skip |
| 2 | `frontend/src/components/QuickAssistSidebar.tsx` | Durable fulfilled-today guard in `actionableRefills`; `upcoming_days=7` panel query; keep optimistic hide as paint-only |
| 3 | `frontend/src/pages/CRM/RefillsSection.tsx` | Same guard in Overdue/Lead-window tabs; render advanced next date |
| 4 | `frontend/src/utils/refillSettled.ts` | Extend (don't fork) stage/settled definition if needed |
| 5 | `src/routes/sales.ts` | Verify-only: 30-min attach still recognises `quick_assist_complete`; no double-advance |
| 6 | `SMALL_BUG_FIX_PLAN.md` | Move this entry Open → Fixed on completion |
| — | Schema | NO migration (verify `patient_refills`, `refill_fulfillments` on both boot paths only) |

Out of scope: POS billing math, stock movement, WhatsApp queue behavior (purge stays user-click-driven per manual-only messaging contract), live-cart add flow.

## 5. Search truthfulness rule — NEVER show another/old order's data as the medicine's current facts

This is fake data and is banned (root `AGENTS.md` §Strict Legitimate Data; cart-add truthfulness contract `src/AGENTS.md` 2026-10-13; P2-89 `sameProductName` strict matching):

1. When the user searches a medicine (POS/Purchases/CRM/Pharmarack search), each result row may ONLY carry facts verified for THAT medicine from a live source: master `medicines` row, in-stock `inventory_master` batches, saved `medicine_distributor_links`, or a verified live-cart line.
2. NEVER fill a search row from another record: no other patient's order, no old `special_orders` row, no past `refill_fulfillments` row, no first-hit/substring (`LIKE %name%`) fallback, no other distributor's product code, no offline-catalog row presented as live, no `mrp*0.8`-style estimated rate.
3. Missing data stays missing: no link → `needs_link`; all linked OOS → `linked_oos`; nothing found → `not_found`. A failed live add answers `success:false` (never fake success).
4. Name matching on these paths goes only through the strict matchers (`sameProductName` / core-token equality); base-vs-Plus/DS-style variant bleed is a defect, not a fallback.
5. Concretely for refills: after Complete, searching that medicine must show its new schedule state (next due date) and live stock/links — never the closed cycle's distributor, qty, or cart line. `fulfill`/`fulfill-all`/status-completed already NULL `cart_*`; Skip keeps it (per data-flow tree §6) — preserve that distinction.

## 6. Verification (before done)

1. Complete a refill → `patient_refills`: `next_refill_date` advanced by `refill_interval_days`, `status='pending'`, `is_ready=0`; `refill_fulfillments` has exactly one row for that `cycle_due_date` (double-click adds none).
2. Card gone from Quick Assist + CRM Overdue/Lead immediately; fulfillment-history tab shows the record.
3. Restart app → card still gone; only reappears as "Due <date>" when the next cycle genuinely enters the 7-day window (temporarily set a 1-day interval to prove the positive case).
4. `fulfill-all` with partial `refill_ids`: advanced medicines stay gone; non-advanced siblings still show (correct — they are still due).
5. POS bill saved within 30 min attaches `invoice_id/invoice_no` to the existing fulfillment row; no second `refill_fulfillments` row, no second date advance.
6. Search the fulfilled medicine: no old cycle/order data rendered; unlinked → `needs_link`, OOS → `linked_oos`.
7. `npm run guardrails` exit 0; `tsc --noEmit` clean; `node scripts/quick-update.mjs`; move register entry Open → Fixed.

## 7. Risks / what not to touch

- Do not change the recurring-schedule model (row persists by design) — hiding is by durable date fact, not deletion.
- Do not add a second refill table, second checkout, worker-driven fulfills, or patient auto-messaging (manual-only contract).
- Do not widen `upcoming_days` filtering into other consumers of `/panel` (CRM All/Active need full schedules).
- Keep SSE mark-stale-only and the `/panel` two-pass query shape; keep `fulfilled_via` vocabulary stable for the POS attach path.
