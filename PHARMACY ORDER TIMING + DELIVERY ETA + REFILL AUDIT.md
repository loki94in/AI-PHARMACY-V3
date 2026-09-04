# PHARMACY V3 — IN-PLACE ORDER TIMING, DELIVERY ETA, RETURNS & REFILL AUDIT

## 1. PURPOSE

Implement pharmacy order timing, delivery ETA, holiday/Sunday handling, pause/resume, automatic next-delivery calculation, refill-date adjustment, and return-window behavior **inside the existing application workflow**.

### HARD PRODUCT RULE

**DO NOT CREATE NEW APPLICATION PAGES FOR THIS FEATURE.**

The feature must automatically work through the existing:

- Customer cart / pharmacy cart page
- Existing website order page
- Existing customer order detail page
- Existing pharmacy Live Orders / Live Cart workflow
- Existing customer refill/history workflow
- Existing Settings page
- Existing POS / fulfilment workflow
- Existing notification/in-app status system

Use existing pages and components. Add fields, cards, timeline states, buttons, badges, or sections only where they naturally belong in the current page.

This is an **in-place capability**, not a new navigation module.

---

## 2. EXISTING ARCHITECTURE TO REUSE

The repository already defines a centralized product/catalog architecture and connected order → payment → pharmacy live cart → POS → customer history → refill flow.

Therefore this feature MUST reuse:

```text
CENTRAL CATALOG
      ↓
INVENTORY
      ↓
CART
      ↓
ORDER
      ↓
PHARMACY LIVE CART
      ↓
POS / FULFILMENT
      ↓
CUSTOMER HISTORY
      ↓
REFILL
```

Do not create:

- a second order table
- a second cart system
- a second refill system
- a separate delivery-order entity solely for ETA calculation
- a separate pharmacy timing database
- a second settings system
- a page-specific clock implementation

The existing application documents require stable product IDs, shared order services, current pricing/availability for refills, and configuration-driven behavior. This feature must follow those rules.

---

## 3. BUSINESS PARAMETERS

### 3.1 Product/customer expectations

Customer-facing order timing should communicate:

- order cutoff time
- expected processing window
- expected delivery date/time window
- whether the order is same-day or next-day
- pharmacy holiday / Sunday adjustment
- order confirmation status
- preparation / ready status
- next refill date where applicable
- return eligibility where applicable

### 3.2 Current example values

These are **configuration examples**, not hardcoded universal values:

```text
Normal pharmacy availability: 10–18 hours operational coverage
Maximum stated availability: up to 24 hours
Daily order cutoff: 11:00 PM
Example delivery window: 07:00 onward / pharmacy-configured window
Return window: 15 calendar days
Return after day 15: closed / not normally eligible
```

The actual values must be read from pharmacy settings.

Never hardcode `11 PM`, `7 AM`, `24 hours`, `15 days`, Sunday, or holiday behavior inside a UI component.

---

## 4. PHARMACY SETTINGS

Extend the EXISTING SETTINGS PAGE. Do not create a new settings page.

Add an existing-settings section such as:

```text
Orders & Fulfilment Timing

Order cutoff time:              [11:00 PM]
Same-day order enabled:         [ON]
Delivery start time:            [07:00 AM]
Delivery end time:              [configured]
Pharmacy operates Sunday:       [YES/NO]
Sunday delivery:               [YES/NO]
Holiday delivery:              [YES/NO]
Holiday handling:              [Next available day / Custom]
24-hour operation:             [YES/NO]
Timezone:                      [pharmacy timezone]
Return window:                 [15] days
Return window mode:             [Calendar days]

Refill

Refill interval source:         [Prescription / Product / Existing rule]
Pause affects refill date:      [YES]
Resume recalculates refill:     [YES]
```

### Multi-pharmacy requirement

All timing is pharmacy-specific.

```text
pharmacy_id
    ↓
operating_hours
order_cutoff
holiday_calendar
sunday_rule
delivery_window
return_policy
refill_policy
timezone
```

Two pharmacies can have different cutoffs and delivery windows without frontend code changes.

---

## 5. SINGLE ORDER SCHEDULING ENGINE

Create/reuse ONE backend service responsible for all order-time calculations.

Suggested responsibility:

```text
OrderScheduleService
```

or extend the existing order service if a suitable service already exists.

Do not create multiple calculations for:

