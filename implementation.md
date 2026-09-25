# Implementation Plan — Pharmacy-First Staged Reminders & Customer Auto/Manual Modes

## 1. Overview & Goal
Enable a multi-tiered, human-in-the-loop reminder system for refills and patient notifications:
1. **Stage First**: Reminders are generated and staged safely in `automation_notifications`.
2. **Pharmacy Number Briefing First**: The pharmacy's configured store/admin WhatsApp number receives a staged briefing/summary of due patient reminders.
3. **Per-Customer & Per-Refill Mode (Auto / Manual)**:
   - Each customer / refill schedule has a mode: `manual` (requires explicit pharmacist review & send) or `auto` (can be batch-approved or auto-dispatched once staged).
   - Pharmacists can toggle `Auto 🤖 / Manual 👆` per patient directly in the CRM / Refills list.
4. **Human-in-the-Loop Approval & Dissaproval**:
   - In CRM & Refills, staff can review staged messages, edit them, approve ("Send Now" / "Send All Auto"), or disapprove ("Cancel/Dismiss").
   - Settings page exposes the global default mode (`manual` vs `auto`) and the pharmacy briefing alert toggle.

---

## 2. Architecture & Database Changes (`src/database.ts`)
- Add `reminder_mode TEXT DEFAULT 'manual'` column to `patient_refills` (if not exists).
- Add `reminder_mode TEXT DEFAULT 'manual'` column to `customers` (if not exists).
- App Settings:
  - `default_refill_reminder_mode`: `'manual'` (default) or `'auto'`.
  - `reminder_admin_preview_enabled`: `'true'` (default).
- Maintain version bump in `CURRENT_SCHEMA_VERSION` (v70) and ensure both full schema and fast-boot schema paths include the column migrations.

---

## 3. Backend Implementation
### A. Refill Routes (`src/routes/refills.ts`)
- New endpoint `PUT /api/refills/:id/reminder-mode`: updates `reminder_mode` ('auto' | 'manual') for a refill and syncs to customer record.
- New endpoint `POST /api/refills/send-staged-auto`: dispatches all staged notifications whose customer is marked `auto`.
- New endpoint `GET /api/refills/staged-reminders`: returns all currently staged refill reminders with patient mode and details.
- Update `POST /api/refills/:id/send-reminder` & batch endpoints to record or honor `reminder_mode`.

### B. Morning & Staging Briefing (`src/services/refillService.ts`)
- In `sendMorningScheduleBriefingToAdmin`: include count of staged reminders (Auto vs Manual) with actionable context.
- Method `notifyAdminStagedReminders`: sends briefing to pharmacy admin WhatsApp with staged items list.

### C. CRM Routes (`src/routes/crm.ts`)
- Allow reading and updating `reminder_mode` on customers.

---

## 4. Frontend Implementation
### A. CRM Refills View (`frontend/src/pages/CRM/index.tsx`)
- In Refill Table / Card:
  - Display interactive mode toggle: `Auto 🤖` / `Manual 👆`.
  - Clicking toggle updates the mode via API with optimistic UI updates.
  - Staged Reminders banner / drawer:
    - View all staged reminders.
    - Quick action buttons: "Send" (manual single), "Dismiss" (disapprove), "Send All Auto" (human approves automated batch).
### B. Settings Page (`frontend/src/pages/Settings/index.tsx`)
- Add setting in WhatsApp / Automation tab:
  - "Default Refill Reminder Mode": Toggle between Manual (Recommended) and Auto.
  - "Notify Store Owner on Staged Reminders": Toggle on/off.

---

## 5. Investigation Page Enhancements (`frontend/src/pages/Investigation/index.tsx`)
- **Removed squished duplicate badge**: Removed the redundant `.text-[8px]` badge displaying ("Purchase" / "Sale") that was squeezing the medicine title down to unreadable truncation.
- **Dynamic space allocation**: Replaced fixed `min-w-[1750px]` with `w-full min-w-full`. All other columns remain fixed `shrink-0`, while the Medicine column uses `flex-1 min-w-[240px]`.
- **Flexible column collapse**: When users filter or hide columns in Investigation, 100% of the freed horizontal space automatically expands the Medicine column on the left rather than dividing equally across all columns.

---

