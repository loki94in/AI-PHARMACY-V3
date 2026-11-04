# Multi-Index & Duplicate Join Elimination Implementation Plan

## Objective
Eliminate all instances where two or more indexing paths, columns, or ambiguous SQL joins (`OR` joins) conflict or generate duplicate/ghost records for a single spot in the application (including patient refills, staged automation notifications, Pharmarack distributor mappings, and special orders).

---

## Findings Summary & Architectural Analysis

| Area | File & Line | Cause | Impact | Fix |
| --- | --- | --- | --- | --- |
| **1. Refill Overdue Tracker** | `src/services/orderScheduleService.ts:658` | `LEFT JOIN customers c ON (c.name = pr.patient_name OR c.id = pr.customer_id)` | Cartesian product on shared names (tested: 78 refills turned into 110 rows, 32 ghost duplicates) | Join `c.id = COALESCE(pr.customer_id, (SELECT id FROM customers WHERE name = pr.patient_name LIMIT 1))` |
| **2. Staged Auto Refill Dispatch** | `src/routes/refills.ts:2979` | `LEFT JOIN customers c ON (c.phone = an.recipient_phone OR c.name = an.recipient_name)` | Duplicate rows loop in dispatch, triggering duplicate WhatsApp messages to patients | Join `c.id = COALESCE(SELECT id by phone, SELECT id by name LIMIT 1)` |
| **3. Staged Summary & Briefings** | `src/routes/refills.ts:2929, 3055` & `src/services/refillService.ts:873, 1231` | `LEFT JOIN customers c ON (c.phone = an.recipient_phone OR c.name = an.recipient_name)` | Over-counted reminders and inflated owner alert metrics | Join `c.id = COALESCE(SELECT id by phone, SELECT id by name LIMIT 1)` |
| **4. Pharmarack Distributor Mappings** | `src/routes/pharmarack.ts:849, 4119` | `LEFT JOIN distributors d ON (m.distributor_id = d.id OR LOWER(TRIM(m.store_name)) = LOWER(TRIM(d.name)))` | If ID and name point to different records or duplicate names exist, returns duplicate mappings | Join `d.id = COALESCE(m.distributor_id, (SELECT id FROM distributors WHERE name = m.store_name LIMIT 1))` |
| **5. Special Order Arrival Alerts** | `src/routes/orders.ts:494` | `buildOrderReadyNotificationMessage(..., order.product, ...)` | If order was created via modern catalog with `medicine_name`, product is `undefined` | Use `(order.medicine_name || order.product || 'Special Order Item').trim()` |
| **6. Short Phone Protection** | `src/routes/orders.ts:465` | `if (!cleanPhone) return false;` | Short numbers (<10 digits) can match unintended companion orders | Require `cleanPhone.length === 10` |

---

## Step-by-Step Execution Plan

### Step 1: Fix Refill Overdue Tracker in `src/services/orderScheduleService.ts`
- Replace line 658:
  ```sql
  LEFT JOIN customers c ON c.id = COALESCE(
    pr.customer_id,
    (SELECT c2.id FROM customers c2 WHERE c2.name = pr.patient_name ORDER BY c2.id DESC LIMIT 1)
  )
  ```
- **Verification**: Run `python` check to verify that active refills return exactly 1 row per active refill with zero ghost duplicates.

### Step 2: Fix Staged Refill Reminders in `src/routes/refills.ts` and `src/services/refillService.ts`
- Replace ambiguous `(c.phone = an.recipient_phone OR c.name = an.recipient_name)` joins across:
  - `src/routes/refills.ts` lines 2929, 2979, 3055
  - `src/services/refillService.ts` lines 873, 1231
- Use deterministic phone-first, name-second `COALESCE` with `LIMIT 1`.
- **Verification**: Verify that auto-dispatch cannot enqueue duplicate messages for the same staged notification ID.

