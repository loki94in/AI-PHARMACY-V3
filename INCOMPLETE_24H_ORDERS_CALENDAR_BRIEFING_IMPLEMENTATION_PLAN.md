# 24h Incomplete Order Calendar-Aware SLA Briefing & HITL Work-Card Implementation Plan

## Overview
This implementation plan establishes an end-to-end operational engine for tracking and resolving orders (Special Orders, WhatsApp Orders, Website Orders, and CRM Refills) that exceed 24 hours without fulfillment. It distinguishes between **true store SLA breaches** (where the market and store were open) and **legitimate market-closure / paused-dispatch holds** (where fulfillment was paused due to weekly offs, holidays, distributor pause dates, or market closures). It aggregates all incomplete items into a single consolidated morning WhatsApp briefing for the store owner and a unified Human-in-the-Loop (HITL) work-card on the CRM/Dashboard.

---

## Tasks Checklist

### Phase 1: Calendar-Aware 24-Hour SLA Evaluator Service
- [x] **Task 1.1**: Implement `evaluateIncompleteOrders24hSLA` in `src/services/orderScheduleService.ts`
  - Query unfulfilled `special_orders` (`status IN ('Pending', 'Confirmed', 'Waiting')`) and active `patient_refills` (`status IN ('pending', 'notified', 'staged') AND DATE(next_refill_date) <= DATE('now', 'localtime')`).
  - Calculate elapsed hours from creation/due date.
  - Check calendar state (`pharmacy_closed_dates`, `pharmarack_paused_dispatch_dates`, `pharmacy_market_closure_config`, `weekly_off`) using `isClosedDay` and `getNextAvailableWorkingDate`.
  - Classify each order into:
    - `overdue`: Active SLA breach (>24h during open working hours).
    - `market_paused`: Legitimate hold during closed/paused dates with calculated `resumedDate` and `resumedTimeWindow`.
  - Group and deduplicate by customer phone / name.

### Phase 2: Consolidated Store Owner Morning Briefing
- [x] **Task 2.1**: Update `buildDailyOperationalBriefing` in `src/services/refillService.ts`
  - Call `evaluateIncompleteOrders24hSLA(db)`.
  - Add a dedicated, consolidated section across all 4 briefing templates:
    - 🚨 **OVERDUE (>24h SLA Breach — Action Required)**
    - ⏸️ **MARKET / DISPATCH PAUSED (Held with Resumed Delivery Date)**
  - Ensure zero message spam: one single combined briefing instead of multiple fragmented notifications.

### Phase 3: Backend API Endpoints for Incomplete 24h Orders & HITL Actions
- [x] **Task 3.1**: Create Incomplete Audit & Action Endpoints in `src/routes/orders.ts`
  - `GET /api/orders/incomplete-24h-audit`: Returns classified overdue and market-paused items with customer groupings.
  - `POST /api/orders/incomplete-24h-action`: Supports:
    - `push_to_cart`: Pushes overdue items to Pharmarack / special orders cart queue.
    - `send_delay_notices`: Enqueues approved WhatsApp delay notices to affected patients via `whatsappQueueWorker`.
    - `snooze_sla`: Snoozes the 24h alert with an audit log note.

### Phase 4: Frontend Human-In-The-Loop CRM Work-Card & Modal
- [x] **Task 4.1**: Create `frontend/src/components/IncompleteOrders24hCard.tsx`
  - Compact glassmorphism card styled with semantic Tailwind variables (`bg-bg`, `text-text`, `border-border`).
  - Summary chip with counts: `⚠️ 24h Fulfillment Watch: X Overdue • Y Market-Paused`.
  - Expandable customer accordion showing item names, quantities, and elapsed time.
  - Action buttons: "Push to Cart", "Send Delay Notices", "Snooze 24h".
- [x] **Task 4.2**: Integrate `IncompleteOrders24hCard` into CRM Call Board (`frontend/src/pages/CRM/index.tsx`)
  - Mount seamlessly above call task queues without layout shifts or extra mount queries.

### Phase 5: Verification & Guardrails
- [x] **Task 5.1**: Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
- [x] **Task 5.2**: Run `node scripts/quick-update.mjs` to auto-update knowledge graph.

---

## Completion Log
- **2026-09-30**:
  - Implemented `evaluateIncompleteOrders24hSLA` in `src/services/orderScheduleService.ts` with calendar check (`isClosedDay`, `advanceToNextOpenDay`, `pharmarack_paused_dispatch_dates`, `pharmacy_market_closure_config`).
  - Integrated 24-hour fulfillment watch block into `buildDailyOperationalBriefing` in `src/services/refillService.ts` across `detailed`, `compact`, `checklist`, and `executive` templates.
  - Added endpoints `GET /api/orders/incomplete-24h-audit` and `POST /api/orders/incomplete-24h-action` in `src/routes/orders.ts`.
  - Created frontend component `frontend/src/components/IncompleteOrders24hCard.tsx` with customer accordion, filter tabs, bulk cart push, delay notice approval modal, and snooze action.
  - Mounted `IncompleteOrders24hCard` in `frontend/src/pages/CRM/index.tsx`.
  - Added API client helpers `getIncomplete24hAudit` and `executeIncomplete24hAction` in `frontend/src/services/api.ts`.
  - Verified performance guardrails (`npm run guardrails` passed exit code 0).
  - Verified frontend TypeScript compilation (`cd frontend; npx tsc --noEmit` passed exit code 0).
  - Updated auto-knowledge graph (`node scripts/quick-update.mjs` finished in 2.8s).
