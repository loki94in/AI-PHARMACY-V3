# UNIFIED WHATSAPP BOT AUTO-WORK IMPLEMENTATION PLAN (Single Plan)
**AI Pharmacy v2 — Root Plan | Status: PLAN ONLY (no code changed) | Date: 2026-09-20**

> One single implementation path. No second order system, no second refill system,
> no second inventory, no second POS, no duplicate customer history.
> This file is the ONLY plan agents must follow step-by-step to reach 100%.
> Cross-check section at the end is mandatory for every agent.

---

## 1. OBJECTIVE

Make the bot auto-work without failed schedule / credit / owner-forward gaps:

1. WhatsApp bot + special_orders + patient_refills + website refill work as ONE flow.
2. Scheduled messages (refill, credit, delay, arrival) never fail silently; they queue durably and send per schedule date/time.
3. Credit auto-reminder sends amount-specific UPI QR to collect payment.
4. Owner gets forwarded every actionable event AS PER schedule date/time in the app.
5. If anyone makes payment and shares screenshot in chat, app detects, stages, forwards to owner, and completes on owner CONFIRM.
6. WhatsApp stays always-available by default but sleep time remains user-controllable in Settings.
7. No bulk flush: offline burst = single "we are here, ready to take order" reply.

Existing chain preserved:

```
MASTER PRODUCT -> INVENTORY -> ONLINE CATALOG -> CUSTOMER ORDER (WA / refill / website)
 -> PAYMENT (QR 50 / credit QR) -> PHARMACY LIVE ORDER -> VERIFICATION
 -> LIVE CART (Pharmarack) -> FINAL CONFIRMATION -> POS -> CUSTOMER HISTORY -> FUTURE REFILL
```

Payment != sale. Pharmacy verification + POS linkage stay mandatory.

---

## 2. CURRENT REALITY (Read-Only Audit — Do Not Re-Implement)

### 2.1 WhatsApp automation today
- Entry: `src/whatsappClient.ts` (`message_create` -> persist `whatsapp_messages` -> `handleInbound()`).
- Orchestrator: `src/services/whatsappIntentService.ts:1` (`handleInbound`, `checkMedicineClarificationResponse`, `executeConfirmedProcurementFlow`, `proceedWithConfirmedProcurement`).
- Guards: `isIgnored` (groups/broadcast), `isDistributorOrInternal` (`whatsappIntentService.ts:147` checks distributors/pharmarack_distributors/delivery_boys/owner by last10), `isPromotionalOrBroadcastMessage` (`src/services/intentKeywords.ts:132`).
- Parse: `extractMedicineCandidates` (`intentKeywords.ts:365`, splits aur/and/bhi, cap 8) + `parseMessage` + scispaCy CHEMICAL.
- Search per candidate: `productNameFilterService.filterProductNames` (FTS5) -> `resolveInventoryStock()` (batched `inventory_master is_active=1`) -> `classifyAvailability` (`IN_STOCK | REGISTERED_NO_STOCK | EXTERNAL_ONLY`) -> `detectNonAllopathicKind` (`intentKeywords.ts:547`, skip Pharmarack for cosmetic/ayurvedic/homeopathy) -> `searchCatalog(sanitizePharmarackQuery)` + `performPharmarackSearch` -> gate `passesGate(0.60 with intent / 0.72 implicit)` (`whatsappIntentService.ts:28`) -> `broadcast('wa_medicine_match')` -> `wa_medicine_requests` -> `waAdminEscalationService.maybeEscalate` (`src/services/waAdminEscalationService.ts:173`).
- FSM: `wa_pending_clarifications {phone PK, suggested_name, options_json, quantity, unit, step, special_order_id, so_code}` steps:
  `awaiting_customer_name -> awaiting_medicine -> awaiting_selection -> awaiting_medicine_confirmation -> awaiting_qty -> awaiting_qty_confirmation -> awaiting_order_customer_name? -> awaiting_owner_selection -> awaiting_payment -> awaiting_owner_payment_confirmation -> completed`
  Key handlers: `awaiting_medicine` (`whatsappIntentService.ts:1154`, 45 prefix LIKE + FTS + catalog, 15/page `1-15 MORE`), `awaiting_selection` (`whatsappIntentService.ts:1264`), `awaiting_qty` (`whatsappIntentService.ts:1383`, `extractQuantityFromText`), `proceedWithConfirmedProcurement` (`whatsappIntentService.ts:1539`: search Pharmarack, filter `isItemInStock`, `INSERT special_orders Pending advance 50 UNPAID`, link `wa_pending_clarifications`, `notifyOwnerOfSpecialOrderPharmarackResults`, customer wait msg).
- Owner commands: `handleOwnerInteractiveReply` (`whatsappIntentService.ts:1646`): `SO-xxx N` select distributor (`whatsappIntentService.ts:1926` -> `UPDATE special_orders pharmarack_distributor/rate AWAITING_PAYMENT` + `paymentQrService.allocateNextQr` + `customer_payment_qr` image), `CONFIRM SO-xxx` (`whatsappIntentService.ts:1776` -> `VERIFIED/Confirmed` + `INSERT online_order_items` + `addItemsToPharmarackCart` + staged `whatsapp_order` + `notifyAdminOfLiveCartAdd`), `RX CONFIRM/REJECT`.
- Refill ACK: `isRefillConfirmationResponse` (`intentKeywords.ts:453`: refill/yes/haan/bhej do/pathva/...) at `whatsappIntentService.ts:2259` does ONLY `UPDATE patient_refills patient_confirmed=1` + `broadcast refill_updated` + optional ack with store hours. No order created.
- Guidance: `maybeSendGuidancePrompt` (`whatsappIntentService.ts:292`) inserts `awaiting_medicine` + sends Namaste welcome + `getStoreHoursNotice()` (`whatsappIntentService.ts:261` reads `getPharmacyOperatingSchedule`, IST check, returns weekly-off/closed note or empty).
- Queue: `src/services/whatsappQueueWorker.ts` lazy loop (no auto-start), 10–15s pacing (`loadPacingConfig`), same-day `number+message` dedupe (`enqueue`), `forceNext()` for user-clicked instant, `delivery_register` 48h dedupe, `cleanupOldSentItems` crash recovery.

