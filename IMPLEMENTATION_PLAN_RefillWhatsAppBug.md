# Implementation Plan: Refill Completion Leak into WhatsApp Briefing Messages

**Status:** Planned (no code changes made yet)  
**Location:** Root folder only — `E:\CURRENT PROJECT ON WORKING\AI PHARMACY v2\IMPLEMENTATION_PLAN_RefillWhatsAppBug.md`  
**Affected feature:** Patient refill completion and WhatsApp collection / morning briefing messages

---

## Problem

When a user marks patient refills as **Complete / Fulfilled** (Quick Assist "Complete All", CRM refill completion, or `POST /patient/:phone/fulfill-all`), the refill cycle advances correctly, but just-completed medicines can still appear in subsequent WhatsApp collection messages and morning briefings.

Root cause: `executeCloseRefillCycles()` (`src/routes/refills.ts` line 1605) resets `status = 'pending'` so the next 7-day cycle can start, and sets `last_refill_date = today`. However, the **"Mark Ready"** patient WhatsApp endpoint (`src/routes/refills.ts` line 2967) filters only on:

```sql
WHERE pr.is_active = 1
  AND pr.status NOT IN ('completed', 'canceled')
```

Since status is now `'pending'`, the completed refill passes this filter. The query never checks `last_refill_date` or `next_refill_date`, so just-completed refills are pulled back into the patient WhatsApp message immediately.

The auto morning worker (`src/services/collectionReminderWorker.ts` line 78) filters `is_ready = 1` (which is `0` after completion), so scheduled auto-morning reminders are mostly protected — but it lacks an explicit date guard as defense in depth.

---

## Goal

After a user marks refills **Complete**, those medicines must be **excluded** from any patient WhatsApp collection message and morning briefing until their next cycle date arrives (`next_refill_date <= today`).

---

## Files to Change (read-only analysis done; no edits yet)

### 1. `src/routes/refills.ts` — `POST /patient/:phone/mark-ready` (multi-refill endpoint)
**Location:** Around line 2967 (the `patient_refills` SELECT query)

**Change:** Add a same-day exclusion so refills completed today are not included:

```sql
AND DATE(pr.last_refill_date) != DATE('now', 'localtime')
```

Or more precisely, only include refills whose next cycle has arrived:

```sql
AND (pr.next_refill_date IS NULL OR DATE(pr.next_refill_date) <= DATE('now', 'localtime'))
```

### 2. `src/routes/refills.ts` — `POST /:id/mark-ready` (single-refill endpoint)
**Location:** Around line 3080 (the individual refill SELECT query)

**Change:** Apply the same `last_refill_date` / `next_refill_date` guard.

### 3. `src/services/collectionReminderWorker.ts` — `runCollectionReminderCycle()`
**Location:** Around line 78–91 (the ready refills scan query)

**Change:** Add defense-in-depth date guard alongside the existing `is_ready = 1` filter:

```sql
AND DATE(pr.last_refill_date) != DATE('now', 'localtime')
```

### 4. `IMPLEMENTATION_PLAN_RefillWhatsAppBug.md` (this file)
Created in root folder as documentation only.

---

## What Already Works (do not change)

- `executeCloseRefillCycles()` already calls `purgePendingCustomerReminders()` to cancel staged notifications — this part is functioning.
- `CollectionReminderWorker` already filters `is_ready = 1`, so scheduled auto-morning reminders do not include completed refills under normal operation.
- Date handling uses shop-local time via `DATE('now', 'localtime')` (consistent with guardrail B4 / `utils/localTime.ts`).

---

## Expected Behavior After Fix

| Scenario | Before Fix | After Fix |
|----------|-----------|-----------|
| User marks refill Complete today | `status='pending'`, `last_refill_date=today`; refill can reappear in WhatsApp if Mark Ready is clicked again | Refill excluded from patient WhatsApp collection message until `next_refill_date` arrives |
| Auto morning worker runs | Protected by `is_ready=0` only | Additional date guard ensures completed-today refills are never included |
| Next 7-day cycle arrives | Eligible | Eligible (`next_refill_date <= today`) |

---

## Verification Steps (to perform after implementation)

1. Create a patient refill with a 7-day interval.
2. Mark it Complete / Fulfilled.
3. Click "Mark Ready" for that patient — the completed medicine must **not** appear in the WhatsApp collection message.
4. Confirm `last_refill_date` = today and `next_refill_date` = today + 7 days in the DB.
5. Advance `next_refill_date` to today (simulate cycle arrival) — the refill should become eligible again.
6. Run `npm run guardrails` to ensure no violations introduced.
7. Run `node scripts/quick-update.mjs` to refresh the knowledge graph (per project DOX contract).

---

## Constraints

- Do not change the `status = 'pending'` reset behavior — it is required for cycle advancement.
- Do not reintroduce dummy/fabricated data or mock fallbacks.
- Keep all date comparisons in shop-local time (`DATE('now', 'localtime')`), never `toISOString()`.
- Follow the Strict Manual-Only Patient Messaging contract — no automatic patient messages; only user-triggered WhatsApp sends.

---