# Implementation Plan: Morning Briefing & Reorder Hub Flow

## 1. Objective & Requirements
Implement the consolidated Morning Briefing & Reorder Hub pipeline according to the approved architecture:
1. **Collect Data from All Sources**:
   - `Online Orders`: website orders pending, processing, awaiting stock, not delivered.
   - `Refill Requests`: pending refills, partially fulfilled refills, approval required.
   - `Special Orders`: customer requests, procurement needed, supplier follow-up.
   - `Manual Call Tasks`: non-WhatsApp / unregistered / manual calling queue.
2. **Process & Prepare Briefing**:
   - Fetch all pending records from Reorder Hub, Special Orders, Online Orders, and Call Tasks.
   - Deduplicate & filter completed/cancelled items.
   - Verify WhatsApp registration & phone availability (3-way check).
3. **Morning Briefing Dashboard**:
   - 4 Live Cards with live badge counts and view details actions:
     - Pending Refills (Green)
     - Special Orders (Purple)
     - Online Orders (Blue)
     - Call Tasks (Amber)
   - Real-time SSE updates so briefing updates immediately as orders/tasks change status.
4. **Channel Routing Engine**:
   - `WhatsApp Available`: stage reminder/update in `automation_notifications` (human-in-the-loop review).
   - `WhatsApp Unavailable`: add to `patient_call_tasks` queue with customer details, order/medicine context, priority, and reason.
   - `No Usable Phone Number`: flag for `Contact Details Review` so staff can correct missing contact info before calling.
5. **Call Outcome Pipeline State Machine**:
   - `Pending Call` -> `Called` -> `Call Outcome`:
     - `Customer Responded` -> `Resolved` (completed).
     - `No Answer` -> `Follow-up Required` -> loops back into `Pending Call` with follow-up timestamp.
     - `Further Action Needed` -> `Follow-up Required` -> loops back into `Pending Call` with follow-up timestamp.

---

## 2. Architecture & File Plan

| File | Subsystem | Action | Purpose |
| :--- | :--- | :--- | :--- |
| `src/services/morningBriefingService.ts` | Backend Service | Create | Fetch, deduplicate, validate contact availability, and compile morning briefing data. Handle channel routing and call outcome pipeline. |
| `src/routes/morningBriefing.ts` | Backend Routes | Create | API endpoints `GET /api/morning-briefing`, `POST /api/morning-briefing/update-contact`, `POST /api/morning-briefing/call-outcome`. |
| `src/server.ts` | Express Server | Edit | Mount `/api/morning-briefing` router. |
| `frontend/src/types/morningBriefing.ts` | Frontend Types | Create | TypeScript types for morning briefing summary, cards, routing queues, and call outcomes. |
| `frontend/src/services/morningBriefingApi.ts` | Frontend API | Create | API client for morning briefing endpoints and contact updates. |
| `frontend/src/components/MorningBriefingDashboard.tsx` | Frontend UI | Create | 4 Cards dashboard, 3-way routing controls, contact review modal/banner, and interactive Call Outcome pipeline. |
| `frontend/src/pages/Dashboard/index.tsx` | Dashboard Page | Edit | Embed `MorningBriefingDashboard` at the top of the main Dashboard. |
| `tests/morningBriefingPipeline.test.ts` | Automated Tests | Create | Comprehensive integration tests verifying 4 source collections, deduplication, 3-way routing, and call outcome state machine. |
| `implementation.md` | Task Tracking | Maintain | Live task completion log per Rule 10. |

---

## 3. Step-by-Step Execution Plan

1. **Step 1: Backend Service (`src/services/morningBriefingService.ts`)**
   - Query pending records across Refills, Special Orders, Online Orders, and Call Tasks.
   - Deduplicate records and evaluate contact validity (valid 10-digit mobile).
   - Classify into 3 channels: WhatsApp Available, WhatsApp Unavailable, No Usable Phone.
   - Implement `recordCallOutcome` advancing tasks through `Pending Call` -> `Called` -> `Resolved` vs `Follow-up Required` (loop to `Pending Call`).
   - Implement `updateContactDetails` updating customer phone and re-evaluating routing.
2. **Step 2: API Route Handler (`src/routes/morningBriefing.ts` & `src/server.ts`)**
   - Expose `GET /api/morning-briefing`, `POST /api/morning-briefing/route-channel`, `POST /api/morning-briefing/update-contact`, `POST /api/morning-briefing/call-outcome`.
   - Mount in `src/server.ts`.
3. **Step 3: Frontend Types & API Client (`frontend/src/types/morningBriefing.ts` & `frontend/src/services/morningBriefingApi.ts`)**
   - Define data contracts and query hooks using TanStack Query.