### 2.2 Old refill today
- Engine: `src/services/refillService.ts:5 checkAllRefills` called by `src/services/orderFulfillmentService.ts` cron (`automation_enabled/trigger_refills_enabled/trigger_refills_check_time` default 09:00, P3 `activityTracker.isIdle()` skip) + `POST /refills/check` + on save + `triggerPendingRefillsForMedicine(medicineId)` on purchase.
- Due: `refill_notice_days=3 (+1 if due on weeklyOff/closedDates)` (`refillService.ts:52-57`). Per `patient_refills WHERE status=pending AND is_active=1`: if `SUM(quantity+loose)>0 OR stock_verified_override` -> `createQuickBillForRefill` (`held_bills H-REF-* AUTO_REFILL_BILL`, best expiry batch) -> `is_ready=1` + `syncStagedRefillNotificationForPatient`. Else if `ordering_triggered=0` -> dedupe `phone+LOWER(product) Pending/Ordered` -> `INSERT special_orders (source=refill, source_refill_id, priority High)` + `hold_for_stock=1` + fire-and-forget Pharmarack cart + Telegram weekly report.
- Arrival: `triggerPendingRefillsForMedicine` (exact medicineId -> `is_ready=1`) + `triggerPendingSpecialOrdersForMedicineName` (exact `LOWER(product)=LOWER(name)` -> `Ready,notified=0`) vs `reconcileIncomingInventory` fuzzy `scoreOrderNameMatch>=75` — duplicate paths.
- Staging: `syncStagedRefillNotificationForPatient` (`refillService.ts:210`) aggregates `is_ready=1` within 7d into ONE `automation_notifications (type=refill_collection, status=staged, reference_id=1,2,3)`. Zero ready -> delete staged. NEVER auto-sent (Strict Manual-Only `AGENTS.md`). Manual: `POST /refills/send-reminder-now` (`src/routes/refills.ts:1741`: all `is_active=1`, filter unsent, `buildRefillReminderMessage` with `{openTime,closeTime,weeklyOff,isOffDayUpcoming}`, `enqueue refill_reminder`, `UPDATE notified/QUEUED`, `forceNext`), `POST /:id/send`, `POST /send-grouped`, `POST /send-tomorrow-reminder`.
- Panel: `GET /refills/panel` (`refills.ts:538`) 2-pass (cheap `patient_refills x medicines x customers` + chunked <=500 `inventory_master ROW_NUMBER PARTITION BY medicine_id ORDER BY expiry`), groups `Record<phone,...>` earliest `next_refill_date`, per-med `quantity_needed??3`, `status=paused if is_active=0`.
- Pause: `POST /:id/toggle-pause` (`refills.ts:700`): pause -> `status=paused,paused_at`; resume -> `pauseMs=now-paused_at`, `target=old_next+pauseMs` (if past -> `now+interval`), 14-day closed loop (`isSun && !operatesSunday` / `pharmacy_holidays is_closed` -> +1d), `UPDATE is_active=1,status=pending,next_refill_date,pause_duration_seconds+=,refill_schedule_version++` + `checkAllRefills`.
- Qty: default `3` everywhere (`POST /` qty, `PUT /patient-medicines`, `PUT /:id`, `GET /panel`, `fulfill`). `buildRefillReminderMessage(items:{medicine_name,quantity_needed}[])` (`refills.ts:72`, en/hi/mr + CTA Reply REFILL/YES).
- UI: `frontend/src/pages/CRM/index.tsx:239 RefillsSection` (module `cachedRefillsData`, `MedicineRow quantity_needed:3`, `handleSaveRefill -> PUT /patient-medicines`, `handleSellRefillPatient -> /pos state.prefill {refillIds,medicines}`, `handleRemindNow -> POST /send-reminder-now`, `Delay Notice` modal -> `POST /crm/broadcast-delay-notices`).

### 2.3 Special orders + conversion
- `src/routes/orders.ts`: `POST /` single, `POST /batch`, `PUT /:id` (Ready -> `enqueueArrivalWhatsApp` `orders.ts:402`, 60m dedupe, `notified=1`, `notification_count++`, `forceNext`), `POST /:id/status`, `POST /:id/notify-arrival`, `POST /batch-notify-arrival`, `POST /:id/send-payment-qr` (allocate QR + image), `POST /:id/mark-advance-paid`.
- Convert: `POST /orders/convert-to-refill {orderId, refillIntervalDays}` (`orders.ts:1278`, dup `automation.ts:292`) -> `orderFulfillmentService.convertToRecurringRefill` (`orderFulfillmentService.ts:134`: resolve `medicine_id` via `LOWER(name)=LOWER(product)`, shell `INSERT medicines(name)` if missing, `INSERT patient_refills next=now+interval`, `UPDATE special_orders converted_to_refill_id`). Frontend `api.convertToRefill` (`frontend/src/services/api.ts:1450`) -> `CRM handleConvertToRefill` (`CRM:4267`). Manual click only.
- Website refill: `POST /website/customer/refill-order` (`src/routes/customerPortal.ts:948`) inserts `special_orders source=website` per item with `orderScheduleService.calculateOrderSchedule`, idempotency-Key, broadcasts `order_updated/refill_updated/website_order_created`. No `patient_refills` write.

### 2.4 Credit today
- Ledger: `customers.credit_balance/credit_due_date/credit_enabled` (`src/database.ts:2254`) + `sales_invoices (CREDIT/UNPAID/PENDING)`. List: `GET /crm/credit-customers` (`src/routes/crm.ts:550` CTE `unpaid_invoices GROUP BY customer_id`, `CASE credit_balance ELSE invoice_due`, `WHERE balance>0 OR unpaid>0 OR enabled=1`). Due date: `PUT /crm/credit-customers/:id/due-date`. Summary: `GET /sales/credit-dues` (`src/routes/sales.ts:2967` rows+balance+next_refill_due for print).
- Manual reminder: `POST /crm/credit-customers/:id/send-reminder` (`crm.ts:629`): guard `trigger_wa_credit_reminder_enabled`, `normalizeWhatsAppPhone`, `pendingInvoices SELECT invoice_no,total_amount`, `billsBreakdownStr`, `finalOutstanding=credit_balance ?? computedTotal`, `getMessage(lang,whatsapp.creditReminder)` (`src/i18n/messages.json:7` en/hi/mr), `generateCreditStatementPdf`, `enqueue(cleanPhone,msg,credit_reminder,name,undefined,pdfPath)`, `INSERT automation_notifications manual_credit_reminder`. No QR, no auto.
- Pay: `POST /crm/ledger/pay {customer_id,amount,sendWhatsApp}` (`crm.ts:741`): txn `credit_balance-=`, mark oldest `PAID`, optional `credit_payment_receipt` text. No QR.
- QR: `src/services/paymentQrService.ts` 3 configs (`payment_qr_1/2/3_*`, defaults `aipharmacy1/2/3@upi`), `allocateNextQr` (`!=last_selected_payment_qr`), `buildUpiUri(pa,pn,am,tr,tn)`, `generateQrBuffer` (300px). Used by special orders as `customer_payment_qr` image (`whatsappIntentService.ts:2041`).

