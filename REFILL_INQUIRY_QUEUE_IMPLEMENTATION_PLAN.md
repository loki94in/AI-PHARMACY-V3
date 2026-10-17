# Refill Queue Order + WhatsApp Inquiry Visibility — Implementation Plan

> **Status:** Plan (not yet implemented)
> **Owner:** Pharmacy owner (single-store, shop-local time)
> **Created:** 2026-10-17
> **Scope:** Quick Assist sidebar, CRM → Special Orders, CRM → Refills
> **Type:** UX correctness fix — no new tables, no new endpoints, no data migration

---

## 0. Purpose

Two related problems make the shop's two daily queues (special orders and refills) show the **wrong rows in the wrong order**, so the pharmacist cannot tell "who is next" and sees orders they never created.

| # | Problem | Surface | Impact |
|---|---------|---------|--------|
| **A** | A customer's WhatsApp question about an out-of-stock medicine creates a `special_orders` row that renders **inside the normal order lists** as if the pharmacist had booked it | CRM → Special Orders (default tab), Quick Assist (Online Orders + Special Requests) | Pharmacist sees orders they never confirmed; queue is noisy; trust in the list drops |
| **B** | When a refill cycle is completed/fulfilled **early** (patient collects 2–3 days before the due day), that patient **stays at the top** of the refill list instead of dropping to the bottom | Quick Assist refills, CRM → Refills | The pharmacist cannot see the **next** patient; the list no longer reflects real work remaining |

This document explains **the present workflow**, **the root cause**, and **the target workflow**, then lists the exact implementation tasks.

---

## 1. Issue A — WhatsApp inquiry rows look like confirmed orders

### 1.1 What the user sees

A special order appears in the app **without the pharmacist creating it**. It carries real customer data (name, phone, medicine, quantity), so it looks like a booking.

### 1.2 Present workflow (actual, verified)

```
Customer sends a WhatsApp message asking for a medicine
        │
        ▼
src/services/whatsappIntentService.ts   handleInbound → searchAndBroadcast
        │  gate: hasOrderIntent && isConfirmedMedicine && confidence >= 80 && isOutOfStock
        │  (availability === 'REGISTERED_NO_STOCK' | 'EXTERNAL_ONLY')      [lines ~6914-6922]
        ▼
trackMedicineRequest({ ..., source: 'whatsapp_inquiry' })               [line ~6928]
        │
        ▼
src/services/shortageReminderService.ts  createSpecialOrderFromShortage
        │  targetStatus = 'Inquiry' when source includes 'whatsapp'
        │  INSERT INTO special_orders (..., status='Inquiry',
        │       source='whatsapp_inquiry', customer_order_source='whatsapp',
        │       notes='[WhatsApp Inquiry] Customer asked for <name>')       [line ~56-72]
        ▼
Row exists in special_orders (status='Inquiry')
        │
        ├──► GET /api/orders returns ALL statuses                       [src/routes/orders.ts:55-81]
        │
        ├──► CRM → Special Orders  (frontend/src/pages/CRM/SpecialOrdersSection.tsx)
        │        statusFilter default = 'All'                            [line 69]
        │        filter chain has branches for Pending/Ordered/Waiting/
        │        Arrived/Not Arrived/Cancelled/Inquiries — but NO branch
        │        for 'All', so matchesStatus stays true                  [lines 1100-1107]
        │        ⇒ Inquiry rows render in the DEFAULT view
        │
        └──► Quick Assist  (frontend/src/components/QuickAssistSidebar.tsx)
                 activeSpecialOrders excludes only Completed/Fulfilled/
                 Cancelled                                                   [lines 1091-1095]
                 ⇒ Inquiry rows are "active"
                 grouped into groupedWebsiteOrders / groupedSpecialOrders    [1105-1242]
                 overallStatus = 'Inquiry'                                   [1161, 1229]
                 counted in collapsed badges                                 [1327-1372]
                 rendered inside the sections:
                   • "Online Orders (website + WhatsApp)"                    [1875-1880]
                   • "Special Requests"                                      [2255-2260]
```

### 1.3 Root cause

**Nothing is created "by mistake".** The row is intentional (`Inquiry` status + Approve/POS/Dismiss buttons were added by bug fix **P2-94** as a human-in-the-loop queue). The defect is **visibility**: an `Inquiry` row is not an approved order, yet both lists treat it as active work.

