# Implementation Plan — Early Refill Add from CRM: Visibility in Quick Assist

**Date:** 2026-10-17
**Status:** Plan only (no code changed yet)
**Scope:** Refill added to live cart from CRM **before** its due date → how the app behaves today, and how it should behave.

---

## 1. The Issue

A pharmacist can add a refill medicine to the Pharmarack live cart from CRM **anytime — even many days before the refill due date**. The add itself works (medicine lands in the live cart, `patient_refills.cart_*` is written, CRM shows the "In Live Cart" chip).

**The problem:** once added early (more than 7 days before the due date), the refill **disappears from the Quick Assist panel**. Quick Assist is the staff's daily work queue, so an item the pharmacist explicitly ordered today becomes invisible until the due date enters the 7-day window. The pharmacist cannot see, track, or advance that order (Mark Ready / Complete) during the whole early period — it looks like the work vanished.

Secondary gaps in the same workflow:

- **No popup feedback was originally expected on the silent path** — the `Confirm & Cart` / `confirm-patient` server-side path adds medicines with only a toast (owner has since confirmed this *silent background add is acceptable*; documented here for completeness).
- **Reminder spam** (already fixed by commit `8c9a549e`) — early booking used to leave the old future `next_refill_date` in place, so next-month "Refill Due" reminders were re-sent after the patient had already bought. Now the cycle advances from the real sale date and pending reminders are purged.

---

## 2. Present Workflow (as-is, traced in code)

### 2.1 Add from CRM (works, no date gate)
1. CRM → `/crm?tab=refills` → toolbar **Add to Cart** (`RefillOrderModal`) or per-medicine **+ Live Cart** → `startRefillCartJob()` (`frontend/src/services/refillCartJobs.ts`).
2. Background runner calls `POST /api/refills/:id/add-to-cart` → `processRefillCartItem` (`src/services/refillCartService.ts`) → verified add to Pharmarack live cart → writes `patient_refills.cart_store_name / cart_qty / cart_product_code`.
3. CRM shows the **"In Live Cart: store ×qty"** chip + date chip (`Due in 12d`). ✔

### 2.2 Quick Assist visibility (the gap)
4. Layout fetches the panel with a **hard-coded 7-day window**:
   `api.getRefillsPanel({ upcoming_days: 7 })` — `frontend/src/components/Layout.tsx:3162`.
5. Backend filters `WHERE pr.next_refill_date <= date('now', '+7 days')` — `src/routes/refills.ts:711`.
6. Frontend filters again: `actionableRefills` keeps only `diffDays <= 7` — `frontend/src/components/QuickAssistSidebar.tsx:903`.
7. **Result:** an early-added refill with `next_refill_date` more than 7 days out is excluded by BOTH filters → not rendered in Quick Assist at all, even though it is actively ordered and in the live cart.

### 2.3 Reminder protection (already correct)
8. Reminder cron skips refills that are `ordered` / confirmed / `cart_store_name IS NOT NULL` — `src/services/refillService.ts:253-255` and the pre-dispatch anti-spam gate at `1227-1248`. No premature "Refill Due" WhatsApp. ✔

### 2.4 Eventual sale (already correct since commit `8c9a549e`)
9. POS/Sell runs `checkRefillCycleBooking` (`frontend/src/utils/refillSettled.ts`): blocks double-billing within the current cycle, shows the **Early Refill confirmation** ("due in X days").
10. POS renders the purple **REFILL / EARLY REFILL BOOKING** banner (patient, due date, days early, "Advance Next Cycle" toggle).
11. On invoice save (`src/routes/sales.ts`): `last_refill_date = sale_date`, `next_refill_date = sale_date + refill_interval_days` (shop-local), `fulfilled_via = 'pos_sale_early'`, pending reminder jobs purged. ✔

### 2.5 Stage logic once visible
12. `getRefillStage()` (`frontend/src/utils/refillSettled.ts`) — single source of truth: `upcoming` → `ordered` → `reminded`. An early-added row is already `ordered` (`cart_store_name` set), so when it becomes visible it correctly shows **Stage B: `[Confirm?] [Mark Ready] [Complete]`** — no re-add prompt. ✔

---

## 3. Desired Behavior (to-be)

**Rule:** *An explicitly ordered refill is actionable from the moment it is ordered, not only when its due date is near.*