### 2.5 Schedule / hours / holidays
- Config: `app_settings pharmacy_open_time/close_time/weekly_off/closed_dates + pharmacy_cutoff_time/delivery_window_start/end/sunday_orders_enabled/holiday_delivery/is_24_hours/pharmacy_timezone` + `pharmacy_holidays(store_id,holiday_date,is_closed,custom_window)` (`src/database.ts:310`).
- Engine: `src/services/orderScheduleService.ts:227 calculateOrderSchedule` (cutoff check, Sunday/holiday map, advance `while<14 +1d skip Sun/Holiday`, `scheduled_processing_at 08:00`, `estimatedDeliveryStart/End`, `scheduleStatus standard/post_cutoff/sunday_shift/holiday_shift`, `formatted_window Today/Tomorrow 7PM-9PM`), `persistOrderSchedule` + `overrideOrderSchedule`.
- Delay broadcast: `GET /crm/delay-notice-candidates` (`crm.ts:851`: Pending special orders + refills due <=+2d) + `POST /crm/broadcast-delay-notices` (`crm.ts:950`: interpolate `{patient_name}/{medicine_name}/{pharmacy_name}`, `enqueue delay_notice`, postpone `+postpone_days` both `special_orders estimated_delivery_*` and `patient_refills next_refill_date`).
- Morning brief: `sendMorningScheduleBriefingToAdmin` (`refillService.ts:392`, owner only, weeklyOff/holiday aware).

### 2.6 WhatsApp sleep
- Key `whatsapp_idle_sleep_min` default `'0'` (`src/database.ts:628`) = never sleep. Evaluator `WA_SLEEP_EVALUATOR_MS 60s` (`src/whatsappClient.ts:266`): `if idleMin<=0 return`; else if `idle>=min` and no init/sync/qr -> `destroyClient` + `broadcast sleeping`. Wake demand-only: `sendMessage/getChats` auto `initClient`, queue worker 60s silent restore, Connect button. `GET /messaging/qr` never wakes. `getIdleSleepMinutes()` reads DB live so Settings edit applies instantly.

---

## 3. ISSUES (P1–P9)

| # | Issue | Evidence | User pain |
|---|---|---|---|
| P1 | Refill cron vs WA reactive disconnected | `source_refill_id` one-way (`refillService.ts:111`); WA Confirm never touches refills | Duplicates, panel hold while WA order exists |
| P2 | Multi-refill qty lost on WA ACK | ACK bulk `patient_confirmed` all ids (`whatsappIntentService.ts:2280`); qty only in FSM `awaiting_qty` | Wrong qty in POS |
| P3 | Holiday/closed not uniform | `effectiveNotice+1` (`refillService.ts:57`) vs schedule advance loop (`orderScheduleService.ts:331`) vs website bypass | Missed refill on Sunday/festival/market-off |
| P4 | Credit QR auto missing | `crm.ts:629` manual, no scheduler/overdue scan | Owner clicks per debtor, no QR amount |
| P5 | Sleep perception | `idle_sleep` if user sets >0 -> 30s wake | Feels offline |
| P6 | Burst flush | `maybeSendGuidancePrompt` per msg, no 20m guard | N replies violate no-bulk rule |
| P7 | Scheduled sends fail silently | No `backgroundJobLane` routing, no 24h dedupe check | Lost reminders |
| P8 | Owner forward not per schedule | Escalate only on confirm (`waAdminEscalationService.ts:822`), not at `scheduled_processing_at 08:00` | Owner pinged at wrong time |
| P9 | Screenshot stall | `awaiting_payment` text `qr` keyword only (`whatsappIntentService.ts:822`), image while awaiting_payment not promoted | Payment stuck awaiting owner |

---

## 4. SOLUTION — ONE RECONCILER + ONE CALENDAR + ONE QUEUE

```
Calendar(pharmacy_holidays + weeklyOff + cutoff + is24Hours) = advanceToNextOpenDay()
   ^
Refill cron 09:00 + WA inbound + Website refill + Credit cron 09:30 + Delay broadcast
 |        |              |               |
 +-> reconciler(normalize last10 + customer_id) -> SINGLE special_orders (Pending/Confirmed/Ready)
     + single staged per phone (type=patient_ready) -> WhatsApp queue (10-15s pacing, deduped)
     + owner escalation at scheduled_processing_at 08:00 window
     + screenshot detector -> owner VERIFIED -> Live Cart
```

Rules kept: `Strict Manual-Only Patient Messaging` (all patient sends staged; the ONE allowed autonomous ack is the single ready-reply + refill ACK, same tier as today); `Strict Legitimate Data` (no B-*, no invented amounts — amount always `credit_balance ?? SUM(unpaid)` or QR `50` or panel qty); `Performance Guardrails` (mark-stale-only SSE, no ungated timers, `tsc --noEmit` clean).

---

## 5. STEP-BY-STEP BUILD (Do In Order — 10 Steps)

### Step 0 — Always-available default, setting controllable (no code delete)
- Keep `whatsapp_idle_sleep_min='0'` default (`src/database.ts:628`). Evaluator `if idleMin<=0 return` (`src/whatsappClient.ts:299`) already = never sleep.
- Keep Settings Integrations -> WhatsApp -> Idle Sleep Minutes writing `app_settings`. `getIdleSleepMinutes()` (`src/whatsappClient.ts:268`) reads live.
- Recommendation: ship `0`. If user sets 15/30 later, wake guaranteed (`sendMessage/getChats` auto-init + queue 60s restore -> `ensureWhatsAppReady(30s)` drains `pending/failed_offline` in order). No message lost (SQLite durable).
- Verify: set `0` -> `isReady` stays true 24h; set `15` -> sleeps after 15m idle, next `enqueue` wakes ~30s and drains.

### Step 1 — Single ready reply, no flush
- File: `src/services/whatsappIntentService.ts:292 maybeSendGuidancePrompt`.
- Add 20m per-phone guard BEFORE enqueue:
  `SELECT 1 FROM wa_pending_clarifications WHERE (phone LIKE %last10% OR phone LIKE %full%) AND created_at > datetime('now','-20 minutes') LIMIT 1 -> skip guidance.`
- Keep `extractMedicineCandidates(max 8)` first so `Dolo 650 aur Telma 40` = 1 card with `relatedMedicines` local-only (existing one-photo-one-result rule).
- Keep same-day `whatsapp_send_queue number+message` dedupe (`src/services/whatsappQueueWorker.ts:575`) as second line.
- Result: offline burst of 5 msgs -> FIRST gets `Namaste Welcome Option1 Photo / Option2 Name + getStoreHoursNotice()`; rest join same FSM, no new guidance. Admin gets ONE `wa_medicine_match`.

