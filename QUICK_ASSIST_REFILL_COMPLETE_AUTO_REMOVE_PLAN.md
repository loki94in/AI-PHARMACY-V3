# Quick Assist Refill Complete & POS Auto-Removal Implementation Plan

> **Scope**: Quick Assist Complete action, Refill cycle advancement, linked Special Orders settlement, POS prefill banner suppression.  
> **Contract**: Root `AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`, `AGENT_BUG_FIX_RULEBOOK.md`.

---

## 1. Problem Statement & Root Cause

When a user clicks the **Complete** button on a refill card in Quick Assist:
1. **POS Duplicate Refill Banner**: POS opens with the medicine prefilled, but immediately runs `GET /sales/patient-refill-medicines`. Because that endpoint checked `pr.is_active = 1` without filtering by due date or recent fulfillment, POS popped up a duplicate violet banner: `"{patient} has scheduled refill: ... [+ Add to Bill] [Ignore]"`.
2. **Linked Special Orders Left Open in Quick Assist**: Out-of-stock refills automatically create linked rows in `special_orders` (`source = 'refill'`). When `POST /refills/patient/:phone/fulfill-all` was executed, it advanced `patient_refills` but left `special_orders` untouched in `Pending`/`Ordered`/`Ready`. Quick Assist continued displaying the companion task under "Special Requests".
3. **Optimistic Sidebar State Scope**: `QuickAssistSidebar.tsx` only hid the refill key from `optimisticHiddenRefillKeys`, leaving companion special orders and staged notifications visible until a manual refresh, and did not broadcast `app-special-orders-updated`.

---

## 2. Implementation Steps

### Phase 1: Backend Fixes
- **Step 1: Suppress Already-Fulfilled Refills in `src/routes/sales.ts` (`GET /patient-refill-medicines`)**
  - Add filtering to `scheduledRefills`: only include refills where `next_refill_date` is within today + upcoming 7 days (`diffDays <= 7`), and exclude any refill whose `last_refill_date` was updated today / within 24h.
  - Return `has_scheduled_refill: false` when no overdue/due-now refills exist.

- **Step 2: Atomically Settle Linked Special Orders in `src/routes/refills.ts` (`POST /patient/:phone/fulfill-all`)**
  - Within the same SQLite transaction in `fulfill-all`:
    - Find any active `special_orders` rows where `(phone = ? OR phone LIKE ?) AND (source = 'refill' OR source_refill_id IN (...) OR product IN (medicine_names)) AND status IN ('Pending', 'Ordered', 'Confirmed', 'Ready')`.
    - Update them to `status = 'Completed'`, `pos_sale_invoice_id = NULL`, and stop reminders.
    - Also purge pending reminders and staged notifications for both refill IDs and linked special order IDs.
  - Broadcast `special_orders_updated` and `app-special-orders-updated` so frontend Quick Assist and CRM special orders refresh immediately.

### Phase 2: Frontend Fixes
- **Step 3: Suppress Refill Prompt Banner in `frontend/src/pages/POS/index.tsx`**
  - In POS prefill hydration: When `prefill.refillPatient === true` or `prefill.refillIds` are provided, initialize `dismissedRefillId` and suppress `matchedRefill` for those items so the banner is never shown for medicines already in the prefilled cart.
  - In `handleAcceptRefill` / `delayCheck`: If cart already contains medicines matching `matchedRefill`, auto-suppress the banner.

- **Step 4: Comprehensive Quick Assist State Removal in `frontend/src/components/QuickAssistSidebar.tsx`**
  - In `handleCompleteRefillGroup`:
    - Optimistically hide by `group.key`, `group.patient_phone`, and clean 10-digit phone.
    - Check `activeSpecialOrders` for matching phone/patient and optimistically add their IDs to `optimisticHiddenOrderIds`.
    - Trigger `specialOrdersEvent.triggerUpdated()` and `automationHubEvent.triggerUpdated()` alongside `refillEvent.triggerRefresh()`.

### Phase 3: Verification & Guardrails
- **Step 5: Run Automated Guardrails & Knowledge Graph**
  - Run `npm run guardrails` and verify exit code 0.
  - Run `tsc --noEmit` and `npx tsc -b frontend` to verify TypeScript clean compile.
  - Run `node scripts/quick-update.mjs`.