1. **Quick Assist shows any refill that has been ordered early**, regardless of how far away `next_refill_date` is:
   - A row qualifies for `actionableRefills` when **either**
     - `diffDays <= 7` (existing due-window rule), **OR**
     - the row is already ordered/started early: `status === 'ordered'` **or** `cart_store_name IS NOT NULL` (same "ordered" definition already used by `refillSettled.ts` / `getRefillStage` — no new definition invented).
2. **Visual distinction:** an ordered row whose due date is >7 days out renders with an **"Early · due in Nd"** chip so staff know it is early, not overdue.
3. **Stage stays truthful:** it enters at Stage B (`ordered`) via the existing `getRefillStage()` — buttons `[Confirm?] [Mark Ready] [Complete]` — nothing new.
4. **Backend window widened only for ordered rows:** `/refills/panel?upcoming_days=7` keeps the cheap due-window query, but additionally includes rows with `cart_store_name IS NOT NULL OR status = 'ordered'` (still sargable, small table — no whole-table scan risk; `patient_refills` is a small table per the hot-path contract).
5. **Everything else unchanged:**
   - Reminder cron anti-spam gates stay exactly as they are.
   - One-per-cycle guard + Early Refill confirmation + POS REFILL banner + cycle-advance-on-sale stay as shipped in `8c9a549e`.
   - Silent server-side `Confirm & Cart` add stays (owner-confirmed acceptable); popup runner (`startRefillCartJob`) remains the visible path from the toolbar / per-medicine buttons.
   - No second patient list or parallel cache — Quick Assist keeps reading the same `patient_refills` rows through `GET /refills/panel` (Data-Flow-Tree contract).

---

## 4. Implementation Steps (when approved)

| # | File | Change |
|---|------|--------|
| 1 | `src/routes/refills.ts` (`GET /panel`, ~line 710) | Extend the `upcoming_days` WHERE clause with `OR pr.cart_store_name IS NOT NULL OR pr.status = 'ordered'` so early-ordered rows ship to Quick Assist. Keep the store scoping and the two-pass stock lookup untouched. |
| 2 | `frontend/src/components/QuickAssistSidebar.tsx` (`actionableRefills`, ~line 888) | Pass a row when `diffDays <= 7` **or** it is ordered early (`status === 'ordered' || cart_store_name`); keep every existing exclusion (`is_active`, completed/fulfilled/canceled, `isRefillFulfilledToday`). |
| 3 | `frontend/src/components/QuickAssistSidebar.tsx` (group card header) | Add the **"Early · due in Nd"** chip when `diffDays > 7` on an ordered row (semantic colors only, `dropdown-scroll`/finite-animation rules apply). |
| 4 | `frontend/src/pages/CRM/RefillsSection.tsx` | No behavior change expected — verify the Overdue/Lead tab filters still behave (they apply `isPatientRefillsSettled` only on those tabs). |

## 5. Verification

1. `npx tsc --noEmit` (backend) and `npx tsc -p frontend/tsconfig.app.json --noEmit` — both exit 0.
2. `npm run guardrails` — exit 0, 0 violations.
3. Behavioral:
   - Add a refill to live cart from CRM whose `next_refill_date` is >7 days out → it appears in Quick Assist immediately at Stage B with the "Early" chip.
   - An unordered refill due in >7 days → still hidden from Quick Assist (window unchanged for it).
   - An unordered refill due ≤7 days → unchanged (Stage A).
   - Reminder cron still skips ordered rows (no duplicate reminder after the change).
   - Early sale → confirmation → POS banner → invoice save advances cycle + purges reminders (regression check on `8c9a549e`).
4. Update `SMALL_BUG_FIX_PLAN.md` (new entry → Fixed) and run `node scripts/quick-update.mjs`.

---

## 6. Audit Summary (pre-task)

1. **Existing dummy/fallback logic found:** none related to this flow; all values come from `patient_refills` real columns.
2. **Removed/changed:** nothing yet (plan only).
3. **New dummy/fallback logic:** none planned — the "early" chip reads real `next_refill_date`.
4. **Missing-data handling:** a row without `next_refill_date` keeps failing the existing filter (stays hidden).
5. **Error/fallback behavior:** endpoint failure → panel query fails as today (no invented data).
6. **Auto-created records:** none.
7. **Data source:** `patient_refills` via `GET /refills/panel` only (single writer remains CRM).
8. **Remaining risk to review:** the widened WHERE must stay sargable — verify with `EXPLAIN QUERY PLAN` that the `ordered`/`cart_store_name` OR does not defeat the date index on a large DB (table is small; two plain indexed/pk lookups expected).
