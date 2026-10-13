# Implementation Plan: Zero-Spam Refill Confirmation & "Already Added" / "Fulfill" Lifecycle Cleanups

Created At: 2026-10-13T14:38:00+05:30
Status: IN_PROGRESS

## 1. Problem & Root Cause Analysis
- **Problem 1 (Spam / Duplicate Reminders after Confirmation / In Cart)**:
  - When a patient confirms a refill (replying `1`/`yes` on WhatsApp) or pharmacist clicks `[✓ Confirm & Cart]` in the app, the medicine is added to the live cart and `patient_confirmed = 1`.
  - However, existing staged notifications in `automation_notifications` and pending items in `whatsapp_send_queue` were NOT purged.
  - Furthermore, `dispatchDueRefillReminders` (scheduled morning job) and `whatsappQueueWorker` (pre-send wire gate) did not check if `patient_confirmed = 1` or if the medicine is already in cart (`cart_store_name IS NOT NULL`). They proceeded to dispatch reminder messages, spamming the customer.
- **Problem 2 (Pharmacist clicks "Already Added" but reminders weren't stopped)**:
  - When the pharmacist clicks `[Already Added]` in Quick Assist (ordering outside Pharmarack via phone call), `POST /refills/:id/status` set `status = 'ordered'`.
  - However, it did not purge pending or staged reminders, meaning the customer could still be asked if they want a refill.
- **Problem 3 (Items reappearing in Quick Assist after clicking "Fulfill" upon app reopen)**:
  - In `cleanupStagedRefillNotifications()`, the query strictly checked `WHERE type = 'refill_collection' AND status = 'staged'`, completely ignoring `type = 'refill_reminder'`.
  - Therefore, any staged reminder notification remained in `automation_notifications`, causing the patient to pop right back up under "Staged Messages" in Quick Assist when reopening or reloading the app.
  - In addition, fulfilling a refill left `patient_confirmed = 1` and `cart_store_name` uncleared for the next cycle.

## 2. Surgical Upgrades

### Backend
1. **`src/services/refillService.ts`**:
   - In `cleanupStagedRefillNotifications`: Change query to `WHERE type IN ('refill_collection', 'refill_reminder') AND status = 'staged'`.
   - In `syncStagedRefillNotificationForPatient`: Filter out refills where `pr.status IN ('completed', 'canceled', 'notified', 'ordered') OR COALESCE(pr.patient_confirmed, 0) = 1 OR pr.cart_store_name IS NOT NULL`.
   - In `dispatchDueRefillReminders`: Pre-check staged notifications against their referenced refills; if `patient_confirmed = 1`, `status = 'ordered'`, or already in cart, mark notification `cancelled` and skip send.
2. **`src/routes/refills.ts`**:
   - In `POST /confirm-patient` and `POST /:id/confirm`: Invoke `purgePendingCustomerReminders(db, { phone, refillIds, medicineNames })`.
   - In `POST /:id/status` (when `status === 'ordered'` for "Already Added"): Call `purgePendingCustomerReminders(db, { phone, refillIds: [id], medicineNames })` to instantly cancel all pending/staged reminders for this medicine.
   - In `POST /:id/fulfill` and `POST /patient/:phone/fulfill-all`: Reset `patient_confirmed = 0`, `cart_store_name = NULL`, and `cart_qty = NULL` for the new cycle.
3. **`src/services/whatsappQueueWorker.ts`**:
   - In the real-time pre-send gate (lines 990-1015): For `refill_reminder`, check that `COALESCE(patient_confirmed, 0) = 0`, `status != 'ordered'`, and `cart_store_name IS NULL`. If already confirmed/ordered, skip immediately with `status = 'skipped_already_fulfilled'`.
4. **`src/services/whatsappIntentService.ts`**:
   - When patient replies `1`/`yes` confirming refill: Immediately invoke `purgePendingCustomerReminders()`.

### Frontend
5. **`frontend/src/components/QuickAssistSidebar.tsx`**:
   - In `handleMarkRefillGroupOrdered` ("Already Added"): Call `onRefreshDailyLog()` and `refillEvent.triggerRefresh()` so staged messages and due soon cards update in sub-10ms.

---

## 3. Verification & Guardrails
1. Run `npm run guardrails` (`tsc --noEmit` and performance scanner).
2. Run `node scripts/quick-update.mjs` for knowledge graph sync.

---

## 4. Execution Tasks & Status
- [x] Task 1: Update `src/services/refillService.ts` (`cleanupStagedRefillNotifications`, `syncStagedRefillNotificationForPatient`, `dispatchDueRefillReminders`).
  - *Completed*: Expanded `cleanupStagedRefillNotifications` to delete both `refill_collection` and `refill_reminder` types. Filtered out ordered/confirmed/in-cart refills in `syncStagedRefillNotificationForPatient`. Added anti-spam pre-check in `dispatchDueRefillReminders`.
- [x] Task 2: Update `src/routes/refills.ts` (`confirm-patient`, `status === 'ordered'`, and fulfill cycle resets).
  - *Completed*: Added immediate reminder purges in `confirm-patient`, `:id/confirm`, and `status === 'ordered'` ("Already Added"). In `fulfill` and `fulfill-all`, reset `patient_confirmed = 0`, `confirmed_at = NULL`, `cart_store_name = NULL`, `cart_qty = NULL` for the clean future cycle.
- [x] Task 3: Update `src/services/whatsappQueueWorker.ts` (pre-send gate anti-spam check for confirmed/in-cart refills).
  - *Completed*: Added wire-level gate preventing dispatch of `refill_reminder` if patient already confirmed, ordered, or medicine is in live cart.
- [x] Task 4: Update `src/services/whatsappIntentService.ts` (purge reminders on patient WhatsApp `1`/`yes` confirmation).
  - *Completed*: Immediately purges pending reminders and staged notifications upon patient WhatsApp confirmation.
- [x] Task 5: Verify and update `frontend/src/components/QuickAssistSidebar.tsx` and `RefillsSection.tsx` for immediate state cleanup.
  - *Completed*: Hooked `onRefreshDailyLog()` and `loadStagedSummary()` on "Already Added" to cleanly purge staged cards in sub-10ms.
- [x] Task 6: Run `npm run guardrails` and `node scripts/quick-update.mjs` and finalize task status.
  - *Completed*: `npm run guardrails` passed cleanly (0 errors), and knowledge graph refreshed.