### Step 2 — Shared calendar util (extract, do not fork)
- New: `src/utils/pharmacyCalendar.ts` with `advanceToNextOpenDay(date, storeId)` + `isClosedDay(ymd, storeId)` + `effectiveNoticeDays(noticeDays, ymd)`.
- Move logic verbatim from `orderScheduleService.ts:331` (14-day Sun+holiday loop) and `refills.ts:755` and `refillService.ts:52`.
- Single source reads `pharmacy_holidays + weeklyOff + holidayDelivery + operatesSunday + is24Hours`.
- Refactor callers to import it (no behavior change yet): `orderScheduleService.calculateOrderSchedule`, `refills.ts toggle-pause resume`, `refillService.checkAllRefills`, `buildRefillReminderMessage isOffDayUpcoming`.

### Step 3 — Refill<->Order reconciler (canonical join)
- New: `src/services/refillOrderReconciler.ts` with `upsertForPhone({phone, customer_id, items:[{medicine_name, qty, unit}], source})`.
- Logic: `normalizeWhatsAppPhone` -> last10 -> resolve `customer_id` (reuse `lookupCustomer` cascade) -> for each item dedupe `SELECT special_orders WHERE phone LIKE %last10% AND LOWER(product)=LOWER(?) AND status IN (Pending,Ordered,Confirmed,Ready)` + 15m WA guard (`whatsappIntentService.ts:584` pattern) -> reuse `orderScheduleService.calculateOrderSchedule()` for `scheduled_processing_at/estimated_delivery_*` -> `INSERT` only if missing (set `source`, `source_refill_id` when from refill; `customer_order_source=whatsapp|website|refill_confirm`).
- Wire callers (small diffs, no rewrites):
  a) `refillService.checkAllRefills` OOS branch (`refillService.ts:100`) -> call reconciler instead of raw INSERT.
  b) `executeConfirmedProcurementFlow` (`whatsappIntentService.ts:576`) -> call reconciler after distributor resolve.
  c) `customerPortal.ts:948` website refill -> call reconciler.
  d) `isRefillConfirmationResponse` ACK (`whatsappIntentService.ts:2259`) -> after `patient_confirmed=1`, if `hasStock` call reconciler with qty from panel (`quantity_needed`) to create `source=whatsapp_refill_confirm` order.
- Idempotency: 15m product guard + 24h `automation_notifications` guard (Step 6).

### Step 4 — Multi-refill qty preserved end-to-end
- Keep default `3` (`refills.ts:164,345,643`, `CRM MedicineRow`, `fulfill`).
- Change ACK from bulk-all to per-medicine: after FSM `awaiting_qty_confirmation` (`whatsappIntentService.ts:1408`) store `quantity,unit` per `wa_pending_clarifications`; reconciler creates ONE order per medicine with its qty.
- `handleSellRefillPatient` (`CRM:638` filters `sellableMeds in_stock>0 || override`) already passes `quantity_needed` into `/pos state.prefill` — no change, just ensure reconciler qty flows there.
- `buildRefillReminderMessage(items)` (`refills.ts:72`) keeps `• Name (Qty:N)` en/hi/mr.

### Step 5 — Holiday / market-closed / paused never miss
- Due: `effectiveNoticeDays = noticeDays + (isClosedDay(dueYmd)?1:0)` via calendar util (replaces `refillService.ts:57` inline).
- Resume: `target=old_next+pauseMs` (if past -> `now+interval`) then `advanceToNextOpenDay` (replaces `refills.ts:755` inline loop).
- Paused-not-missed: when `is_active=0` but `next_refill_date` within 7d, reconciler still creates `special_orders source=refill Pending` with `notes=Paused at patient request, auto-shifted to <openDay>` so pharmacist sees it in Special Orders board instead of vanishing. `GET /panel` keeps `paused` chip (`refills.ts:651`).
- Broadcast: `POST /crm/broadcast-delay-notices` (`crm.ts:950`) postponement uses calendar util so `estimated_delivery_*` and `next_refill_date` land on next open day. Template keeps `{patient_name}/{medicine_name}/{pharmacy_name}/{qty}` interpolation.
- Bot surface: prepend `getStoreHoursNotice()` to refill ACK (`whatsappIntentService.ts:2301`) and `awaiting_payment` wait msg (`whatsappIntentService.ts:812`): `Your request forwarded ... + Closed today note`.

### Step 6 — Credit QR auto-reminder (amount-specific)
- New: `src/services/creditReminderService.ts` with `checkOverdueAndEnqueue()` + shared `buildCreditReminderWithQr(customerId)`.
- Overdue query: copy `crm.ts:555` CTE `unpaid_invoices` + `WHERE c.credit_due_date IS NOT NULL AND date(c.credit_due_date) <= date('now','localtime') AND (c.credit_balance>0 OR ui.unpaid_count>0)`. Chunk 500, indexed `idx_customers_credit`.
- Per customer: `finalAmount = credit_balance>0 ? credit_balance : SUM(unpaid)` (verbatim `crm.ts:683`); skip if `<1`. Dedupe `SELECT 1 FROM automation_notifications WHERE type=auto_credit_reminder AND recipient_phone LIKE %last10% AND created_at>datetime('now','-24 hours') -> skip`.
- QR: `allocateNextQr()` (`paymentQrService.ts:115`) -> `buildUpiUri(upi_id,payee_name,finalAmount,'CREDIT-'+customerId)` (`paymentQrService.ts:152`, `tr` string already accepted) -> `generateQrBuffer()` (`paymentQrService.ts:162`) -> `billsBreakdownStr` loop (`crm.ts:674` verbatim `Bill #INV (date): ₹amt`) + `dueDateStr` + `storeName/lang` -> `creditReminder` template (`messages.json:7` + QR hint line en/hi/mr) -> `enqueue(phone,msg,credit_reminder,name,undefined,pdfPath,file)` (same overload as `whatsappIntentService.ts:2041`) + `INSERT automation_notifications (type=auto_credit_reminder, status=queued, reference_id=customer_<id>)` + `triggerProcessing()`.
- Manual reuse: extract helper from `crm.ts:629` so `POST /crm/credit-customers/:id/send-reminder` calls same builder with `{skipDedupe:true}` (instant + QR).
- `paymentQrService.ts:152` already accepts `string` tr — no signature change, just pass `CREDIT-`.
- Cron: daily 09:30 IST via `backgroundJobLane runHeavyJob` (Step 7), gate `trigger_wa_credit_reminder_enabled!='false'` (`crm.ts:635`) + new opt-in `credit_auto_reminder_enabled` (default `false` = manual only, pilot opts in). `activityTracker.isIdle()>30m -> 15m skip`. Add `POST /crm/credit-customers/check-overdue` for manual test (mirrors `POST /refills/check`).

