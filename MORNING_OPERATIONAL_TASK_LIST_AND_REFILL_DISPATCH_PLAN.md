# Morning Operational Task List & Refill Dispatch Briefing Plan

## 1. Problem Statement & Root Cause Analysis

### Why Was the Refill List Missing from the Morning WhatsApp Message?
When tested on morning boot (`2026-09-26`), the briefing sent to the pharmacy owner showed:
```text
📋 Refills Due:
• No pending refills for today
```
Even though active refills were configured in the database:
- **Mr. HARISH KUMBHAR**: `next_refill_date: '2026-10-03'`, status: `'notified'`, `is_active: 1`
- **Mr. RATNAKR**: `next_refill_date: '2026-10-03'`, status: `'pending'`, `is_active: 1` (2 medicines)
- **Mr. RUSHI MOKASHI**: `next_refill_date: '2026-10-07'`, status: `'pending'`, `is_active: 1` (2 medicines)

#### Root Causes Identified:
1. **Strict Same-Day Comparison (`<= DATE('now')`)**:
   - The query in `sendMorningScheduleBriefingToAdmin` was:
     ```sql
     WHERE pr.status = 'pending' AND pr.is_active = 1 AND DATE(pr.next_refill_date) <= DATE('now', 'localtime')
     ```
   - On `2026-09-26`, `2026-10-03` is 7 days ahead. Therefore, the query evaluated to zero rows.
   - Pharmacies operate on **advance lead notice** (typically 3 to 7 days ahead) so stock can be procured from distributors before the patient runs out of medicine.
2. **Exclusion of `notified` or `staged` Status Refills**:
   - The query filtered strictly on `pr.status = 'pending'`, discarding any refills currently staged or notified for upcoming dispensing.
3. **Missing Operational Task Checklist**:
   - The briefing only contained generic text without an actionable **Daily Task List** for pharmacy staff:
     - Pending phone calls on the Call Board (`patient_call_tasks`)
     - Pending WhatsApp / Special Customer Orders (`special_orders`)
     - Immediate Stock Shortages / Expiry Batches needing distributor returns
     - Staged reminders requiring 1-click pharmacist authorization

---

## 2. Senior-Level Solution Design

### A. Extended Refill Query & Compact Patient Aggregation (7-Day Rolling Horizon)
Instead of filtering only `<= today`, the morning query evaluates active refills within 7 days, and groups them by patient to keep the WhatsApp message short and concise:
```sql
SELECT pr.patient_name, pr.patient_phone, 
       MIN(DATE(pr.next_refill_date)) as earliest_due,
       COUNT(pr.id) as total_items,
       SUM(CASE WHEN pr.is_ready = 1 THEN 1 ELSE 0 END) as in_stock_items,
       SUM(CASE WHEN pr.hold_for_stock = 1 THEN 1 ELSE 0 END) as hold_items
FROM patient_refills pr
WHERE pr.is_active = 1 
  AND pr.status IN ('pending', 'notified', 'staged')
  AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+7 days')
GROUP BY pr.patient_name, pr.patient_phone
ORDER BY earliest_due ASC, pr.patient_name ASC
LIMIT 20
```
**Compact Formatting (No medicine names to keep message short)**:
- Each line contains:
  `[#]. *[Patient Name]* (Due [Date]) — [X] meds ([Stock Status])`
- Example:
  `1. *Mr. RATNAKR* (Due 03 Oct) — 2 meds (✅ In Stock)`
  `2. *Mr. HARISH KUMBHAR* (Due 03 Oct) — 1 med (⏳ Hold for Stock)`
- Complete medicine breakdowns remain accessible inside the CRM / Refills dashboard.

### B. Daily Operational Action Checklist
The briefing aggregates 5 actionable task categories:
1. **Due & Upcoming Refills (7 Days)**: Compact list of patients + med counts + stock readiness (no long medicine names).
2. **Call Board Tasks (`patient_call_tasks`)**: Count of pending voice call follow-ups (refill reminders & credit dues).
3. **Customer Special Orders (`special_orders`)**: Unfulfilled patient medicine requests summary.
4. **Stock Shortage & Near-Expiry Alerts**:
   - Critical items with $< 5$ stock.
   - Batches expiring within the current calendar month (`exp_date <= 'YYYY-MM'`).
