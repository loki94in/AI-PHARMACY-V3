# Implementation Plan: Dynamic Operating Hours & Market Cutoffs in Refill Messaging

> **User Request & Requirements:**
> - Make refill messages dynamically aware of actual store operating hours (formatted clearly in 12-hour AM/PM format, not rigid/military '9-10').
> - Automatically detect and notify customers if the store is currently closed, on weekly off, or if the wholesale distributor market / cutoff has passed for placing orders.
> - Include expected fulfillment/procurement delivery windows (`getDynamicDeliveryNotice`) in customer confirmation messages so expectations are clear when orders are placed after-hours or on weekends/holidays.

---

## 1. Root Cause & Architectural Strategy

1. **Refill Confirmation Acknowledgment Missing Market Notice**:
   - In `src/services/whatsappIntentService.ts` (lines 4800–4825), the confirmation message prints raw `sched.openTime to sched.closeTime` (e.g. `09:00 to 22:00`).
   - It did not incorporate `getDynamicDeliveryNotice(db)`, which calculates whether the wholesale market cutoff has passed (e.g. after-hours order or Sunday market closure) and computes the exact expected delivery date and slot via `orderScheduleService.ts`.

2. **24-Hour Military Time Format in Refill Reminders**:
   - In `src/routes/refills.ts:buildRefillReminderMessage`, hours are displayed as `09:00 to 22:00` and `(Store open 09:00 - 22:00)`.
   - We will format operating hours using user-friendly 12-hour format with AM/PM (e.g. `9:00 AM to 10:00 PM`) and include weekly off details.

3. **Staged Refill Notification Incomplete Context**:
   - In `src/services/refillService.ts:syncStagedRefillNotificationForPatient`, reminders did not load the store's operating schedule or check for upcoming weekly off days.
   - We will fetch `getPharmacyOperatingSchedule(db)` to embed dynamic store hours and upcoming closure notices directly into staged reminders.

---

## 2. Proposed Changes

### Backend

#### 1. `src/services/whatsappIntentService.ts`
- In the refill confirmation acknowledgment section:
  - Format `sched.openTime` and `sched.closeTime` using `formatTime12h` (e.g. `9:00 AM to 10:00 PM`).
  - Append `sched.weeklyOff` (if configured) so customers know regular weekly off days.
  - Call `await getDynamicDeliveryNotice(db)` and append the dynamic expected delivery / market closure notice to the acknowledgment message.

#### 2. `src/routes/refills.ts`
- In `buildRefillReminderMessage`:
  - Format `openT` and `closeT` through `formatTime12h` so reminder messages display `9:00 AM to 10:00 PM` instead of `09:00 to 22:00`.
  - Update English, Hindi, and Marathi templates to display clean, localized 12-hour store hours.

#### 3. `src/services/refillService.ts`
- In `syncStagedRefillNotificationForPatient`:
  - Load `getPharmacyOperatingSchedule(db)`.
  - Check upcoming weekly off days (`isOffDayUpcoming`).
  - Include dynamic store hours and weekly off alert in staged reminder messages.

---

## 3. Verification Plan

### Automated Verification
- Run `npm run guardrails` (`tsc --noEmit` and performance checks).
- Run `node scripts/quick-update.mjs` (knowledge graph sync).

### Functional & Scenario Verification
1. **Refill Confirmation Acknowledgment**:
   - Verify acknowledgment contains clean 12-hour operating hours (e.g. `9:00 AM to 10:00 PM`).
   - Verify post-cutoff / closed market notice is appended when ordering outside market hours.
2. **Reminder Message Formatting**:
   - Verify `buildRefillReminderMessage` outputs 12-hour store hours.
   - Verify weekly off notice appears if next day / due day is an off day.

---

## 4. Completed Tasks
- [x] Task 1: Add dynamic delivery notice and 12-hour store hours to refill confirmation acknowledgment in `whatsappIntentService.ts`
  - *Completed*: Updated `whatsappIntentService.ts` to format operating hours in 12-hour AM/PM format (e.g. `9:00 AM – 10:00 PM`), append weekly off, and attach `getDynamicDeliveryNotice(db)` so customers receive expected delivery slots or post-cutoff/market closure notifications.
- [x] Task 2: Format operating hours as 12-hour AM/PM in `buildRefillReminderMessage` in `src/routes/refills.ts`
  - *Completed*: Added `formatTime12h` in `src/routes/refills.ts` to convert `09:00 - 22:00` into `9:00 AM – 10:00 PM` across English, Hindi, and Marathi reminder and collection templates.
- [x] Task 3: Embed dynamic store hours & weekly off awareness into `syncStagedRefillNotificationForPatient` in `src/services/refillService.ts`
  - *Completed*: In `src/services/refillService.ts`, dynamically load `getPharmacyOperatingSchedule(db)`, calculate upcoming weekly off closures, and embed formatted 12-hour hours and off-day warnings in staged messages.
- [x] Task 4: Run `npm run guardrails` and update knowledge graph with `quick-update.mjs`
  - *Completed*: Verified with `npm run guardrails` (`tsc --noEmit` passed clean, 0 violations). Synced knowledge graph with `node scripts/quick-update.mjs` (1173 nodes, 782 edges updated).