4. **Step 4: Frontend UI Component (`frontend/src/components/MorningBriefingDashboard.tsx`)**
   - 4 Overview cards with real-time counts, status chips, and quick navigation.
   - Contact Review drawer/alert for items with missing phone numbers.
   - Interactive Call Outcome buttons (Called, Customer Responded, No Answer, Further Action Needed).
   - Strictly semantic Tailwind classes (`bg-bg`, `bg-bg2`, `text-text`, etc.).
5. **Step 5: Integrate into Main Dashboard (`frontend/src/pages/Dashboard/index.tsx`)**
   - Place `MorningBriefingDashboard` at the top of the Dashboard.
6. **Step 6: Automated Integration Tests (`tests/morningBriefingPipeline.test.ts`)**
   - Write and run integration tests for all 4 sources, deduplication, 3-way routing, and call outcome state transitions.
7. **Step 7: Verification & Quality Gates**
   - Verify client build (`npm run build:client`).
   - Verify performance guardrails (`npm run guardrails`).
   - Update knowledge graph (`node scripts/quick-update.mjs`).

---

## 4. Completed Tasks Log
- [x] Task 1: Create `src/services/morningBriefingService.ts` with source collection, deduplication, 3-way contact classification, and call outcome state transitions.
  - *Details*: Implemented `getMorningBriefing()` aggregating 4 data streams: Online Orders (`website_orders`), Refill Requests (`patient_refills`), Special Orders (`special_orders`), and Call Tasks (`patient_call_tasks`). Implemented deduplication by phone/medicine, 3-way contact classification (`whatsapp_available`, `whatsapp_unavailable`, `no_usable_phone`), channel routing (`routeToWhatsAppQueue`, `routeToCallTaskQueue`, `updateContactDetails`), and call outcome progression (`advanceCallOutcome`: `called` -> `customer_responded`/`resolved`, `no_answer` -> `follow_up_required` loop back to `pending_call` with reschedule date, `further_action_needed` -> `follow_up_required` loop back to `pending_call` with reschedule date). Uses `toLocalSqlDateTime()` complying with guardrail B4.
- [x] Task 2: Create `src/routes/morningBriefing.ts` and mount in `src/server.ts`.
  - *Details*: Built express endpoints `GET /api/morning-briefing`, `POST /api/morning-briefing/route-channel`, `POST /api/morning-briefing/update-contact`, and `POST /api/morning-briefing/call-outcome`. Mounted lazy router at `/api/morning-briefing` in `src/server.ts`. Also updated `src/database.ts` schema v83 to expand `patient_call_tasks` check constraint and add columns (`priority`, `call_attempts`, `last_called_at`).
- [x] Task 3: Create frontend types and API client (`morningBriefing.ts` & `morningBriefingApi.ts`).
  - *Details*: Defined models for `MorningBriefingItem`, `MorningBriefingCategorySummary`, `MorningBriefingSummary`, `ContactChannelClassification`, and `CallOutcomeRequest`. Implemented TanStack query and mutation functions with SSE invalidations in `morningBriefingApi.ts`.
- [x] Task 4: Create `MorningBriefingDashboard.tsx` with 4 overview cards, 3-way routing, contact review, and call outcome loop.
  - *Details*: Built 4 live metric cards (Pending Refills, Special Orders, Online Orders, Call Tasks) with status badges, detail breakdown drawer, Contact Details Review banner/dialog for missing/invalid phones, and interactive Call Outcome modal supporting `called`, `customer_responded`, `no_answer`, and `further_action_needed` with loop-back rescheduling. Uses strictly semantic Tailwind classes (`bg-bg`, `bg-bg2`, `text-text`, `border-border`) and local date formatters.
- [x] Task 5: Embed `MorningBriefingDashboard` into `frontend/src/pages/Dashboard/index.tsx`.
  - *Details*: Mounted `<MorningBriefingDashboard className="mb-6" />` directly beneath the Quick Action Bar on the primary dashboard view.
- [x] Task 6: Create and run `tests/morningBriefingPipeline.test.ts` to verify all pipeline branches.
  - *Details*: Added 12 comprehensive unit and integration tests covering multi-source aggregation, deduplication across refills, 3-way channel routing, phone number correction, and the complete call outcome state machine loop (`pending_call` -> `called` -> `no_answer` -> `follow_up_required` -> `pending_call`). All 12 tests passed (Exit Code 0). Verified regression against `refillBatchPipeline.test.ts` (9 of 9 passed).
- [x] Task 7: Pass all quality gates (`npm run build:client`, `npm run guardrails`, `node scripts/quick-update.mjs`).
  - *Details*: Production client build succeeded (`tsc -b && vite build` built in 51.89s with 0 errors). Guardrails scanner (`npm run guardrails`) passed with 0 violations. Knowledge graph synchronized (`node scripts/quick-update.mjs`) with 1311 nodes and 856 edges.