- Website
- Customer portal
- Pharmacy cart
- Refill page
- POS

All must call the same scheduling logic.

### Inputs

```text
pharmacy_id
order_created_at
order_cutoff
operating_hours
sunday_rule
holiday_calendar
same_day_enabled
delivery_window
order_type
customer_timezone/display_timezone
```

### Outputs

```text
is_same_day
scheduled_processing_date
estimated_delivery_start
estimated_delivery_end
next_operating_day
cutoff_passed
is_holiday
is_sunday
schedule_reason
```

---

## 6. CUT-OFF RULE

Default example:

```text
CUTOFF = 11:00 PM local pharmacy time
```

### Before cutoff

If an eligible order is placed at or before the configured cutoff and same-day service is enabled:

```text
Order placed
     ↓
Cutoff NOT passed
     ↓
Check operating day
     ↓
Check holiday/Sunday
     ↓
Eligible for same-day processing
```

### After cutoff

```text
Order placed
     ↓
Cutoff passed
     ↓
Find next operating day
     ↓
Schedule next operating cycle
```

The UI must display the calculated result automatically.

Do not ask pharmacy staff to manually move the order to tomorrow.

---

## 7. SUNDAY AND HOLIDAY RULE

The engine must evaluate the pharmacy calendar.

### Example

If today is Sunday and the pharmacy is closed:

```text
Order placed Sunday
     ↓
Sunday closed
     ↓
Find next valid operating day
     ↓
Use that day's processing/delivery window
```

If today is a configured holiday:

```text
Order placed on holiday
     ↓
Holiday closed
     ↓
Find next non-holiday operating day
     ↓
Use configured delivery window
```

### Customer notification

When a customer places an order that is shifted because of Sunday/holiday:

Show an immediate in-app message on the existing order/cart UI, for example:

```text
Pharmacy is closed today.
Your order is scheduled for the next available operating day.
Estimated delivery: [date + time window]
```

Use the existing notification service. Do not build a new notification framework.

---

## 8. EXACT ETA DISPLAY

The customer should not see a fake second-by-second promise unless the system truly has that operational precision.

Use an estimated delivery window:

```text
Estimated delivery
Saturday, 12 Sep
7:00 PM – 9:00 PM
```

or, where configured:

```text
Estimated delivery
Tomorrow, 7:00 PM – 9:00 PM
```

The time window must be generated by the scheduling engine.

### Required UI on EXISTING order page

Add a compact timing card/timeline:

```text
ORDER TIMELINE

✓ Order placed
      |
✓ Pharmacy confirmation
      |
○ Preparing
      |
○ Ready / Out for delivery
      |
○ Delivered

Estimated delivery
12 Sep · 7:00–9:00 PM

Order cutoff
Today · 11:00 PM
```

Do not create a dedicated tracking page solely for this.

---

## 9. AUTO-START / AUTO-CLOCK BEHAVIOR

The order countdown/timing state must derive from server timestamps, not from a browser-only timer.

Store:

```text
order_created_at
schedule_calculated_at
scheduled_processing_at
estimated_delivery_start
estimated_delivery_end
cutoff_at
pharmacy_timezone
```

Frontend renders a countdown or timeline from these timestamps.

### Important

The countdown must survive:

- browser refresh
- app restart
- phone restart
- reconnect
- page navigation

Do not use only `setTimeout()` or local component state.

---

## 10. NO MANUAL TIME-TABLE EDITING

Pharmacy staff should NOT have to manually change an order's delivery date merely because the customer ordered before/after cutoff.

The rule must be:

```text
Order time
     +
Pharmacy settings
     +
Holiday/Sunday calendar
     ↓
Automatic schedule
```

The existing order page may expose an override/edit control for authorized staff where the existing workflow already supports edits, but the normal path must be fully automatic.

---

## 11. WEBSITE ORDER CONFIRMATION

When a website customer submits the order:

```text
Customer clicks Confirm Order
        ↓
Create order
        ↓
Calculate schedule
        ↓
Persist schedule
        ↓
Return order confirmation
```

The response must contain the schedule summary.

Example:

```text
{
  "orderId": "ORD-10025",
  "status": "PLACED",
  "timing": {
    "sameDay": true,
    "scheduledProcessingAt": "...",
    "estimatedDeliveryStart": "...",
    "estimatedDeliveryEnd": "...",
    "cutoffAt": "...",
    "timezone": "..."
  }
}
```