Two concrete leaks:

1. `SpecialOrdersSection.tsx:69` defaults `statusFilter` to `'All'`, and `filteredOrders` at `:1100-1107` has no `'All'` branch → `matchesStatus` remains `true` → inquiries mix into the default list.
2. `QuickAssistSidebar.tsx:1091-1095` filters out only `Completed/Fulfilled/Cancelled` → `Inquiry` rows stay in the active lists, badges, and section counts.

### 1.4 Target workflow

- `Inquiry` rows are **never** mixed into the active order lists.
- They live in **one dedicated "Inquiries (Needs Approval)" surface** per page, with a **count badge**, so nothing is invisible.
- The only actions remain the existing ones: **Approve & Order** (→ `Pending`, enters the active list), **POS** (bill directly), **Dismiss** (cancel without ordering).
- No new state, no new table, no change to the creation path.

### 1.5 Implementation tasks — Issue A

**A1. CRM → Special Orders — `frontend/src/pages/CRM/SpecialOrdersSection.tsx`**

| Step | Change |
|------|--------|
| A1.1 | In `filteredOrders` (~`:1100`), add an explicit first branch: `if (statusFilter === 'All') matchesStatus = o.status !== 'Inquiry';` (keep `'Inquiries'` branch as the only viewer of them). |
| A1.2 | Tab strip (~`:1600`): render the `Inquiries` tab label as `Inquiries (N)` with `N = orders.filter(o => o.status === 'Inquiry').length`; amber highlight when `N > 0`. Counts must come from the already-fetched `orders` array (no new request). |
| A1.3 | When `N > 0` and `statusFilter === 'All'`, show a thin informational strip above the list: `N customer inquiry(ies) need approval → Review`, which switches the filter to `Inquiries`. Do not auto-switch tabs. |
| A1.4 | Verify the customer grouping (`customerGroups` ~`:1127`) no longer counts inquiries in `activeCount`/active buckets once filtered out. |
| A1.5 | Keep the existing inline `[Approve]` button (`:1269`), the `Inquiry` badge (`:1189`, `:1232-1244`), and the edit-modal `Inquiry` option (`:2376`) unchanged. |

**A2. Quick Assist — `frontend/src/components/QuickAssistSidebar.tsx`**

| Step | Change |
|------|--------|
| A2.1 | `activeSpecialOrders` (`:1091-1095`): also exclude `s.status === 'Inquiry'`. The two active sections and their badges keep meaning "approved work only". |
| A2.2 | Add `inquiryOrders` memo = `specialOrders.filter(s => s.status === 'Inquiry' && !optimisticHiddenOrderIds.has(s.id))`. |
| A2.3 | Add `groupedInquiries` memo using the **same** group-by-phone/requester shape as `groupedSpecialOrders` (`:1174-1242`) — reuse the existing code shape, do not invent a second grouping rule. |
| A2.4 | Render **one new section** `Inquiries (Needs Approval) · N` **after** the `Special Requests` section (`:2255`), reusing the existing amber inquiry card markup (`:1904`, `:2284`, `:2323-2335`, `:2390`, `:2566`) and the existing handlers (`Approve & Order` / `POS` / `Dismiss`). Default collapsed when the active lists have rows; auto-expanded when there is no other active work. |
| A2.5 | Collapsed-view badges (`:1326-1372`): add a **separate** `Inquiries: N` badge (violet) and keep `Online Orders` / `Special Requests` counts free of inquiries. |
| A2.6 | Section headers `Online Orders (N)` (`:1880`) and `Special Requests (N)` (`:2260`) now count only non-inquiry groups — verify no double counting. |

**A3. Backend — `src/routes/orders.ts`**

