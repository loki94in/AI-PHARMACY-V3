# Refill Quick Assist Complete Workflow — Implementation Plan (PLAN ONLY, no code changed)

> Scope: Quick Assist refill 7-day workflow only. No source file was modified to produce this plan.
> User decisions locked: (1) Complete closes the cycle AND opens POS prefilled; cycle stays closed even if the POS bill is never saved. (2) Snooze lives in Stage A only.

## 1. Binding contracts (read before implementing)

- `AGENTS.md` (root): DOX chain, knowledge-graph update, guardrails, manual-only patient messaging, legitimate-data audit.
- `AGENT_DATA_FLOW_TREE.md` §6–§7: CRM `/crm?tab=refills` (`patient_refills` via `GET/POST/PUT /api/refills`) is the writer; Quick Assist (`QuickAssistSidebar` in `frontend/src/components/Layout.tsx`) is a mirror using the same `api.getRefills()` / same status routes; POS is the only sale writer via `location.state.prefill`. No second refill table, no second checkout, no writes from workers.
- `src/AGENTS.md`: refill → live-cart contract, hot-path `/refills/panel` two-pass rule, `mark-ready` / `fulfill-all` semantics.
- `frontend/AGENTS.md`: single global SSE, mark-stale-only invalidation, `RefillOrderModal` + `refillCartJobs.ts` runner, staged 3-button workflow, `dropdown-scroll` + Esc contract.
- `BACKEND SCHEMA SAFETY.md`: this plan needs NO migration (all tables/columns already exist on both boot paths). Verify only.

## 2. OLD workflow (as-is, verified from code)

- Visibility: `frontend/src/components/QuickAssistSidebar.tsx:680-700` filters `refills` to `is_active=1`, `next_refill_date` present, status not `completed/fulfilled/canceled`, due within overdue..+7 days. Grouped in `groupedActionableRefills:702-850`, optimistic-hide via `optimisticHiddenRefillKeys`.
- Stage switch: `frontend/src/utils/refillSettled.ts:20-26` `getRefillStage()` — `upcoming` (none ordered) / `ordered` (ordered, none reminded/ready) / `reminded` (`is_ready=1` or reminded).
- Quick Assist Stage A today (`QuickAssistSidebar.tsx:1485-1536`): `[Confirm?] [Add to Cart (n)] [Already Added] [Fulfill] [Edit]`. NO Snooze on the refill card (snooze exists only for staged groups + CRM overflow).
- Quick Assist Stage B/C today: `[Mark Ready] [POS] [Fulfill]` / `[Re-Send Reminder] [POS] [Fulfill]` (`QuickAssistSidebar.tsx:1539-1621`). `openPos:1401-1437` hides optimistically, calls `POST /sales/counter-session {autoFulfill:true}` then navigates to `/pos` with `prefill {patientName, patientPhone, refillPatient, refillIds, medicines[]}`.
- CRM parity (`frontend/src/pages/CRM/RefillsSection.tsx:1697-1807`): Stage A `[Confirm & Cart] [Add to Cart] [Already Added] [Edit]`; Stage B/C `[Mark Ready / Re-Send] [POS]`; Snooze + Fulfill Cycle live under `•••` overflow (`RefillsSection.tsx:1819-1874`, `handleSnoozePatient:756-774` → `POST /automation/notifications/snooze-patient`, `handleFulfillAllForPatient` → fulfill-all).
- Add-to-Cart popup: BOTH surfaces already use the same `frontend/src/components/RefillOrderModal.tsx:36` (qty `orderQty` +/- , full/shortage mode) → `onConfirm` → `startRefillCartJob()` (Quick Assist `:2526-2554`, CRM `:2951-2985`). No fork today.
- Mark Ready: `handleMarkRefillGroupReady:328-365` → `POST /refills/patient/:phone/mark-ready` (`src/routes/refills.ts:2839-2956`). Sends collection WhatsApp on user click only (60-min dupe suppression), sets `is_ready=1`, `reminder_status='SENT'`, and clears live-cart lines via `removeRefillCartLines:2936`.
- Fulfill single/all: `POST /refills/:id/fulfill` (`src/routes/refills.ts:1559-1654`) and `POST /refills/patient/:phone/fulfill-all` (`:1657-1793`, also `/fulfill-all`). Advances `next_refill_date = now + refill_interval_days`, inserts `refill_fulfillments` (`fulfilled_via`: `crm_complete` / `quick_assist_complete`), resets cart/status/reminder columns, purges queue via `purgePendingCustomerReminders`, broadcasts `refill_updated`. Quick Assist `handleFulfillRefillGroup:394-438` hides optimistically and rolls back on error/timeout.
- POS open auto-fulfill: `POST /sales/counter-session` (`src/routes/sales.ts:131-244`) with `autoFulfill:true` fulfills by explicit `refillIds` (or phone) as `fulfilled_via='pos_opened'` (`sales.ts:200-203`).
- POS save attach (no double-advance): `src/routes/sales.ts:799-814` — if a `pos_opened` fulfillment exists within 30 min, the save only attaches `invoice_id/invoice_no` and flips to `pos_sale`; otherwise inserts a new `pos_sale` fulfillment and advances the schedule.