Customer must immediately see:

```text
Order confirmed
Estimated delivery: [calculated date/time]
```

---

## 12. PHARMACY ORDER PAGE / LIVE CART

Use the EXISTING website order/live order page.

For each order display:

```text
Order ID
Customer
Pharmacy
Order placed time
Cutoff status
Scheduled processing time
Estimated delivery
Payment status
Order status
```

Existing actions remain on the same page, including where currently supported:

```text
Confirm
Mark Ready
Cancel
Edit
Pause
Delete
```

Do not create a second order-management page.

### Status relationship

Keep payment status separate from order status.

Example:

```text
PAYMENT = CONFIRMED
ORDER = PLACED
SCHEDULE = CALCULATED
PHARMACY = PENDING_CONFIRMATION
```

This follows the existing architecture where payment confirmation does not by itself prove pharmacy product confirmation.

---

## 13. PHARMACY CONFIRMATION / MARK READY

Customer order confirmation and pharmacy fulfilment are separate events.

### Customer side

```text
Customer places order
↓
Order created
↓
Schedule calculated
↓
Customer gets ETA
```

### Pharmacy side

```text
Order appears in existing Live Orders
↓
Pharmacy checks stock/product
↓
Pharmacy confirms
↓
Preparing
↓
Mark Ready
↓
Out for Delivery / Pickup
```

Use existing order status machinery.

Do not create a new fulfilment state model unless the existing one is demonstrably insufficient.

---

## 14. PAUSE / RESUME ORDER

Use the existing Pause/Resume control on the existing relevant order/cart page.

### Pause

When the customer pauses an eligible recurring/refill order:

```text
ACTIVE
  ↓
PAUSED
```

Persist:

```text
paused_at
pause_reason (optional)
resume_at (optional)
previous_schedule_snapshot (optional)
```

### Resume

When the customer resumes:

```text
PAUSED
  ↓
RESUMED
  ↓
RECALCULATE SCHEDULE
  ↓
UPDATE NEXT DELIVERY / REFILL DATE
```

Do not blindly restore the old date because the pharmacy calendar, cutoff, holiday, stock, or timing may have changed.

---

## 15. PAUSE EFFECT ON REFILL DATE

This is a critical rule.

If a recurring medication/refill plan originally has:

```text
Next refill = 20 Sep
```

and the customer pauses for 5 days, the refill schedule should be recalculated according to the existing refill business rule.

Default behavior for this requirement:

```text
New refill eligibility date = original planned date + effective paused duration
```

subject to:

- current product availability
- current price
- current pharmacy settings
- non-working days
- prescription eligibility where applicable

Do not mutate historical orders.

Only future refill scheduling changes.

---

## 16. RESUME EFFECT

When resumed:

```text
Resume order
     ↓
Read current pharmacy settings
     ↓
Read current calendar
     ↓
Read current refill policy
     ↓
Calculate next eligible order/refill time
     ↓
Persist new schedule
     ↓
Show on existing customer order/refill UI
```

Customer should immediately see the new estimated date.

---

## 17. NEW MEDICINE ORDER VS EXISTING REFILL

The same existing pages must support both.

### Existing patient/refill order

Use the existing refill/history path.

```text
Previous purchase
     ↓
Order Again / Refill
     ↓
Current availability
     ↓
Current pricing
     ↓
New order
     ↓
Schedule automatically
```

### New medicine

```text
Catalog
 ↓
Add to cart
 ↓
Checkout
 ↓
New order
 ↓
Schedule automatically
```

Do not create separate customer-facing order systems.

---

## 18. ORDER BEFORE 11 PM / AFTER 11 PM EXAMPLE

Assume pharmacy configuration:

```text
Cutoff = 11:00 PM
Delivery = 7:00 PM–9:00 PM
Sunday = Closed
Holiday = Closed
```

### Case A: order at 8:00 PM Monday

```text
Before cutoff
Monday operating day
→ same-day/eligible processing
→ estimated window based on pharmacy rule
```

### Case B: order at 11:30 PM Monday

```text
After cutoff
→ next eligible operating day
→ estimated window based on that day
```

### Case C: order Sunday

```text
Sunday closed
→ next operating day
→ estimated window on next operating day
```

### Case D: order on holiday

```text
Holiday closed
→ next non-holiday operating day
→ estimated window on that day
```

The UI should explain the reason when the schedule moves:

