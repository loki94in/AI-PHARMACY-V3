# Implementation Plan: Market & Store Closure Independence & Smart Messaging Automation

## Context & Objectives
- **Bug/Issue:** User selected "Market is Off" for Dipawali (9, 10, 11 Nov) in the Calendar, but did NOT select "Store Closed" (the pharmacy is open 7 days a week, weekly off is "None"). However, when booking an order for a customer (Mr. Mohan Rai) on Sunday, 8 Nov at 11:13 AM, the app sent a WhatsApp message falsely claiming:
  `🕒 *सूचना:* हमारी दुकान आज बंद है। हम tomorrow (Mon, 9 Nov) को 9:00 AM पर फिर खुलेंगे।`
  This contradicted the reality that the physical counter was open, and failed to tell the customer that because of Diwali market closure, the medicine would actually arrive on Thursday, 12 Nov.
- **Requirement:** 
  1. Make Store Closure strictly independent from Market Closure: when Market is Closed, the physical Store remains 100% OPEN unless explicitly marked closed in `pharmacy_closed_dates`.
  2. If `pharmacy_weekly_off` is `"None"`, Sundays must NOT be treated as a closed day.
  3. Automatically detect any Market Closure dates (e.g. 9-11 Nov, 16th, 20th, or any future date) and generate a clear, smart medicine arrival notice for the customer in Hindi, Marathi, and English.
  4. Ensure Refill reminders and upcoming patient notifications distinguish between Market Closed vs Store Closed.

---

## Architectural Changes & Affected Files

1. `src/utils/pharmacyCalendar.ts`:
   - Sunday handling: If `weeklyOff === 'none'` or empty, `isWeeklyOff` must evaluate to `false` (do not force closure on Sundays).
   - Market holiday separation: `isStoreClosure` is strictly for store closures (`type === 'pharmacy_closed'`). `type === 'market_closed'` only sets `isMarketClosed = true`.
   - Prevent `pharmacy_holidays` with "MARKET" in name from setting `isHolidayClosed = true` for the physical store.

2. `src/routes/settings.ts`:
   - When updating `pharmacy_weekly_off`, if set to `"None"`, synchronize `sunday_orders_enabled` and `operates_sunday` to `"true"` in `app_settings`.

3. `src/utils/closureNotice.ts`:
   - Add `getMarketArrivalNotice(deliveryDate, reason, lang)` to format smart medicine arrival notes in Hindi, Marathi, and English.
   - Refactor `getRefillScheduleOpts` to identify whether an upcoming closure is a Store Closure or a Market Closure, populating `closureKind: 'market' | 'store'`.

4. `src/routes/orders.ts`:
   - In both batch and single special order creation, if the store is open right now, do not append a store closed notice.
   - If `calculatedSchedule` has a shifted delivery date due to market closure or holiday, append the smart arrival notice indicating when the medicine will arrive.

5. `app_settings` Database update:
   - Ensure `sunday_orders_enabled` is set to `"true"` for the current store whose weekly off is `"None"`.

6. Verification:
   - Unit tests: `tests/closureNotice.test.ts` & `tests/singleDateMarketOff.test.ts`.
   - Guardrails check: `npm run guardrails`.
   - Knowledge graph update: `node scripts/quick-update.mjs`.

---

## Execution Tasks

- [x] Task 1: Fix Sunday & Market closure independence in `src/utils/pharmacyCalendar.ts` and sync `src/routes/settings.ts`.
  - *Completed:* When `weeklyOff === 'none'`, Sundays are no longer forced as off-days. `pharmacy_holidays` with "MARKET" in their name only set `isMarketClosed` and no longer close the physical store. When saving settings with `pharmacy_weekly_off: 'None'`, `sunday_orders_enabled` is synchronized to `'true'`.
- [x] Task 2: Implement smart arrival notice and closure-kind separation in `src/utils/closureNotice.ts`.
  - *Completed:* Added `getMarketArrivalNotice(deliveryDate, reason, lang)` supporting Hindi, Marathi, and English. Updated `getRefillScheduleOpts` to output `isMarketClosure` so reminders can distinguish between distributor market pause vs pharmacy counter shut.
- [x] Task 3: Integrate smart arrival notice into `src/routes/orders.ts` (batch and single booking) and `src/routes/refills.ts`.
  - *Completed:* In batch & single special order confirmation WhatsApp, if delivery is shifted due to market closure, customer receives expected medicine arrival date (`Thu, 12 Nov`) instead of a false store closure note. Refill reminders and collection reminders distinguish store shut vs market shut.
- [x] Task 4: Update live database `app_settings` (`sunday_orders_enabled: true`) and test with real scenario.
  - *Completed:* Synchronized active database settings. Verified Sunday 8 Nov order simulation: counter is open, `getShopTimingNow()` returns `null`, and false "हमारी दुकान आज बंद है" is eliminated. Verified Monday 9 Nov Diwali simulation: arrival note correctly outputs `Thu, 12 Nov`.
- [x] Task 5: Run tests (`npm test tests/closureNotice.test.ts`, `tests/singleDateMarketOff.test.ts`), `npm run guardrails`, and `node scripts/quick-update.mjs`.
  - *Completed:* All unit tests pass (13/13). Performance guardrails pass with clean TypeScript compilation. Knowledge graph refreshed.