| Step | Change |
|------|--------|
| A3.1 | **No change.** `GET /api/orders` (`:55-81`) keeps returning every row. Both pages already hold the rows (Layout's chrome query key `orders`), so filtering client-side avoids a second query shape and a second cache. |
| A3.2 | If, during implementation, a second consumer is found that must exclude inquiries, prefer a shared client-side helper over a new query param. |

**A4. Other consumers to verify (read the sources, apply the same exclusion only if needed)**

- `frontend/src/components/LiveCartAddModal.tsx:717` — `api.getOrders()`; must not treat an unapproved inquiry as an order to place.
- `frontend/src/components/DelayNoticeModal.tsx` (`special_order` candidates) and `frontend/src/components/IncompleteOrders24hCard.tsx` (`sourceType: 'special_order'`) — confirm their data sources exclude or clearly label `Inquiry`.

---

## 2. Issue B — a cycle completed early stays at the top of the refill list

### 2.1 What the user sees

The refill queue is meant to answer "**who is next?**". When a patient collects 2–3 days early and the pharmacist completes/fulfills the cycle (from Quick Assist **or** CRM), that patient **remains at the top** of the list. The next patient never rises, so the queue no longer reflects real work.

### 2.2 Present workflow (actual, verified)

```
Refill list source
  frontend/src/components/Layout.tsx
     api.getRefillsPanel({ upcoming_days: 7 })                              [line 3162]
     refresh on window events 'refresh-refills' / 'app-refills-updated'     [3186-3191]

Quick Assist — frontend/src/components/QuickAssistSidebar.tsx
  flatRefills          hydrate each medicine (incl. last_refill_date)        [860-881]
  actionableRefills    exclude: not active / no due date / completed /
                       fulfilled / canceled / isRefillFulfilledToday         [884-905]
                       keep:    diffDays <= 7                               [902-903]
  groupedActionableRefills
     sort by RAW DUE DATE ONLY:  list.sort((a,b) => a.diffDays - b.diffDays) [1072]
     explicit comment: keep settled (ordered + reminded) patients VISIBLE     [1073-1075]
     filter only optimisticHiddenRefillKeys + key checks                      [1076-1084]

Completion writes
  src/routes/refills.ts
    POST /:id/fulfill            → executeCloseRefillCycles                 [1718-1765]
    POST /patient/:phone/fulfill-all → executeCloseRefillCycles             [1768-1841]
    handleRefillStatusUpdate (completed/fulfilled) → executeCloseRefillCycles [1882-1981]
      executeCloseRefillCycles (L1576-1715):
        last_refill_date = toLocalSqlDateTime()   (shop-local TODAY)         [1631]
        next_refill_date = advanced by interval                              [1632]
        companion special_orders closed, reminders purged, cart_* cleared
      → broadcast refill_updated (+ app-refills-updated, order_updated)      [1828-1830]

Mark Ready (Stage C) — writes is_ready = 1 ONLY, never last_refill_date
    (src/routes/refills.ts mark-ready handlers)

CRM — frontend/src/pages/CRM/RefillsSection.tsx
    isPatientRefillsSettled / isRefillFulfilledToday hide settled rows
    ONLY on the 'overdue' and 'lead' action tabs                         [1208-1213]
    Master tabs (All / Active / …) keep full patient lists, ordered by
    due date ⇒ a just-completed patient keeps its old due-date position
```

### 2.3 Root cause

`isRefillFulfilledToday` (`frontend/src/utils/refillSettled.ts:12-18`) is **same-calendar-day only**, and it is used for **filtering**, never for **ordering**:

- `QuickAssistSidebar.tsx:1072` sorts by `a.diffDays - b.diffDays` — **due date is the only sort key**. "Already handled" carries no weight, so a patient whose cycle was closed today still ranks by their old due date, i.e. at/near the top.
- `actionableRefills:895` **removes** a completed-today row from the list entirely (it cannot "move to the bottom" because it is gone), except when the primary action was **Mark Ready** — which never writes `last_refill_date` and therefore leaves the card `reminded` (Stage C) forever, still sorted by due date.
- CRM's master refill lists have the same due-date-only ordering, so a fulfilled-today patient keeps its old position there too.

Secondary findings (must be handled, not re-introduced):

1. The `medicines` objects pushed into `groupedActionableRefills` (`:1006-1043`) **omit `last_refill_date`**, so `checkPatientRefillCycleBooking(group.medicines)` at `:481` can never return `alreadyDispensed` — the "one per cycle" guard there is inert in Quick Assist.
2. The early-booking modal promises "advance the schedule upon billing" while the handler closes the cycle immediately via `fulfillAllRefills`.
3. `executeCloseRefillCycles` records `cycle_due_date` from the **10-char** `next_refill_date` slice, but a legacy row in `refill_fulfillments` stores a 19-char datetime, and the table has **no** `UNIQUE(refill_id, cycle_due_date)` — idempotency is application-level only.

### 2.4 Target workflow (owner decision: "drop to the bottom, still visible")

- The refill list is ordered by **work remaining first**:
  1. **Pending** patients — sorted by due date **ascending** (most overdue / nearest due on top) → the top row is always the *next* patient to act on.
  2. **Handled today** patients — pinned at the **bottom**, in a distinct group titled **"Completed today — awaiting POS"**, still visible and still clickable through to POS.
- "Handled today" = the cycle was closed today (`last_refill_date` = shop-local today) **or** status `completed`/`fulfilled`.
- **Mark Ready (Stage C)** patients also sink below pending patients (they are waiting on collection, not on the pharmacist) while remaining visible.
- Works identically whether the pharmacist completes from **Quick Assist** or **CRM**, and updates live across both via the existing `refill_updated` SSE + chrome `refills` key — **no new polling or timers**.
- Backend writes are already correct; **no backend change is required**.

### 2.5 Implementation tasks — Issue B

**B1. Shared logic — `frontend/src/utils/refillSettled.ts` (single source of truth)**

This file is already the contract's **only** definition of a finished refill — extend it there, never inline in a component.

| Step | Change |
|------|--------|
| B1.1 | Add `isRefillHandledToday(m)` = `isRefillFulfilledToday(m) \|\| m.status === 'completed' \|\| m.status === 'fulfilled'`. |
| B1.2 | Add a shared comparator/helper, e.g. `compareRefillGroups(a, b)` / `sortRefillGroups(list)`: **primary = `handled` last** (`Number(a.handled) - Number(b.handled)`), **secondary = `a.diffDays - b.diffDays`**. |
| B1.3 | Keep `isRefillSettled` / `isPatientRefillsSettled` semantics intact (CRM's action tabs depend on them). |

**B2. Quick Assist — `frontend/src/components/QuickAssistSidebar.tsx`**

| Step | Change |
|------|--------|
| B2.1 | Include `last_refill_date` in the medicine objects pushed in `groupedActionableRefills` (`:1006-1043`) so `checkPatientRefillCycleBooking` (`:481`) works again. |
| B2.2 | Stop **filtering out** completed-today rows in `actionableRefills` (`:895`) — instead mark the group `handled = true`. This is what makes "drop to the bottom, still visible" possible. |
| B2.3 | Replace `list.sort((a, b) => a.diffDays - b.diffDays)` (`:1072`) with the shared `sortRefillGroups(...)`. |
| B2.4 | Render a bottom group header **"Completed today — awaiting POS"** when at least one handled group is present; keep the existing Refill cards/buttons inside it (POS hand-off unchanged). |
| B2.5 | Update the stale comment at `:1073-1075` to describe the new rule ("settled patients stay visible, but sorted last"). |
| B2.6 | Confirm `optimisticHiddenRefillKeys` (`:1076-1084`) stays consistent with the new grouping (a completed card should be *moved*, not hidden, unless the user explicitly dismissed it). |

**B3. CRM → Refills — `frontend/src/pages/CRM/RefillsSection.tsx`**

| Step | Change |
|------|--------|
| B3.1 | Apply the same `sortRefillGroups(...)` to the master refill list so a completed/fullfilled patient moves to the bottom row instead of keeping its old due-date position. |
| B3.2 | On the `overdue` / `lead` action tabs (`:1208-1213`), keep hiding **previously** settled patients, but a cycle closed **today** must appear in the same bottom "Completed today — awaiting POS" group (owner requirement: still visible). |
| B3.3 | Verify the fulfill actions (`handleRefillStatusUpdate` consumers) still refresh the list via the existing events — no new fetch path. |

**B4. Documentation**

| Step | Change |
|------|--------|
| B4.1 | `frontend/AGENTS.md` → "Quick Assist 7-Day Refill Workflow" / "Refill 'Settled' Rule": replace the "KEEPS Stage-C patients visible until POS fulfillment" wording with the new **sorted-last, bottom-group** rule. |
| B4.2 | If a contract line in the root `AGENTS.md` (SPA / Data Fetch Control sections) implies due-date-only ordering, correct it there too. |

---

## 3. Constraints — what must NOT be touched

1. **Refill creation** — `src/services/refillService.ts` (paused-refill and out-of-stock auto-orders) and `src/services/refillOrderReconciler.ts` are **out of scope**. The owner reported inquiries only; the refill auto-creation paths stay as designed.
2. **`Inquiry` semantics** — status name, notes text, `source`/`customer_order_source` values, and the Approve/POS/Dismiss handlers stay unchanged.
3. **WhatsApp patient-confirm path** (`whatsappIntentService` `proceedWithConfirmedProcurement` / `executeConfirmedProcurementFlow`) — untouched.
4. **Single writer per fact** (`AGENT_DATA_FLOW_TREE.md`): CRM and Quick Assist remain read-only views over the same `special_orders` / `patient_refills` rows. No parallel list, table, or cache may be introduced.
5. **Manual-only patient messaging**: this work sends **no** messages — it is ordering and visibility only.
6. **No-GPU / performance contracts**: no `backdrop-filter`, no endless animations, no new `setInterval`/polling; use the existing SSE (`refill_updated`, `order_updated`) and mark-stale query invalidation.
7. **UI tokens**: semantic Tailwind only (`bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`, `bg-glass-bg`); `text-white` only on saturated accent fills. Use `dropdown-scroll` for any new scroll list.
8. **No dummy data**: counts and badges are derived from the real fetched arrays only; never invent a fallback value.

---

## 4. Verification plan

**Static**
1. `npx tsc --noEmit` — clean.
2. `npm run guardrails` — exit 0 (blocks eager refetch, ungated timers, raw colors, dummy tokens, etc.).
3. `node scripts/quick-update.mjs` — knowledge graph + `PROJECT_AUDIT.md` synchronized (see §5).

**Manual — Issue A**
4. Send a WhatsApp message requesting a medicine that is registered but has zero shelf stock.
5. CRM → Special Orders: the row appears **only** under the `Inquiries` tab (with the tab count). The `All` view and the active counts are unchanged.
6. Quick Assist: the row appears **only** in `Inquiries (Needs Approval)` with its own badge; `Online Orders` and `Special Requests` counts exclude it.
7. Click **Approve & Order** → the row becomes `Pending` and appears in the normal active list. Click **Dismiss** → it leaves the inquiry surface.
8. Regression: an order created by hand (CRM "+ New" / Quick Assist "Make Order") still lands in the active list immediately.

**Manual — Issue B**
9. Take a patient whose refill is due in 2–3 days; complete the cycle early from **Quick Assist** and, separately, from **CRM**.
10. The patient **drops to the bottom** in a `Completed today — awaiting POS` group in **both** pages; the next due patient is the top row.
11. Restart the app → the completed patient is still in the bottom group/correctly ordered (durability comes from `last_refill_date` = local today).
12. Regression: `Mark Ready` still sends the collection reminder and moves the card below pending patients; `Add to Cart` / `Already Added` stages behave as before.
13. Midnight check: after the local day rolls over, a cycle completed yesterday is no longer "completed today" — confirm the fallback ordering (advanced `next_refill_date`) is sensible and does not resurrect the card at the top.

---

## 5. Close-out checklist (required by repo contracts)

1. Add a new entry to **`SMALL_BUG_FIX_PLAN.md`** describing both fixes (Issues A and B) — cause, fix, priority (P2), verification.
2. Run **`node scripts/quick-update.mjs`** (mandatory after any file change).
3. Run **`npm run guardrails`** and keep exit 0 (a git `pre-push` hook enforces it).
4. Update **DOX**: `frontend/AGENTS.md` (Quick Assist refill ordering + the new Inquiries section) and, if any parent-level rule changes, the root `AGENTS.md`.
5. No backend schema change ⇒ no `BACKEND SCHEMA SAFETY.md` audit and no migration is required. If, during implementation, a backend edit becomes necessary, that document's Section 24 report becomes mandatory.

---

## 6. Assumptions & open items

1. **Assumption:** the "list" the owner watches is the Quick Assist refill list and the CRM refills master list; both are covered above.
2. **Assumption:** `Inquiry` rows are wanted as a permanent WhatsApp record, so they are re-surfaced (not deleted) in a dedicated inbox.
3. **Not included (log separately if reported):** the refill auto-creation paths (paused refill / out-of-stock due refill) that also produce rows without a click — these were explicitly excluded by the owner for this change.
4. **Not included:** the legacy 19-char `cycle_due_date` row and the missing `UNIQUE(refill_id, cycle_due_date)` index — observations only; fixing them requires a separate, owner-approved schema task.