```text
Next available delivery: Tuesday
Reason: Pharmacy closed on Monday holiday.
```

---

## 19. HOLIDAY CALENDAR

Use the existing settings/configuration architecture.

Holiday record should identify:

```text
pharmacy_id
date
name
closed / reduced_hours
opening_time (optional)
closing_time (optional)
```

Do not hardcode national or regional holidays in the frontend.

A holiday can be:

- fully closed
- reduced hours
- custom delivery window

The scheduler must respect the effective pharmacy calendar.

---

## 20. REDUCED-HOURS HOLIDAY

If holiday has reduced hours:

```text
Holiday
↓
Pharmacy open 10 AM–3 PM
↓
Order at 2 PM
↓
Use same-day eligibility if configured
```

Order at 4 PM:

```text
Closing time passed
↓
Next operating day
```

This must be calculated automatically.

---

## 21. RETURN POLICY: 15 DAYS

Implement the user's stated return rule as configuration on the existing order/bill/order-detail flow:

```text
Return window = 15 calendar days
```

The order should expose:

```text
Return eligible until: [date]
```

After that date:

```text
Return window closed
```

### Important pharmacy constraint

The 15-day timing engine is only a policy clock. It must NOT automatically make a medicine returnable where pharmacy/law/prescription/product safety rules prohibit returns.

Any existing return/adjustment workflow remains authoritative.

Do not create a new returns page.

### Clock source

Use the authoritative completed-sale/delivery timestamp already stored for the order, depending on the existing return policy implementation.

Do not calculate from browser local time.

---

## 22. RETURN STATUS IN EXISTING ORDER PAGE

Within the existing order detail page, show only the information relevant to the current order:

```text
Return status
Eligible until: 24 Sep 2026
```

or:

```text
Return window closed
```

Use existing buttons/components.

Do not create a standalone return-management page.

---

## 23. AUTOMATIC CUSTOMER NOTIFICATION

Use the existing central notification service.

Events to support:

```text
ORDER_SCHEDULE_CALCULATED
ORDER_SCHEDULE_CHANGED
ORDER_DELAYED_BY_HOLIDAY
ORDER_DELAYED_BY_CUTOFF
ORDER_CONFIRMED_BY_PHARMACY
ORDER_READY
DELIVERY_WINDOW_CHANGED
REFILL_DATE_CHANGED
RETURN_WINDOW_EXPIRING (optional if existing reminder infrastructure supports it)
RETURN_WINDOW_CLOSED
```

Channels:

```text
IN_APP
WHATSAPP
SMS
EMAIL
```

Only use channels already configured/enabled by the pharmacy/customer.

Do not create a second notification sender.

---

## 24. IN-APP MESSAGE EXAMPLES

### Order confirmed

```text
Order confirmed by the pharmacy.
Estimated delivery: Today, 7:00 PM–9:00 PM.
```

### After cutoff

```text
Your order was placed after today's cutoff.
Estimated delivery: Tomorrow, 7:00 PM–9:00 PM.
```

### Sunday/holiday

```text
The pharmacy is closed today.
Your order has been moved to the next available operating day.
Estimated delivery: Monday, 7:00 PM–9:00 PM.
```

### Pause

```text
Your refill/order plan is paused.
The next delivery date will be recalculated when you resume.
```

### Resume

```text
Your order plan has resumed.
Next estimated delivery: [date/time].
```

These are examples only. Use the existing notification templates/localization system if present.

---

## 25. CUSTOMER ORDER PAGE TIMELINE

The existing order page should render a lightweight timeline:

```text
ORDER PLACED
   ✓
   |
PHARMACY CONFIRMED
   ✓ / pending
   |
PREPARING
   ○
   |
READY
   ○
   |
OUT FOR DELIVERY
   ○
   |
DELIVERED
   ○
```

Under the timeline:

```text
Estimated delivery
[date] · [start]–[end]
```

If delayed:

```text
Schedule updated
Reason: Sunday closure
New estimated delivery
[date] · [window]
```

Use existing animation/timeline components if already available.

---

## 26. LIVE COUNTDOWN

Where the current page already has a countdown/timer presentation, connect it to the server-generated timestamp.

Example:

```text
Delivery window starts in 04:12:38
```

or more robustly:

```text
Delivery today · 7:00–9:00 PM
```

The countdown should automatically stop/transition when:

