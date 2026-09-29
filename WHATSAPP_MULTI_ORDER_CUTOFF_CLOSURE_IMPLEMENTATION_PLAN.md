# WhatsApp Multi-Medicine Ordering, Delivery Schedules & Market Closure Notice Implementation Plan

## Overview
This implementation plan covers the complete end-to-end enhancement for:
1. **WhatsApp Multi-Medicine Ordering**: Allowing customers to seamlessly add 1, 2, or more medicines to an existing order across multiple timeframes (1 min, 2-3 mins, 10 mins) without overwriting or hijacking quantities.
2. **Configurable Delivery Schedules & Cutoff Management**: Allowing multiple delivery schedules in Settings with automatic next-day rollover if orders are placed after the cutoff (e.g. 11:00 PM).
3. **Pharmarack Cart Pause & Market Closure Review Modal**: An interactive Human-in-the-Loop (HITL) modal on the Pharmarack Cart page that aggregates affected customers across Refills, CRM, Special Orders, and Online Orders in a compact checkbox-with-accordion list, pre-fills the next working delivery date, and lets the pharmacist review and modify WhatsApp notices before sending.

---

## Tasks Checklist

### Phase 1: Database & Backend Services
- [x] **Task 1.1**: Settings & Schema Support for Delivery Schedules
  - Ensure `pharmacy_delivery_schedules` setting can be stored in `app_settings`.
  - Add helper functions in `src/services/storeSettingsService.ts` to get/save delivery schedules (`DeliveryScheduleSlot`).
- [x] **Task 1.2**: Next Unpaused Working Date Calculator
  - In `src/services/orderScheduleService.ts`, implement `getNextAvailableWorkingDate(startDate)` which scans forward skipping `pharmarack_paused_dispatch_dates`, `pharmacy_closed_dates`, and `weekly_off`.
- [x] **Task 1.3**: Unified Affected Closure Patients Endpoint
  - In `src/routes/pharmarack.ts`, implement `GET /api/pharmarack/affected-closure-patients`:
    - Queries `patient_refills` due in the closure range.
    - Queries `special_orders` pending/confirmed in the closure range.
    - Queries `online_orders` / `online_order_items` active in the closure range.
    - Queries `patient_call_tasks` active in CRM.
    - Returns deduplicated list with patient name, phone, source badge, item count, and full medicine list.
- [x] **Task 1.4**: Batch Closure Notice Dispatch Endpoint (Strict Human-in-the-Loop)
  - In `src/routes/pharmarack.ts`, implement `POST /api/pharmarack/send-closure-notices`:
    - Accepts `{ selectedPatients, messageTemplate, nextWorkingDate, nextDeliveryTime, reason }`.
    - Queues messages via `whatsappQueueWorker.enqueue()` with Anti-Ban pacing.

### Phase 2: WhatsApp Inbound Multi-Order & Cutoff Integration
- [x] **Task 2.1**: Entity Guard in Quantity Parsing
  - In `src/services/whatsappIntentService.ts`, update `awaiting_qty` step so numbers in medicine names (e.g., "Pan 40", "Augmentin 625") are not parsed as quantities.
- [x] **Task 2.2**: Conversational Order Combine Flow
  - In `src/services/whatsappIntentService.ts`, when an incoming medicine is detected from a customer who has an open/recent order (within 30 mins):
    - Transition to `awaiting_merge_choice` or handle running basket.
    - If previous order is already placed with distributor (`status = 'Ordered'`), automatically create a linked add-on (`SO-XXXXX-B`).
- [x] **Task 2.3**: Cutoff & Off-Hours Delivery Notice in WhatsApp Confirmations
  - In `src/services/whatsappIntentService.ts`, compute the expected delivery window from the configured schedules and next-open-date calculator, injecting it into all confirmation cards via `getDynamicDeliveryNotice(db)`.

### Phase 3: Frontend Settings & Pharmarack Cart Calendar Modal
- [x] **Task 3.1**: Settings UI for Multiple Delivery Schedules
  - In `frontend/src/pages/Settings/index.tsx`, add an editable list for delivery schedules (name, cutoff time & delivery window) under Trigger 11 with add/remove controls.
- [x] **Task 3.2**: Compact Checkbox Accordion Closure Modal
  - Implemented `frontend/src/components/MarketClosureNoticeModal.tsx`:
    - When user pauses cutoff or marks date closed in `PharmarackCartCalendar.tsx`, opens review modal.
    - Displays calculated next delivery date and delivery timetable window.
    - Displays compact list of affected customers with checkboxes, source badges (Refill, Special Order, Online Order, CRM), and expand/collapse chevrons.
    - On click, accordion expands to show ordered medicines (name, qty, unit).
    - Displays editable WhatsApp message template box with dynamic variable tags and live preview.
    - Action buttons: "Approve & Send Notice (N)" and "Pause Silently".
- [x] **Task 3.3**: Verification & Guardrails
  - Ran `npm run guardrails` -> passed exit code 0 (`tsc --noEmit` OK, no performance violations).
  - Ran `node scripts/quick-update.mjs` -> updated knowledge graph in 2.7s.

---

## Completion Log
- **2026-09-29**:
  - Implemented `getDeliverySchedules()` and `saveDeliverySchedules()` in `src/services/storeSettingsService.ts`.
  - Implemented forward-scanning calendar calculator `getNextAvailableWorkingDate()` in `src/services/orderScheduleService.ts` honoring `pharmacy_closed_dates`, `pharmarack_paused_dispatch_dates`, and `pharmacy_market_closure_config`.
  - Implemented `getAffectedClosureCustomers()` and `sendApprovedClosureNotices()` in `src/services/marketClosureService.ts` aggregating Refills, Special Orders, Online Orders, and CRM tasks.
  - Implemented `GET /api/pharmarack/affected-closure-patients` and `POST /api/pharmarack/send-closure-notices` in `src/routes/pharmarack.ts`.
  - Added Entity Guard to `awaiting_qty` in `src/services/whatsappIntentService.ts` to prevent "Pan 40" / "Augmentin 625" from being parsed as quantity.
  - Added `awaiting_merge_choice` state handler and linked add-on order creation (`#SO-XXXX-B`) for already-ordered distributor orders.
  - Injected `getDynamicDeliveryNotice(db)` into WhatsApp customer confirmations.
  - Added Delivery Schedules configuration UI in `frontend/src/pages/Settings/index.tsx`.
  - Created `frontend/src/components/MarketClosureNoticeModal.tsx` and integrated it with `PharmarackCartCalendar.tsx` date pausing and market closure configuration.
  - Added API methods `getAffectedClosurePatients` and `sendClosureNotices` in `frontend/src/services/api.ts`.
  - Guardrails verified (`npm run guardrails` passed, exit code 0).
  - Auto-knowledge graph updated (`node scripts/quick-update.mjs` finished in 2.7s).