## 6. Verification & Guardrails Status
- `database.ts`: Schema v70 applied with `reminder_mode` and timing settings.
- `refills.ts`: Endpoints for staging review, briefing, mode toggles, and auto-batch dispatch.
- `refillService.ts`: Admin WhatsApp staging alerts with patient counts.
- `frontend/src/pages/CRM/index.tsx`: Human-in-the-loop staging banner, patient mode chips (`Auto 🤖` / `Manual 👆`), modal mode selector, and dismiss/send actions.
- `frontend/src/pages/Settings/index.tsx`: Trigger 10 default mode and pharmacy WhatsApp briefing toggles.
- `frontend/src/pages/Investigation/index.tsx`: Medicine column space expansion and removal of cramped duplicate badge.
- `src/services/nonWaFallbackService.ts`: Non-WhatsApp communication fallback creating staff call tasks.
- `src/routes/callTasks.ts` & `frontend/src/components/CallTaskBoard.tsx`: Patient call task queue and interactive board (fixed relative import path `../services/api`).
- `data/top100_harvest_state.json`: Preserved and merged product harvest catalog state (13,005 items).
- `frontend/src/pages/POS/index.tsx`: 1-batch-per-row architecture with auto-spillover. When requested loose or strip quantity exceeds the current batch's capacity, the active batch row is capped at its stock and a new row is automatically generated for the next unexpired batch. Added `priorityBatchNo`, `priorityInventoryId`, and loose-first allocation.
- `npm run guardrails`: Verified and passing (tsc --noEmit clean).
- `node scripts/quick-update.mjs`: Knowledge graph synchronized.
- Ready for clean commit and push to main.

---

## 7. Market Closed & Store Closed Advance Buffer & Patient Notification System

### A. Business Context & Problem Solved
- During wholesale market closures (e.g. festivals, holidays, distributor strikes, Sunday shutdowns) or pharmacy holidays (e.g. renovation, family event, local holiday):
  1. The pharmacy cannot place or receive distributor orders for several days.
  2. Patients whose chronic medicine refills fall inside or immediately after the closure period risk running out of stock.
  3. The pharmacy needs to forecast upcoming patient refilling demand (default 7 days) and calculate stock shortfalls before wholesale dispatches stop.
  4. The owner needs a human-in-the-loop interactive review checklist to selectively order buffer quantities into the Pharmarack cart and stage patient WhatsApp refill notices.

### B. Backend Architecture (`src/services/marketClosureService.ts` & `src/routes/pharmarack.ts`)
- **Settings Store (`app_settings`)**:
  - Key: `pharmacy_market_closure_config` stores closure type (`market_closed` vs `pharmacy_closed`), `enabled`, `startDate`, `endDate`, `lookaheadDays` (3-14 days), and optional `reason`.
- **Buffer Analysis (`getBufferAnalysis`)**:
  - Scans `patient_refills` where `next_refill_date` falls in `[startDate, endDate + lookaheadDays]`.
  - Calculates current stock in `inventory_master` (strips + loose units).
  - Determines shortfalls, recommended reorder quantities, and recent distributor purchase info (`store_id`, `store_name`, `ptr`).
- **Human-in-the-Loop Notification Staging (`stageClosureNotices`)**:
  - Consolidates patient refill items per phone number.
  - Inserts notification records into `automation_notifications` with `status: 'staged'`, `needs_confirmation: 1`, and `reference_id: config.startDate`.
  - STRICT GUARD: Zero autonomous sending. All notices require pharmacist review & click to send.
- **Buffer to Cart Conversion (`addBufferItemsToCart`)**:
  - Inserts selected shortfall items into `special_orders` table with `status: 'pending'`, `source: 'closure_buffer'`, immediately appearing in Pharmarack Cart.
- **REST Endpoints (`src/routes/pharmarack.ts`)**:
  - `GET /api/pharmarack/closure-status`
  - `POST /api/pharmarack/closure-status`
  - `GET /api/pharmarack/closure-buffer`
  - `POST /api/pharmarack/stage-closure-notices`
  - `POST /api/pharmarack/add-closure-buffer-to-cart`

### C. Frontend Implementation
- **API Client (`frontend/src/services/api.ts`)**:
  - Typed helper methods for closure status, buffer analysis, staging notices, and cart additions.
- **Closure Configuration Modal (`frontend/src/components/MarketClosureModal.tsx`)**:
  - Allows selecting Market Closed (Wholesale shutdown) or Store Closed (Pharmacy holiday).
  - Date picker for start/end dates, lookahead window slider (3 to 14 days), and custom reason.
  - Semantic theme tokens, theme-safe toggle switch.
- **Stock Buffer Review Checklist (`frontend/src/components/ClosureStockBufferModal.tsx`)**:
  - Interactive table displaying affected patient name, refill date, required qty, stock on hand, shortfall, and editable reorder quantity.
  - Batch checkboxes for granular selection.
  - "Add Selected to Cart" -> immediately creates Pharmarack Cart orders.
  - "Stage WhatsApp Notices" -> stages advance notices for patient communication without auto-dispatching.
- **Calendar & Cart Toolbar Integration (`frontend/src/components/PharmarackCartCalendar.tsx`)**:
  - Header buttons: `Market Closed` & `Store Closed`.
  - Amber `Buffer Review (X)` badge button showing active shortfall count.
  - Status banner when closure mode is enabled.