5. **Staged Outbound Queue (Human-in-the-Loop)**:
   - Total staged notifications in CRM/Quick Assist awaiting pharmacist approval.

### C. Human-in-the-Loop Safety Contract
- No patient messages will be sent automatically from this briefing.
- All actions (dispatching refill WhatsApp, placing reorders, logging call outcomes) remain strictly gated behind pharmacist manual review in the web app.

---

## 3. Formatted WhatsApp Morning Task List Preview (Ultra-Short & Concise)

```text
☀️ *DAILY OPERATIONAL TASK BRIEFING* — TANMAY MEDICAL
📅 *Date*: 26 Sep 2026 (Saturday) | 🟢 Store Open

📋 *1. REFILLS WORKLIST (Next 7 Days)*:
  1. *Mr. RATNAKR* (Due 03 Oct) — 2 meds (✅ In Stock)
  2. *Mr. HARISH KUMBHAR* (Due 03 Oct) — 1 med (⏳ Hold for Stock)
  3. *Mr. RUSHI MOKASHI* (Due 07 Oct) — 2 meds (✅ In Stock)

📞 *2. CALL TASKS*:
  • 2 patient call tasks pending in CRM Call Board

📦 *3. SPECIAL / WHATSAPP ORDERS*:
  • 1 pending order: *Suresh Patel* (Duphaston 10mg × 2)

⚠️ *4. INVENTORY TASKS*:
  • 4 batches expiring this month (Sep 2026) — review for return
  • 8 low-stock items (< 5 units) needing Pharmarack reorder

🔔 *5. STAGED CUSTOMER MESSAGES*:
  • 3 reminders staged in CRM / Quick Assist.
  👉 *Human-in-the-Loop*: Visit http://localhost:5173/crm to review & 1-click approve.
```

---

## 4. Implementation Checklist & Verification

- [x] **Step 1: Enhance `sendMorningScheduleBriefingToAdmin` in `src/services/refillService.ts`**:
  - Updated query to include active refills within 7 days (`+7 days`) and statuses `('pending', 'notified', 'staged')`.
  - Grouped refills by patient to keep the message ultra-compact and short without listing long medicine names.
  - Added real-time stock computation for total units (strips + loose) to classify `✅ In Stock` vs `⏳ Hold for Stock`.
  - Added pending `patient_call_tasks` check.
  - Added active unfulfilled `special_orders` check.
  - Added batches expiring in the current month check.
  - Added staged reminders count with human-in-the-loop notice.
- [x] **Step 2: Guardrail & TypeScript Verification**:
  - Ran `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) clean, 0 violations, speed architecture intact.
- [x] **Step 3: Live Pipeline Dispatch to Store Owner**:
  - Dispatched the briefing via the application's real WhatsApp queue worker (`whatsappQueueWorker.enqueue`).
  - Flushed the queue via `/api/whatsapp/queue/flush-next`.
  - Verified delivery in `whatsapp_sent_register` (ID: 10, Delivery Status: `delivered` to owner `918080888041`).

---

## 5. Resumption Log for Agents

| Step | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Root Cause Analysis | Completed | 2026-09-26 10:55 | Identified 7-day lead gap, strict status filter, and missing task categories |
| Design & Plan Update | Completed | 2026-09-26 10:58 | Removed medicine names per user request to make WhatsApp message compact |
| Code Implementation | Completed | 2026-09-26 11:02 | Updated `sendMorningScheduleBriefingToAdmin` in `src/services/refillService.ts` |
| Guardrails Validation | Completed | 2026-09-26 11:03 | `npm run guardrails` passed (exit code 0) |
| Live Pipeline Test | Completed | 2026-09-26 11:05 | Delivered to owner `918080888041` with status `delivered` |