### Step 3: Fix Pharmarack Distributor Mapping Joins in `src/routes/pharmarack.ts`
- Replace lines 849 and 4119:
  ```sql
  LEFT JOIN distributors d ON d.id = COALESCE(
    m.distributor_id,
    (SELECT d2.id FROM distributors d2 WHERE LOWER(TRIM(d2.name)) = LOWER(TRIM(m.store_name)) ORDER BY d2.id DESC LIMIT 1)
  )
  ```
- **Verification**: Confirm mapping queries return 1-to-1 rows with zero duplicates.

### Step 4: Fix Special Order Arrival Notification in `src/routes/orders.ts`
- Line 465: enforce `cleanPhone.length === 10`.
- Line 494: enforce `(order.medicine_name || order.product || 'Special Order Item').trim()`.
- **Verification**: Confirm arrival alerts render valid medicine names and reject short phones.

### Step 5: Verification & Zero-Bugs Gate
- Backend TypeScript compilation: `npm run build` or `npx tsc -p tsconfig.json --noEmit`.
- Automated test suites: `npm test tests/distributorDispatchAllDirectory.test.ts`.
- Performance Guardrails: `npm run guardrails`.
- Auto-knowledge graph update: `node scripts/quick-update.mjs`.

### Step 6: Human-in-the-Loop Review Gate (Rule 6 & EGM-Resolve)
- Present the compiled findings and resolution options to the user.
- Await user approval before execution.

---

## Tasks Status & Resume Log

- [x] **Task 1: Comprehensive Codebase Audit for Multi-Index / Ambiguous Joins**
  - Audited all `JOIN ... ON ... OR` patterns across `src/` and `frontend/`.
  - Proved that 5 locations suffered from Cartesian expansion and ghost rows.
  - Documented in `goldfish_review_report.md`.

- [x] **Task 2: Fix `src/services/orderScheduleService.ts` Refill Overdue Query**
  - Replaced ambiguous `c.name = pr.patient_name OR c.id = pr.customer_id` with single-source `COALESCE(pr.customer_id, (SELECT id FROM customers WHERE name = pr.patient_name LIMIT 1))`.
  - Verified on database: reduced from 110 rows (32 ghost duplicates) to exactly 78 rows (1-to-1 match).

- [x] **Task 3: Fix `src/routes/refills.ts` and `src/services/refillService.ts` Staged Reminders**
  - Replaced ambiguous `(c.phone = an.recipient_phone OR c.name = an.recipient_name)` across `routes/refills.ts` (lines 2929, 2979, 3055) and `services/refillService.ts` (lines 873, 1231).
  - Enforced Phone-first matching (canonical retail identifier) with single-row Name fallback (`LIMIT 1`).
  - Completely eliminated risk of duplicate WhatsApp reminders in `/dispatch-staged-auto`.

- [x] **Task 4: Fix `src/routes/pharmarack.ts` Distributor Mapping Queries**
  - Replaced ambiguous join in lines 849 and 4119 with authoritative `COALESCE(m.distributor_id, (SELECT id FROM distributors WHERE name = m.store_name LIMIT 1))`.
  - Guaranteed 1-to-1 mapping rows in Pharmarack cart views.

- [x] **Task 5: Fix `src/routes/orders.ts` Special Order Arrival Alert Fallbacks**
  - Line 465: Enforced 10-digit phone requirement (`if (!cleanPhone || cleanPhone.length !== 10) return false;`).
  - Line 494: Enforced medicine name fallback `(order.medicine_name || order.product || 'Special Order Item').trim()`.

- [x] **Task 6: Full Verification, Guardrails, and Knowledge Graph Update**
  - TypeScript compilation (`tsc --noEmit`): PASSED (0 errors).
  - Jest dispatch test suites (`distributorDispatchAllDirectory.test.ts`, `directOrderDispatchFlow.test.ts`): PASSED (8/8).
  - Performance Guardrails (`npm run guardrails`): PASSED (0 violations).
  - Knowledge graph (`quick-update.mjs`): Updated in 4.0s (1450 nodes).