### Step 7 — Reliable scheduled sends (no failed schedule)
- Route ALL heavy crons through `src/utils/backgroundJobLane.ts runHeavyJob(name,fn)` (FIFO + per-name single-flight, never `await` inside a job): refill daily, credit 09:30, expiry scan, backup, catalog sync. Keep `tokenRefreshScheduler heartbeat` + `whatsappQueueWorker` OUT (latency-sensitive).
- Keep `whatsappQueueWorker` lazy 10–15s pacing (`loadPacingConfig`), `triggerProcessing()` on every `enqueue`, `forceNext()` ONLY for user-clicked instant (arrival, reminder-now, resend). Bulk (credit daily, delay broadcast) uses plain pacing, never `forceNext`.
- Dedupe layers: same-day `number+message` (`whatsappQueueWorker.ts:575`) + 48h `delivery_register` + 24h `wa_admin_escalations` (`waAdminEscalationService.ts:241`) + 24h `auto_credit_reminder` (Step 6). `cleanupOldSentItems` + 90d purge stay.
- Register crons in `src/server.ts` after `startStockCalculatorWorker()` alongside refill; expose manual triggers for test.

### Step 8 — Owner forward AS PER schedule date/time
- Persist schedule on every order: `orderScheduleService.persistOrderSchedule()` (`orderScheduleService.ts:422`) writes `scheduled_processing_at 08:00 + estimatedDeliveryStart/End + scheduleStatus/Reason`.
- Owner escalation at slot, not at creation: after reconciler creates order, schedule owner forward for `scheduled_processing_at` (08:00 of target open day). Reuse `notifyOwnerOfSpecialOrderPharmarackResults` (`waAdminEscalationService.ts:822`, ranked `rankSpecialOrderDistributorCandidates`) for in-stock options and `notifyAdminOfLiveCartAdd` (`waAdminEscalationService.ts:736`, success/manualReview/failed) for cart outcome. Same toggle/admin-number/self-send/24h-dedupe guards.
- Delay/morning: `sendMorningScheduleBriefingToAdmin` (`refillService.ts:392`) stays owner-only daily; delay broadcast postpones owner ETA via `order_tracking_events delay_notice_sent` (`crm.ts:1020`).
- SSE: `broadcast order_updated + refill_updated + customers_changed + website_order_created` so Quick Assist/CRM/POS refresh without polling (deferred-SSE `PageQueryTracker`, mark-stale-only).

### Step 9 — Payment screenshot in chat (short flow as asked)
- Detect: `hasMedia && step IN (awaiting_payment, awaiting_owner_payment_confirmation)` (`whatsappIntentService.ts:819`).
- Steps: `downloadMediaWithRetry()` (`whatsappIntentService.ts:45`) -> `saveInboundMedia(msgId,buffer)` (`data/inbound_media/<safeId>.jpg`) (`whatsappIntentService.ts:79`) -> gate `resolveOcrGateDecision()` (`whatsappIntentService.ts:95`) so random photos don't trigger -> if image while `awaiting_payment` (any image, or text `qr` keyword path `whatsappIntentService.ts:822` for resend): set `step=awaiting_owner_payment_confirmation`, forward to owner via `enqueue(admin, caption + Ref SO-xxx + customer + amount, admin_escalation_image, ..., imagePath)` with photo attached, tell customer `Your screenshot is being verified, final confirmation shortly` (`whatsappIntentService.ts:926` pattern).
- Complete: owner replies `CONFIRM SO-xxx` (`whatsappIntentService.ts:1776`) -> `UPDATE special_orders payment_status=VERIFIED status=Confirmed` + `INSERT online_order_items CONFIRMED` + `addItemsToPharmarackCart()` + staged `whatsapp_order` (`needs_confirmation=1`) + `notifyAdminOfLiveCartAdd(success)` + customer `customer_order_confirmed` receipt + owner ack. No auto-verify without owner (manual-only preserved).
- Cancel path: text `cancel/dusra/change` while `awaiting_payment` (`whatsappIntentService.ts:869`) -> `step=cancelled` + `special_orders Cancelled` + cancel msg. New medicine name while awaiting payment with catalog hit -> `superseded` and fall through to new inquiry (`whatsappIntentService.ts:898`).

---

## 6. FILES TO MODIFY (Only These) / NOT TO MODIFY

**MODIFY (existing responsibility + exact change):**
- `src/services/whatsappIntentService.ts:292,819,1776,2259,1154,1383,1408,1539,1646` — 20m guidance guard; screenshot promote; ACK reconciler call; FSM qty preserved.
- `src/services/refillService.ts:52,100,288,324,210,392` — calendar util; reconciler OOS; unified arrival (replace exact with fuzzy `reconcileIncomingInventory` threshold 75); unified staging hook.
- `src/routes/refills.ts:538,700,1741,1362,1486,1622,1031,1111` — panel enriched with `source_refill_id`; pause resume via calendar; send-reminder-now unchanged contract + grouped reuse.
- `src/routes/orders.ts:402,513,1278` + `src/routes/automation.ts:292` — arrival helper shared; convert broadcasts both routes.
- `src/routes/crm.ts:550,629,741,851,950` — extract `buildCreditReminderWithQr` helper; manual + auto share; delay candidates/postpone via calendar.
- `src/services/paymentQrService.ts:152` — pass `CREDIT-<id>` tr (no signature change needed, verify).
- `src/services/orderFulfillmentService.ts:134,107` — convert + reconcile via reconciler + calendar.
- `src/services/orderScheduleService.ts:227,422` — delegate advance loop to calendar util.
- `src/utils/pharmacyCalendar.ts` (NEW) + `src/services/refillOrderReconciler.ts` (NEW) + `src/services/creditReminderService.ts` (NEW).
- `src/server.ts` — register credit 09:30 cron via `runHeavyJob` + manual `POST /crm/credit-customers/check-overdue`.
- `src/i18n/messages.json:7` — add QR hint line to `creditReminder` en/hi/mr.
- `frontend/src/pages/CRM/index.tsx:239 + credit tab` — `QR` chip + `Run Overdue Check` button (mirror `Run Check`); keep `bg-bg/text-text/border-border` semantic tokens, no raw colors.
- `src/database.ts` — optional `idx_customers_credit_due (credit_due_date)` if scan slow; `converted_to_refill_id/source_refill_id` already gated.

**INSPECT BUT DO NOT MODIFY (unless regression proven):**
- `src/services/whatsappQueueWorker.ts` (pacing/dedupe/recovery already correct), `src/whatsappClient.ts` (sleep evaluator + `waitForWhatsAppReady` already correct), `src/services/waAdminEscalationService.ts` (guards/dedupe already correct), `src/routes/sales.ts:2967` (credit-dues read-only), `src/routes/customerPortal.ts:948` except reconciler call.

**NEVER TOUCH:** unrelated pages, styling, `validation.ts` (deleted), second order/refill/inventory/POS/history tables, `alert()/confirm()` (use toasts/modals), hardcoded colors, sync `fs.copyFileSync` profile copies.

---

## 7. OLD vs NEW (Per Workflow)

