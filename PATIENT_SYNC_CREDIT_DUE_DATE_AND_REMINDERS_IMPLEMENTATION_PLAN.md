# Implementation Plan: Patient Sync, Default Credit Due Date (7th of Month), & Overdue Reminders

## Overview
1. **Single Source of Truth for Patient Phone & Name**:
   - Link `customer_id` into `patient_call_tasks`.
   - Update `GET /api/call-tasks` to perform a live join with `customers` table so the Call Reminders Board always shows the live customer phone and name.
   - Cascade updates from `PUT /refills/patient-medicines` and `PUT /crm/patients/:id` to `customers`, `patient_refills`, `patient_call_tasks`, and staged `automation_notifications`.
   - Broadcast SSE events (`call_tasks_updated`, `customers_updated`, `refills_updated`).
   - Fix existing stranded records in the live database (Mr. ANKUSH MORE Task #16 &rarr; `8796791559`).

2. **Default Credit Due Date (7th of Every Month)**:
   - Provide helper `getNext7thDueDate()`: If today is on/after 7th, set due date to 7th of next month; if before 7th, set to 7th of current month.
   - When saving a credit bill at POS or creating a credit customer without an explicit due date, default `credit_due_date` to the upcoming 7th.
   - In the frontend POS checkout modal, prefill the credit due date with this upcoming 7th date.

3. **Overdue Payment Reminder with UPI QR & WhatsApp Fallback**:
   - In `src/services/creditReminderService.ts`:
     - Scan customers where `credit_due_date < date('now')` and `credit_balance > 0`.
     - Check WhatsApp registration (`whatsappClient.isRegisteredUser`).
     - If registered on WhatsApp: dispatch/enqueue reminder with UPI QR code & payment summary (Human-in-the-Loop reviewable in WhatsApp Queue per Rule 6).
     - If NOT registered on WhatsApp: create/update a task in `patient_call_tasks` (`task_type = 'credit_due'`), notifying the staff on the Call Reminders board to call the patient.
     - Broadcast SSE `call_tasks_updated`.

4. **Universal SSE Real-time Updates**:
   - Ensure frontend listeners on Call Reminders Board, Customer Credit, and Refills react to SSE broadcasts with instant in-memory cache updates.

---

## Tasks & Progress Tracking

- [x] Task 1: Schema & DB Migration: Add `customer_id` to `patient_call_tasks` in `src/database.ts` and create index.
- [x] Task 2: Live Database Migration & Fix for Mr. ANKUSH MORE (Task #16).
- [x] Task 3: Backend Query Join in `src/routes/callTasks.ts` with `customers` table.
- [x] Task 4: Atomic Cascade Updates in `src/routes/refills.ts` and `src/routes/crm.ts`.
- [x] Task 5: 7th-of-Month Default Credit Due Date Helper & POS Integration in backend & frontend.
- [x] Task 6: Overdue Reminder with WhatsApp Registration Check & Call Task Fallback in `src/services/creditReminderService.ts`.
- [x] Task 7: Guardrails & Knowledge Graph verification (`npm run guardrails` and `node scripts/quick-update.mjs`).

---

## Completion Report

### Summary of Completed Work
1. **Single Master Source of Truth for Patient Data (`customers` table)**:
   - Added `customer_id INTEGER DEFAULT NULL` and index `idx_call_tasks_customer_id` to `patient_call_tasks` across both full schema DDL and fast-boot schema (`src/database.ts`).
   - Updated `src/routes/callTasks.ts` (`GET /api/call-tasks`) to join dynamically with `customers` (`LEFT JOIN customers c ON pct.customer_id = c.id...`), using `COALESCE(c.phone, pct.patient_phone) AS patient_phone`.
   - Updated `src/routes/refills.ts` (`PUT /patient-medicines`) and `src/routes/crm.ts` (`PUT /patients/:id`) with an atomic cascade: modifying a patient's contact or name immediately cascades across `customers`, `patient_refills`, `patient_call_tasks`, and staged `automation_notifications`.
   - Updated live database (`G:/AI Pharmacy OS/data/app.db`): linked existing tasks to `customers` and updated Task #16 for Mr. ANKUSH MORE from `8080888043` to `8796791559`.

2. **Default Credit Bill Due Date (7th of Upcoming Month)**:
   - Implemented default due date logic in `src/routes/sales.ts`: when saving a credit sale (`paymentMedium === 'CREDIT'` or `paymentStatus === 'UNPAID'`), if `credit_due_date` is not provided or expired, it automatically defaults to the upcoming 7th (`YYYY-MM-07`).
   - Integrated `getDefault7thDueDate()` in `CustomerCreditSection.tsx` so the credit date picker automatically defaults to the upcoming 7th.

3. **Daily Overdue Reminders with WhatsApp Registration Check & Non-WA Call Fallback**:
   - In `src/services/creditReminderService.ts`: added WhatsApp capability pre-check (`checkPhoneWhatsAppRegistered`).
   - When overdue:
     - If number is registered on WhatsApp &rarr; enqueues payment reminder with amount-specific UPI QR card and PDF statement into the WhatsApp Queue (supporting Human-in-the-Loop review/approval).
     - If number is **not** registered on WhatsApp &rarr; automatically creates/updates a high-priority call task in `patient_call_tasks` (`task_type = 'credit'`) with bill count and overdue amount, and broadcasts `call_tasks_updated`.

4. **Universal SSE Real-time Updates**:
   - Added `customers_updated`, `credit_updated`, `refills_updated`, and `call_tasks_updated` mappings to `frontend/src/hooks/useGlobalSseInvalidation.ts`.
   - Connected real-time SSE listener in `CustomerCreditSection.tsx` to automatically refresh list and balances.
   - Tested and verified: `npm run guardrails` passed with zero violations (`tsc --noEmit` OK, database integrity OK). Knowledge graph updated.