- the order state changes
- delivery window begins
- order is delayed
- order is completed
- order is cancelled

Do not keep showing stale countdowns.

---

## 27. SCHEDULING DATA MODEL

Extend the existing order model instead of creating a parallel order system.

Recommended fields:

```text
scheduled_processing_at
estimated_delivery_start
estimated_delivery_end
cutoff_at
pharmacy_timezone
schedule_status
schedule_reason
schedule_version
schedule_calculated_at
schedule_overridden_by (nullable)
schedule_overridden_at (nullable)
```

For recurring/refill plans, add to the existing refill/schedule entity where available:

```text
next_refill_at
paused_at
resumed_at
pause_duration_seconds
refill_schedule_version
```

### Schedule status examples

```text
SAME_DAY
NEXT_DAY
NEXT_OPERATING_DAY
HOLIDAY_SHIFT
SUNDAY_SHIFT
CUTOFF_SHIFT
CUSTOM_OVERRIDE
```

Do not duplicate these values into multiple tables.

---

## 28. ORDER SCHEDULE HISTORY / AUDIT

Timing changes must be auditable.

Examples:

```text
09 Sep 20:00
Schedule: same-day

09 Sep 23:30
Schedule changed
Reason: cutoff passed

10 Sep 08:00
Schedule changed
Reason: pharmacy holiday
```

Use the existing audit-log system where available.

Do not silently overwrite operational timing changes.

---

## 29. STAFF OVERRIDE

Automatic scheduling is the default.

Authorized staff can manually override the calculated ETA only where current order tooling already permits operational overrides.

When overridden, store:

```text
old_estimated_delivery_start
old_estimated_delivery_end
new_estimated_delivery_start
new_estimated_delivery_end
reason
staff_user_id
timestamp
```

Customer should see:

```text
Estimated delivery updated by pharmacy
```

Do not erase the automatic calculation history.

---

## 30. NO MANUAL RE-SCHEDULING AFTER EVERY ORDER

This is a key acceptance criterion.

The system must automatically handle:

```text
Before cutoff
After cutoff
Sunday
Holiday
Reduced holiday hours
Different pharmacy cutoffs
Different delivery windows
Pause
Resume
Refill date changes
```

Staff should only intervene when an actual operational exception occurs.

---

## 31. MULTI-STORE BEHAVIOR

The calculation must always use the selected order pharmacy/store.

Do NOT accidentally use a global cutoff.

Example:

```text
PHARM-001
Cutoff 11 PM
Delivery 7–9 PM

PHARM-002
Cutoff 10 PM
Delivery 5–7 PM
```

Orders from each pharmacy calculate independently.

---

## 32. CUSTOMER TIMEZONE

Pharmacy schedule is authoritative in the pharmacy timezone.

Store/display:

```text
pharmacy_timezone
```

Convert for customer display only when required.

Never compare naive browser timestamps to pharmacy operating hours.

---

## 33. TIME-SOURCE RULE

Backend/server time is authoritative for:

- cutoff decisions
- holiday decisions
- operating hours
- ETA calculation
- return-window calculation
- refill schedule calculation

Frontend time is presentation only.

This prevents users from changing device clocks to alter business logic.

---

## 34. IDEMPOTENCY

Schedule calculation must be safe to run more than once.

Example:

```text
Order created
↓
Schedule calculated
↓
Worker retries
↓
Schedule calculated again
```

The system must not create multiple orders or duplicate notifications simply because scheduling is recalculated.

Use the same order ID and an explicit schedule version/timestamp.

---

## 35. EVENT-DRIVEN RECALCULATION

Recalculate the order/refill schedule when a relevant event occurs:

```text
ORDER_CREATED
PHARMACY_SETTINGS_CHANGED
HOLIDAY_ADDED
HOLIDAY_REMOVED
ORDER_PAUSED
ORDER_RESUMED
DELIVERY_WINDOW_CHANGED
PHARMACY_CONFIRMED
MANUAL_OVERRIDE_REMOVED
```

Do not continuously recompute every order every second.

---

## 36. BACKGROUND JOBS

Use the existing worker/scheduler architecture for scheduled events.

Potential responsibilities:

```text
Schedule reconciliation
Order timing notifications
Refill date reconciliation
Return-window notifications
```

Do not create a second scheduler if the repository already has one.

---

## 37. CACHED SCHEDULE SAFETY

Order timing may be cached for display, but the authoritative value is persisted server-side.