| Flow | OLD | NEW |
|---|---|---|
| Refill due on open day | staged `refill_collection` | same + calendar `isOffDayUpcoming` line (unchanged API) |
| Refill due on closed (Sun/holiday) | `+1 notice` only in refill, schedule engine separate | BOTH use `advanceToNextOpenDay`; due preponed, ETA = next open 08:00 window |
| Paused refill | vanishes (`is_active=0` filtered) | visible as `Paused` chip + Pending `special_orders` note with shifted date |
| WA burst 5 msgs | up to 5 guidances | 1 guidance (20m guard) + 1 consolidated `wa_medicine_match` |
| WA ad-hoc confirm | `special_orders Confirmed whatsapp` staged, no refill link | same + reconciler upserts refill link + `converted_to_refill_id` ready for one-click chronic |
| Website refill | direct `special_orders website` | same + reconciler (no new table) |
| Credit reminder | manual click, text+PDF, no QR | manual (same + QR) + daily 09:30 auto with amount QR + 24h dedupe |
| Owner forward | on confirm only | on confirm AND at `scheduled_processing_at 08:00` slot with distributor options + cart outcome |
| Screenshot | text `QR` resend only | image while `awaiting_payment` -> owner verify flow -> `CONFIRM` completes Live Cart |

API contracts stay compatible (`GET /refills/panel`, `POST /send-reminder-now`, `POST /orders`, `PUT /orders/:id`, `POST /crm/credit-customers/:id/send-reminder`, `POST /crm/broadcast-delay-notices`, `GET /sales/credit-dues`). DB relations intact (no table merge).

---

## 8. END-TO-END TESTS (Must All Pass)

- **T-A Refill on time:** `Add Refill Telma 40 qty2 interval30` -> `Run Check` (in-stock) -> `held_bills` + staged `refill_collection` with `Qty:2` -> `Remind Now` -> queue `sent` -> `Sell -> POS` -> `Fulfill` -> `next_due = now+30` on open day.
- **T-B WA ad-hoc:** `Dolo 650 aur Telma 40` (2 msgs burst) -> 1 guidance + 1 card (2 candidates) -> pick `1` -> `YES` -> qty `2` -> `YES` -> name -> `special_orders Pending 50 UNPAID` + owner options -> owner `SO-xxx 2` -> customer QR image -> screenshot -> owner `CONFIRM` -> `VERIFIED/Confirmed` + Live Cart + receipt -> `Mark Ready` -> `whatsapp_queued true` once (60m idempotent).
- **T-C Holiday:** set `weeklyOff=Sunday` + `pharmacy_holidays <next Sunday> is_closed=1` -> refill due Sunday -> `effectiveNotice+1`, `estimatedDeliveryStart=Monday 19:00`, reminder has `closed on Sunday` line, resume `paused` lands Monday.
- **T-D Credit QR:** set `credit_due_date=yesterday, balance=1250` (or 2 unpaid `500+750`) -> `POST /check-overdue` -> ONE `credit_reminder` with `Total ₹1250.00` + QR `am=1250.00&tr=CREDIT-<id>` scannable -> second run same day skipped -> manual `Send Reminder` with QR works (`skipDedupe`).
- **T-E No-flush:** send 5 WA msgs in 2m offline -> on wake 1 ready reply, queue shows 1 `customer_medicine_clarification`, no bulk.
- **T-F Sleep:** `idle_sleep=0` -> 24h `isReady`; set `15` -> sleeps, next `enqueue` wakes ~30s and drains in order, no dup (delivery_register).
- **T-G Race:** stock `1`, two orders qty `1` -> existing reservation prevents `-1` (no new counter).

---

## 8A. AUTOMATION HOOKS (Triggers — So Agent + App Never Fail)