## 3. Gaps this plan fixes

1. No Snooze on the Quick Assist refill card (only CRM overflow) — user asked for Stage A Snooze.
2. `Fulfill` today does NOT open POS; `POS` today auto-fulfills on open via a different path (`pos_opened`) — two paths, confusing ownership, and a bill that fails phone/medicine match leaves the card stuck with no one-click escape.
3. Risk of double-advance once Complete also opens POS (fulfill-all + counter-session + sale save = three writers).

## 4. NEW workflow (to implement)

```
7-day due card (unchanged filter)
  Stage A (upcoming): [Add to Cart] [Already Added] [Snooze] [Edit]
    Add to Cart -> RefillOrderModal (qty editable, full/shortage) -> startRefillCartJob
    Already Added -> markRefillOrdered (manual/phone order, no cart write)
    Snooze -> POST /automation/notifications/snooze-patient {days: 1/3/7}
  ↓ ordered
  Stage B (ordered): [Mark Ready] [Complete]
    Mark Ready -> POST .../mark-ready -> collection WhatsApp queued (user click),
                  is_ready=1, live-cart lines auto-removed
    Complete -> fulfill-all (quick_assist_complete) + open POS prefilled (see §5)
  ↓ ready/reminded
  Stage C (reminded): [Re-Send Reminder] [Complete]
    Re-Send -> POST .../mark-ready (same collection message, 60-min suppression)
    Complete -> same as Stage B Complete
```

- `Confirm` / `Confirm & Cart` buttons stay as-is (no change).
- Standalone `POS`-only button is REMOVED from refill cards once Complete owns the POS handoff (avoids two fulfill paths). CRM `handleSellRefillPatient` (`RefillsSection.tsx:777-809`) is the reference prefill shape.
- Complete is idempotent: double-click guarded by `fulfillingRefillKeys`; backend `fulfill-all` stays transactional; sale-save attach window extended to recognise `quick_assist_complete` (see §6).

## 5. Complete + open POS semantics (locked)

1. Click Complete → optimistic hide (`optimisticHiddenRefillKeys`) → `POST fulfill-all {refill_ids, fulfilled_via:'quick_assist_complete'}` → on success `refillEvent.triggerRefresh()` + navigate `/pos` with `prefill {patientName, patientPhone, customerId?, refillPatient:true, refillIds, medicines[{medicine_id, medicineName, quantity_needed}]}`.
2. Cycle is CLOSED at step 1 even if the user never saves the POS bill (next due date already advanced, card gone after refresh because `diffDays ≈ interval > 7`).
3. If the user DOES save the POS bill within 30 min, `src/routes/sales.ts` must ATTACH `invoice_id/invoice_no` to the existing fulfillment row instead of inserting a second advancement (extends current `recentPosOpened` check to include `quick_assist_complete`).
4. On fulfill error/timeout → rollback optimistic hide, error toast, card stays. No silent closes.
5. Complete also clears cart state (`cart_* = NULL` in fulfill-all) so the medicine auto-leaves the live cart; Mark Ready already removes exact cart lines (`removeRefillCartLines`).

## 6. Backend reuse (no new tables, no migration)

| Need | Reuse | Change |
|---|---|---|
| Snooze | `POST /automation/notifications/snooze-patient` | none (call from Quick Assist) |
| Mark Ready / Re-Send | `POST /refills/patient/:phone/mark-ready` (`refills.ts:2839`), single `POST /refills/:id/mark-ready` (`:2959`) | none |
| Complete | `POST /refills/patient/:phone/fulfill-all` (`refills.ts:1657`) with `refill_ids` | label `fulfilled_via='quick_assist_complete'`; keep transaction + purge + broadcast |
| POS attach | `src/routes/sales.ts:799-814` | extend `recentPosOpened` lookup to `fulfilled_via IN ('pos_opened','quick_assist_complete')` within 30 min; keep no-double-advance |
| Counter-session | `POST /sales/counter-session` | Complete path should NOT call it with `autoFulfill:true` (cycle already closed); call with `autoFulfill:false` or skip, pass `refillIds` only for reminder-suppression context |