When configuration changes:

```text
Settings changed
↓
Invalidate relevant schedule cache
↓
Recalculate affected future orders only
```

Do not recalculate every historical order unnecessarily.

Historical orders must remain historically accurate.

---

## 38. HISTORICAL ORDER INTEGRITY

Never rewrite historical delivery/order timestamps simply because the pharmacy changed its settings later.

Historical order must preserve:

```text
original order date
original calculated schedule
actual completion/delivery
original product/price snapshots
```

Only open/future orders whose schedules are actually affected may be recalculated.

---

## 39. REFILL SAFETY

A refill creates a NEW order.

Never mutate the previous sale.

On refill:

```text
History
  ↓
Order Again / Refill
  ↓
Current product
  ↓
Current stock
  ↓
Current price
  ↓
New order
  ↓
New schedule
```

This follows the existing repository rule that refills use current availability and pricing rather than blindly reusing historical values.

---

## 40. RETURN WINDOW SAFETY

A return-policy clock must never alter inventory or reverse a sale automatically.

The 15-day window only determines eligibility/status.

Any actual return:

```text
Existing return/adjustment flow
      ↓
Authorized validation
      ↓
Inventory/accounting action
```

No automatic refund or stock mutation should occur merely because day 15 has arrived.

---

## 41. API CONTRACT

Extend existing order/refill/settings APIs rather than creating parallel APIs.

Example order response:

```text
{
  "id": "ORD-10025",
  "status": "CONFIRMED",
  "timing": {
    "cutoffAt": "...",
    "sameDay": true,
    "scheduledProcessingAt": "...",
    "estimatedDeliveryStart": "...",
    "estimatedDeliveryEnd": "...",
    "timezone": "...",
    "status": "SAME_DAY",
    "reason": null
  },
  "returnPolicy": {
    "eligible": true,
    "eligibleUntil": "..."
  }
}
```

Refill response:

```text
{
  "nextRefillAt": "...",
  "paused": false,
  "scheduleReason": null
}
```

The exact names should follow the repository's existing conventions.

---

## 42. FRONTEND IMPLEMENTATION RULE

DO NOT create new routes/pages for this requirement.

Modify only the existing components responsible for:

```text
Customer Cart
Customer Order Detail
Customer Refill/History
Pharmacy Live Orders / Live Cart
Website Order Page
Settings
Existing Timeline/Notification components
```

Use existing cards, drawers, dialogs, badges, timelines, tabs, and action menus.

Where no dedicated component exists, add the smallest embedded section to the nearest existing page.

---

## 43. NO DUPLICATE BUSINESS LOGIC IN FRONTEND

The frontend must never independently decide:

```text
same day
next day
Sunday
holiday
cutoff
return expiry
refill shift
```

It only renders backend results.

---

## 44. REAL-TIME UPDATES

Use the application's existing event/WebSocket/polling system where present.

When schedule changes:

```text
Backend schedule updated
↓
Existing order event
↓
Customer order page updates
↓
Timeline/ETA refreshes
```

Do not introduce a new realtime transport solely for this feature unless the existing architecture cannot support the requirement.

---

## 45. TEST MATRIX

Minimum tests:

### Cutoff

```text
10:59 PM → eligible before cutoff
11:00 PM → exact configured boundary
11:01 PM → next schedule
```

### Sunday

```text
Sunday open → normal Sunday rule
Sunday closed → next operating day
```

### Holiday

```text
Full closure → next operating day
Reduced hours → apply reduced window
```

### Multi-pharmacy

```text
Pharmacy A cutoff != Pharmacy B cutoff
```

### Pause

```text
Active → Pause → Resume
```

Verify refill schedule changes only for future events.

### Return

```text
Day 14 → eligible if otherwise allowed
Day 15 → eligible through configured boundary
Day 16 → closed
```

Define the exact inclusive boundary in the existing policy code and test it consistently.

### Refresh/restart

Ensure ETA persists after:

- page refresh
- app restart
- reconnect

### Duplicate execution

Run scheduling twice and verify:

- one order
- one schedule version per effective change
- no duplicate notification caused by the recalculation itself

---

## 46. END-TO-END ACCEPTANCE TEST

Test this complete scenario:

```text
1. Customer selects pharmacy.
2. Customer selects existing catalog product.
3. Customer adds product to existing cart.
4. Customer checks out through existing website flow.
5. Order is created.
6. Backend reads pharmacy settings.
7. Backend reads cutoff.
8. Backend reads Sunday/holiday calendar.
9. Backend calculates schedule.
10. Customer sees estimated delivery immediately.
11. Existing pharmacy order page receives the same order.
12. Pharmacy confirms product availability.
13. Order moves through existing preparation/ready workflow.
14. Timeline updates automatically.
15. Customer can see the delivery window.
16. If the order is paused, future schedule changes.
17. On resume, future schedule recalculates.
18. Refill date updates accordingly.
19. Customer orders a new medicine from catalog.
20. New order automatically gets its own calculated schedule.
21. Customer receives the correct next-day/same-day result depending on cutoff.
22. Sunday/holiday orders automatically move to next operating day.
23. Return eligibility is shown on existing order detail.
24. After day 15, return window is shown as closed.
25. No new page was created.
26. No second order/cart/refill system exists.
```

---

## 47. AUDIT CHECKLIST BEFORE CODING

Before changing code, inspect the actual repository for:

```text
[ ] Existing settings service/table
[ ] Existing pharmacy/store hours model
[ ] Existing holiday model
[ ] Existing order model
[ ] Existing order service
[ ] Existing order status workflow
[ ] Existing customer cart
[ ] Existing pharmacy live cart
[ ] Existing refill service/model
[ ] Existing notification service
[ ] Existing background worker/scheduler
[ ] Existing audit log
[ ] Existing return workflow, if any
[ ] Existing timeline/countdown component
[ ] Existing website order page
[ ] Existing customer order detail page
```

Only modify the exact files necessary.

---

## 48. FILE-SCOPE RULE

Before implementation, produce an internal changed-file map:

```text
FILE
WHY REQUIRED
EXISTING FUNCTION/COMPONENT USED
CHANGE TYPE
```

Revert unrelated edits.

Do not refactor the entire application to implement a scheduling rule.

---

## 49. DATABASE MIGRATION RULE

If new fields are required:

- add them through the existing migration mechanism
- preserve all existing orders/customers/products
- provide sensible null/default handling
- never rebuild the database from scratch
- never create a parallel timing database

Historical data must continue to open successfully.

---

## 50. PERFORMANCE RULE

Do not run a full database schedule recalculation every second.

Correct design:

```text
Persist schedule once
↓
Render countdown from timestamps
↓
Recalculate only on relevant business events
```

Background workers handle scheduled transitions.

---

## 51. CONFIGURATION RULE

Business rules belong in settings/configuration, not hardcoded components.

Therefore future changes such as:

```text
11 PM → 10 PM
7–9 PM → 6–8 PM
Sunday open → closed
15 days → different policy
24 hour → 18 hour
```

must be configuration changes, not frontend rewrites.

---

## 52. FINAL ARCHITECTURAL MODEL

```text
                    EXISTING SETTINGS
                           |
                           v
                 PHARMACY SCHEDULING CONFIG
                           |
               +-----------+-----------+
               |                       |
               v                       v
         OPERATING HOURS         HOLIDAY CALENDAR
               |                       |
               +-----------+-----------+
                           |
                           v
                SHARED SCHEDULE SERVICE
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
           CART          ORDER         REFILL
             |             |             |
             +-------------+-------------+
                           |
                           v
                  EXISTING ORDER PAGES
                           |
              +------------+------------+
              |                         |
              v                         v
       CUSTOMER ORDER UI       PHARMACY LIVE ORDER UI
              |
              v
        ETA / TIMELINE / STATUS
              |
              v
       EXISTING NOTIFICATION SERVICE
```

---

## 53. FINAL REQUIREMENT

The implementation must feel like the application **always had this timing system**.

A customer should place an order and automatically receive:

```text
Confirmed
↓
Estimated delivery date/time
↓
Live status timeline
↓
Automatic adjustments for cutoff/Sunday/holiday
↓
Automatic refill-date adjustment after pause/resume
↓
Return eligibility window
```

A pharmacy operator should see the same schedule in the existing order workflow and should not need to maintain a second manual time table.

### STRICT UX RULE

**No new pages. No duplicate workflows. No manual date entry for normal orders. No frontend-only timing logic. No hardcoded pharmacy operating rules.**

The feature must be implemented by extending the current architecture and existing pages, consistent with the repository's centralized catalog/order/refill and configuration-driven principles.