> Purpose: every automation in §5 is fired by an explicit HOOK, not by scattered ad-hoc calls.
> If a hook is missing, the feature silently never runs (the #1 cause of "schedule failed").
> Each hook below is idempotent + deduped + logged + SSE-broadcast, so re-fires are safe and agents can verify them one by one.

### Hook contract (applies to ALL H1–H10)
- Single-flight: same hook for same key never runs concurrently (`backgroundJobLane runHeavyJob(name,fn)` for cron/heavy; `initPromise`/mutex for WA init; per-phone 20m guard for guidance).
- Dedupe key logged before work: `phone-last10 + product-lower | customer_id | orderId | CREDIT-id + date`.
- Failure fallback: on throw -> `console.warn` + `automation_notifications` failure row (never crash boot); queue rows stay `pending/failed_offline` for retry, never silently dropped.
- SSE after success: `order_updated` / `refill_updated` / `customers_changed` / `wa_medicine_match` / `pharmarack_cart_changed` (mark-stale-only, never eager refetch storms).
- Phone rule: hooks store/compare digits-only (`normalizeWhatsAppPhone`, last10); never persist `@c.us/@lid`.
- Guardrails: hooks use existing `whatsappQueueWorker.enqueue` (10–15s pacing) + `triggerProcessing()`; bulk hooks NEVER use `forceNext()`; no `alert()/confirm()`; no dummy amounts.

### H1 — Inbound message hook (always-on entry)
- **Fires when:** `whatsappClient.ts message_create` -> persist `whatsapp_messages` -> `handleInbound()`.
- **Calls:** `isIgnored` -> LID resolve -> owner check -> distributor check -> promo filter -> sign-off -> manual-session check -> `startupSyncCoordinator.waitForCartSync()` -> `lookupCustomer` -> ACK (H2) / FSM (H2) / search (H3).
- **Dedupe:** `msgId ON CONFLICT DO NOTHING`; burst guard §5-Step 1 (20m `wa_pending_clarifications`).
- **Fail-safe:** any throw -> log + return (message stays in `whatsapp_messages` for manual review); never block next message.
- **Verify:** send 1 WA text -> row in `whatsapp_messages` + `wa_medicine_match` or guidance; send 5 in 2m -> exactly 1 guidance (§8 T-E).

### H2 — Refill-ACK + FSM hook (conversational)
- **Fires when:** `isRefillConfirmationResponse(body)` true OR active `wa_pending_clarifications` row for phone.
- **Calls:** ACK path (`UPDATE patient_confirmed=1` + `broadcast refill_updated` + hours-aware ack) THEN reconciler (Step 3d) if in-stock; FSM steps `awaiting_*` per §2.1 (selection -> qty -> name -> `proceedWithConfirmedProcurement`).
- **Dedupe:** ACK bulk-update is idempotent (re-ACK same flag, no new order without reconciler guard); FSM `created_at > now-45m` window, `awaiting_owner_*` 72h window.
- **Fail-safe:** unknown step -> fall through to search (never stuck); `isNegative` -> `DELETE` clarification + polite restart msg.
- **Verify:** `REFILL` from chronic phone -> `patient_confirmed=1` chip in CRM; `YES` at `awaiting_qty_confirmation` -> `special_orders Pending` + owner options.

### H3 — Procurement-confirmed hook (order creation)
- **Fires when:** FSM reaches confirmed (single or bundle `items_json`).
- **Calls:** `refillOrderReconciler.upsertForPhone` (Step 3) -> `searchCatalog` + `resolveCommonOrFrequentDistributor` -> `isAutoAddToLiveCartEnabled ? addItemsToPharmarackCart` (HARD GATE: fail -> `notifyAdminOfLiveCartAdd(success:false)` + return, no DB write) -> `calculateOrderSchedule` -> `INSERT special_orders` + staged `whatsapp_order` + `notifyAdminOfLiveCartAdd` + `broadcast order_updated`.
- **Dedupe:** 15m `special_orders phone+product` guard + `source_refill_id`/`customer_order_source` check.
- **Fail-safe:** cart fail / no token -> order still created as `Pending` manual-review path (never lost); owner always notified.
- **Verify:** confirm `Dolo 650 x2` -> ONE `special_orders Confirmed/Pending` + ONE staged msg + ONE owner escalation.

### H4 — Refill-due hook (chronic cron)
- **Fires when:** daily cron `trigger_refills_check_time` (default 09:00) via `runHeavyJob('daily_check')` + boot catch-up + `POST /refills/check` + after `POST/PUT /refills`.
- **Calls:** `checkAllRefills` -> per due row (`diffDays<=effectiveNoticeDays` via calendar util): in-stock -> `createQuickBillForRefill` + `is_ready=1` + staged `refill_collection`; OOS -> reconciler `source=refill` Pending + `hold_for_stock=1` + Pharmarack cart try + Telegram batch.
- **Dedupe:** `ordering_triggered` flag + `phone+LOWER(product) Pending/Ordered` check.
- **Fail-safe:** `activityTracker.isIdle()>30m` -> skip tick (15m retry); `automation_enabled/trigger_refills_enabled=false` -> skip with log.
- **Verify:** T-A + T-C (§8).

### H5 — Purchase-arrival hook (stock trigger)
- **Fires when:** purchase save/verify (`applyPurchaseDelta` path) completes for `medicineId`.
- **Calls:** `triggerPendingRefillsForMedicine(medicineId)` (fuzzy-capable after Step 5: use `reconcileIncomingInventory` threshold 75 for BOTH tables) -> `is_ready=1` + quick bills -> `triggerPendingSpecialOrders*` -> `Ready,notified=0` -> unified staging ONE msg per affected phone.
- **Dedupe:** per-order `order_overlaps` one-reconcile guard (existing `autoMatchWorker` rule); affected-phones `Set` dedupe.
- **Fail-safe:** qty still 0 -> no-op; name mismatch (base vs Plus/DS) rejected by extra-token cap, never force-matched.
- **Verify:** save purchase for `Telma 40` -> refill `is_ready` + special order `Ready` + ONE staged arrival (not two).

### H6 — Credit-overdue hook (money cron)
- **Fires when:** daily 09:30 cron via `runHeavyJob('credit_overdue')` + `POST /crm/credit-customers/check-overdue` manual.
- **Calls:** `creditReminderService.checkOverdueAndEnqueue` (Step 6): overdue CTE query -> `finalAmount` -> 24h `auto_credit_reminder` dedupe -> `allocateNextQr` -> `buildUpiUri(...,CREDIT-id)` -> `generateQrBuffer` -> `enqueue credit_reminder + PDF` -> `INSERT automation_notifications`.
- **Dedupe:** 24h per-phone `automation_notifications` + same-day queue dedupe.
- **Fail-safe:** `trigger_wa_credit_reminder_enabled=false` OR `credit_auto_reminder_enabled=false` -> skip with 409 log; amount `<1` -> skip; invalid phone -> `skipped_invalid_phone` + toast (never crash).
- **Verify:** T-D (§8).

### H7 — Schedule / owner-forward hook (per date-time)
- **Fires when:** order created (H3/H4/website) + at `scheduled_processing_at 08:00` slot of target open day (calendar util).
- **Calls:** `persistOrderSchedule` -> at slot `notifyOwnerOfSpecialOrderPharmarackResults` (ranked options) + `notifyAdminOfLiveCartAdd` (cart outcome) + `sendMorningScheduleBriefingToAdmin` (daily owner digest).
- **Dedupe:** 24h `wa_admin_escalations medicine_key+phone`; `notified`/`notification_count` idempotency; 60m arrival-queue guard.
- **Fail-safe:** no admin number -> log + skip (never throw); `holidayDelivery=false` + closed today -> message carries `holidayShift` reason + next-open window.
- **Verify:** order due Sunday-closed -> owner ping Monday 08:00 window with `sunday_shift/holiday_shift` reason.

### H8 — Screenshot hook (payment proof)
- **Fires when:** `hasMedia` while `wa_pending_clarifications.step IN (awaiting_payment, awaiting_owner_payment_confirmation)` OR image + `awaiting_payment` text context.
- **Calls:** `downloadMediaWithRetry` -> `saveInboundMedia` -> `resolveOcrGateDecision` -> promote `step=awaiting_owner_payment_confirmation` -> forward image to owner `enqueue(admin,...,admin_escalation_image,...,imagePath)` -> customer `verifying shortly` msg -> await owner `CONFIRM SO-xxx` (§5-Step 9: `VERIFIED/Confirmed` + `online_order_items` + cart + staged receipt + `notifyAdminOfLiveCartAdd`).
- **Dedupe:** one promotion per `special_order_id` (re-sends while `awaiting_owner_payment_confirmation` get wait msg, no duplicate owner forwards).
- **Fail-safe:** download fail after retries -> `notifyAdminOfUnprocessedMedia` text alert (photo never silently lost); unreadable -> owner gets photo for human look.
- **Verify:** send QR screenshot in `awaiting_payment` -> owner receives image + `SO-xxx` caption; `CONFIRM` completes cart.

### H9 — Queue sent/delivered hook (truthful dispatch)
- **Fires when:** `whatsappQueueWorker.processQueueInternal` picks `pending/failed_offline` due item.
- **Calls:** registration gate (`checkPhoneWhatsAppRegistered`) -> `sendMessage` -> outbox verify -> `status=sent` + `delivery_register.recordDelivery` + linked `automation_notifications`/`patient_refills.reminder_status=SENT`/`distributor_dispatch_reminders=Dispatched` updates + SSE.
- **Dedupe:** pre-send `delivery_register.isAlreadyDelivered` (48h, 12h for daily reminders); post-error outbox re-check before marking failed.
- **Fail-safe:** offline -> leave `pending` (no Chrome launch from worker beyond 60s-cooldown silent restore); invalid/not-on-WA -> `skipped_*` + warning toast (never bulk-blast).
- **Verify:** queue UI `Pending -> Sending -> Sent` with pacing 10–15s; user-clicked paths show instant via `forceNext()`.

### H10 — Boot / crash-recovery hook (never lose schedule)
- **Fires when:** `server.ts` boot (Phase 1/2 DB ready -> scheduler `start()`; Phase-4 staggered warm-ups) + `cleanupOldSentItems()` + `warmupStartupCart`.
- **Calls:** `PRAGMA integrity_check` -> `cleanupOldSentItems` (`sending` -> verify outbox -> `sent` or `review_required`; `>24h pending` -> `skipped_offline`; distributor reminders due during outage -> restore `pending`) -> `initProcessHeartbeat` + outage inference -> re-arm crons via `runHeavyJob` + catalog-sync only if token set + `warmupStartupCart` resolves `startupSyncCoordinator`.
- **Dedupe:** `SERVER_BOOT_TIME` cut-off for pre-boot pending; `whatsapp_worker_heartbeat_last_seen` outage window.
- **Fail-safe:** `DB_INTEGRITY_FAILURE` -> surface to user, never auto-restore; init watchdog 60s rejects hanging WA init (never stuck `initializing`).
- **Verify:** kill app mid-send -> reboot -> item is `sent` (if outbox proves) or `review_required`, never duplicated; pending refill/credit crons re-fire on next slot.

### Hook wiring checklist (agent must confirm each row implemented + tested)
- [ ] H1 entry wired in `whatsappClient.ts message_create` (no second listener).
- [ ] H2 ACK+FSM in `whatsappIntentService.ts` (20m guard + qty path).
- [ ] H3 procurement via reconciler (hard-gate cart log present).
- [ ] H4 refill cron via `runHeavyJob` + manual `POST /check`.
- [ ] H5 purchase-save calls arrival reconciler (fuzzy, not exact-only).
- [ ] H6 credit 09:30 cron + manual `check-overdue`, QR `tr=CREDIT-*` scannable.
- [ ] H7 owner forward uses `scheduled_processing_at`, carries shift reason.
- [ ] H8 screenshot promotes + forwards image + `CONFIRM` completes.
- [ ] H9 queue pacing/dedupe/outbox-verify intact.
- [ ] H10 boot recovery + heartbeat + warm-up intact.
- [ ] `npm run guardrails` 0 + `tsc --noEmit` clean + `node scripts/quick-update.mjs` run.

---

## 9. AGENT CROSS-CHECK (Mandatory — 100% Step-by-Step)

Every agent (human or AI) implementing ANY step above MUST complete this checklist and paste results in the PR/session log. No step is done until ALL boxes tick.

### 9.1 Before Editing (read chain per DOX)
- [ ] Read root `AGENTS.md` + `src/AGENTS.md` + `frontend/AGENTS.md` for touched subtree.
- [ ] Read `.agents/rules/bug-fix.md` if defect, `BACKEND SCHEMA SAFETY.md` §24 if DB-backed.
- [ ] Read `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` §12 (`/orders`) + §14 (`/refills`) for ownership.
- [ ] Read `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` P1–P4 (events-not-timers, cache-first, gated workers, credentials sacred).
- [ ] List: `FILES TO MODIFY` (from §6 only) vs `FILES NOT TO MODIFY`. If unrelated file touched -> REVERT.

### 9.2 Per-File Check (repeat for EVERY modified file)
- [ ] Why modified? Which existing function? Which workflow (§2)?
- [ ] Old behaviour? New behaviour? API contract compatible? DB relation intact?
- [ ] No dummy data (`B-*`, `BATCH123`, `mrp*0.7`, invented fallback) introduced? `grep` clean.
- [ ] No `alert()/confirm()`, no raw `bg-black/text-white`, no ungated `setInterval/refetchInterval`, single SSE, semantic Tailwind only?
- [ ] Phone normalized digits-only (`normalizeWhatsAppPhone`/last10)? No `@c.us/@lid` stored in `special_orders.phone`?
- [ ] Manual-only preserved? No worker auto-sends to patient except the ONE ready-reply/ACK tier?
- [ ] `tsc --noEmit` clean? `npm run guardrails` exit `0` (changed-lines scan)? If `1` -> fix before done.

### 9.3 After Editing (verify + record)
- [ ] Run `T-A..T-G` (§8) that cover your step; paste pass/fail + queue IDs + order IDs.
- [ ] `git status/diff/log --oneline -10` reviewed; stage only intended files; no secrets.
- [ ] Update nearest owning `AGENTS.md` ONLY if purpose/scope/contracts changed (small doc/style fix = no update).
- [ ] Run `node scripts/quick-update.mjs` (<30s) to refresh `.understand-anything/knowledge-graph.json` + `PROJECT_AUDIT.md`.
- [ ] If bug fixed: move Open->Fixed in `SMALL_BUG_FIX_PLAN.md`.
- [ ] If DB touched: attach `BACKEND SCHEMA SAFETY.md` §24 Final Mandatory Report (Feature->Code->Schema->Migration->Indexes->Seeds->Init->Runtime->Tests as one atomic unit, both DDL + fast-boot path).

### 9.4 Final Acceptance (all must be [x])
- [ ] Existing workflow reused; no second order/refill/inventory/POS/history.
- [ ] Refill creates NEW order; old order unchanged; refill uses CURRENT stock/price/batch.
- [ ] Website + WA + refill reach SAME pharmacy Live Cart/POS/history with `store_id` isolation.
- [ ] Credit QR amount = `credit_balance ?? SUM(unpaid)`, QR `tr=CREDIT-<id>`, 24h max 1/day.
- [ ] Owner forwarded per `scheduled_processing_at` window; screenshot `CONFIRM` completes cart.
- [ ] Sleep default `0` controllable in Settings; burst = 1 reply, no flush.
- [ ] Hooks H1–H10 all wired + checklist (§8A) ticked; no automation runs without its hook.
- [ ] UI unchanged (same screens/buttons/nav); only logic wired.
- [ ] Tests T-A..T-G pass; guardrails pass; graph updated.

> FINAL RULE: FIND EXISTING IMPLEMENTATION FIRST, THEN EXTEND IN-PLACE. ONE WORKFLOW. ONE ORDER SYSTEM. ONE INVENTORY. ONE POS. ONE HISTORY. ONE REFILL PATH. NO DUPLICATES.

---

## 10. SHORT REPLY SUMMARY (For Chat)

- Refill cron stages, WA bot reacts, reconciler merges into ONE `special_orders` + ONE staged msg per phone.
- Multi-qty kept from panel/FSM; holiday/pause auto-shift to next open 08:00 window; market-closed uses delay broadcast.
- Credit due + balance -> daily 09:30 QR auto (24h dedupe) + manual with QR; owner forwarded per schedule; screenshot -> owner CONFIRM -> Live Cart.
- Sleep `0` = always; setting editable; burst = single ready reply.

*End of single plan. Implement §5 Steps 0–9 in order. Cross-check §9 every step.*
