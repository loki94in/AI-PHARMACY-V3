# Morning Briefing Customer Grouping & Consolidated WhatsApp Plan

## Objective
Eliminate duplicate customer entries in the Morning Briefing WhatsApp message by grouping multiple products under the same customer with itemized bullet points, and merge pending shortage / unfulfilled order alerts (>23h) directly into the Morning Briefing so the Store Owner receives exactly one unified message without spam.

---

## Root Cause Analysis
1. **Flat Row Iteration in Special Orders**: In [`src/services/refillService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillService.ts) (`buildDailyOperationalBriefing`), `special_orders` rows are iterated individually. If a customer orders 4 medicines, the customer's name is repeated 4 times as separate numbered items (`1. *Rahul Sharma*...`, `2. *Rahul Sharma*...`), pushing other orders off the 15-item limit.
2. **Multiple Shortage Alert Messages**: In [`src/services/shortageReminderService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/shortageReminderService.ts) (`checkShortageRequestsAndNotifyAdmin`), a separate individual WhatsApp alert is sent for *every* medicine pending >23 hours, causing multiple consecutive notification pings in the morning.

---

## Desired Architecture

### 1. Customer-Grouped Special & Online Orders
Instead of flat un-grouped rows, group by `requester` + `phone` or `order_id`:
```
📦 *TODAY'S SPECIAL & ONLINE ORDERS*:
1. *Rahul Sharma* (3 items • WhatsApp Order):
   • Telmisartan 40mg × 1 (Pending)
   • Metformin 500mg × 2 (Pending)
   • Pantoprazole 40mg × 1 (Pending)
2. *Pooja Patel* (1 item • Special Order):
   • Augmentin 625 Duo × 1 (Ready)
```

### 2. Merged Shortages in Morning Briefing
Integrate >23h shortage reminders directly into the Morning Briefing under the `⚡ TODAY'S OPERATIONAL TASKS` / `📋 REORDER NEEDED` section. Disable redundant standalone WhatsApp notification pings from `shortageReminderService.ts`.

---

## Tasks Checklist

- [x] **Task 1: Group Special Orders by Customer in `refillService.ts`**
  - Updated `buildDailyOperationalBriefing` in [`src/services/refillService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillService.ts).
  - Aggregated `special_orders` rows by customer name / phone into grouped objects (`groupedCustomerOrders`).
  - Rendered each customer once with itemized medicine lines and total item count across all templates (`detailed`, `compact`, `checklist`, `executive`).
  - *Verification*: Multiple medicines for the same customer appear nested under one header.

- [x] **Task 2: Merge Shortages & Unfulfilled Alerts into Briefing**
  - In `buildDailyOperationalBriefing`, queried pending shortage requests (>23h) and rendered them directly in the briefing's Action Checklist and Today's Tasks.
  - In [`src/services/shortageReminderService.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/shortageReminderService.ts), replaced the per-medicine WhatsApp alert loop with **at most 1 single consolidated message** when triggered standalone, logging items to action logs and automation notifications.
  - *Verification*: Store owner receives 0 duplicate spam messages; all items appear cleanly inside the 9:00 AM Morning Briefing.

- [x] **Task 3: Automated Verification & Guardrail Audit**
  - Ran `npm run guardrails` (TypeScript compile check OK, 0 violations).
  - Ran `node scripts/quick-update.mjs` (Graph updated with 1157 nodes, 573 edges).

---

## Execution Log
- **Status**: Completed successfully. All tasks verified and active.