Schema verification only: `patient_refills`, `refill_fulfillments`, `whatsapp_send_queue`, `automation_notifications` exist on fast-boot + full DDL. No version bump.

## 7. Frontend changes (minimal, surgical)

- `frontend/src/components/QuickAssistSidebar.tsx`
  - Stage A: add Snooze control calling `snooze-patient` (default +1 day; keep +1/+3/+7 if space allows, else +1 to match "Stage A only" + keep card compact). Keep `Add to Cart`, `Already Added`, `Edit`.
  - Stage B/C: replace `[Mark Ready/Re-Send] [POS] [Fulfill]` with `[Mark Ready/Re-Send] [Complete]`; `Complete` = `handleFulfillRefillGroup` + POS navigation (merge of current `handleFulfillRefillGroup:394` and `openPos:1401`).
  - Keep `fulfillingRefillKeys` guard, optimistic hide + rollback, `refillEvent.triggerRefresh()`, SSE mark-stale-only (no eager refetch, no new timers).
  - `RefillOrderModal` props: verify parity with CRM (`quantity_needed`, `in_stock_qty`, `packaging`, `linked_distributors`, `onMedicineLinked` refresh). No fork, no second modal.
- `frontend/src/pages/CRM/RefillsSection.tsx`: no workflow change; reference implementation only.
- `frontend/src/utils/refillSettled.ts`: no change (`getRefillStage` stays the stage switch).
- UI rules: semantic Tailwind tokens only, `dropdown-scroll` on any new list, `useModalEscape` on popup, no `alert()/confirm()`, no endless animations.

## 8. Contracts preserved

- One writer per fact: refills via `/api/refills` routes; POS alone writes `sales_invoices`/`sale_items`.
- Manual-only patient messaging: `mark-ready` collection message fires from user click only; fulfill paths never send patient WhatsApp; purges only.
- Legitimate data: no invented qty/phone/dates; missing phone → `refill_ids` path (already supported by fulfill-all); missing stock → refused at POS, card stays for manual Complete.
- Performance: reuse 45s fulfill timeout pattern (P2-87), single global SSE (`refill_updated`), no new `setInterval`/`refetchInterval`.

## 9. Verification (for the build agent)

1. `npm run guardrails` exit 0; `tsc --noEmit` clean.
2. Manual: 7-day card → Snooze hides/delays; Add to Cart opens qty-editable popup (same as CRM); Already Added → stage flips to Mark Ready; Mark Ready queues ONE collection WhatsApp + clears cart line; Complete removes card + advances `next_refill_date` by `refill_interval_days` + opens POS prefilled; saving POS bill attaches invoice without second advancement; abandoning POS keeps cycle closed.
3. Regression: CRM overflow Snooze/Fulfill, POS direct sale without refill linkage (card stays), phone-less patient (name-key group completes via `refill_ids`).
4. `node scripts/quick-update.mjs` after changes; update `SMALL_BUG_FIX_PLAN.md` only if a defect is fixed in passing.

## 10. Audit + DB report (pre-implementation)

- Existing dummy/fallback logic found: none in this path (no `B-*`/placeholder quantities; `quantity_needed || 3/1` defaults are existing Bill-quantity fallbacks, unchanged).
- Changed by THIS plan doc: none (doc-only).
- New dummy logic introduced: none.
- Missing-data handling: phone-less → `refill_ids`; unmatched POS sale → card stays actionable for manual Complete.
- Auto-created records: only legitimate `refill_fulfillments` + queue rows on user click (unchanged semantics).
- DATABASE CHANGES: tables/columns/indexes/constraints/migration/schema-version: NONE required.
- VERIFICATION: fresh DB / existing DB / runtime DB / API / frontend / regression: TO BE RUN by build agent (this doc makes no code claim).
- SCHEMA ERRORS: none (no query added against unverified objects).
- FILE SCOPE (this step): added `REFILL_QUICK_ASSIST_COMPLETE_WORKFLOW_PLAN.md`; modified: none; unrelated files: none.
