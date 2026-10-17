# Refill Early Booking – Auto-Carry to POS, Block Re-Booking & Stop Reminder Spam

**Goal:** Fix the refill flow so that when a patient books a refill early, the app auto-carries them into the live POS cart, enforces "only once per refill cycle", and advances `next_due_date` on billing to stop next-month reminder spam.

## 1) Problem Statement

- Right now clicking **"Add to Cart"** from **Quick Assist > Refills** or **CRM > Refills** just navigates to POS with minimal prefill.
- If `next_due_date` is still in the future (early refill), the system never advances `next_due_date` after billing.
- Because of this, the refill reminder cron still sees the old `next_due_date` and sends "Refill Due" messages again next month (Inbox spam).
- Staff can also click "Add to Cart" multiple times for the same refill and end up trying to bill the same cycle again.
- Patient can be "booked" 2–3 times in the same month/cycle by mistake.

## 2) Login & App Behavior (Short)

1. **Open App** – Electron splash → backend starts
2. **Login** – Username/Password or PIN → backend validates from `users` table → returns token
3. **Session** – Token saved in `localStorage`, used for all APIs. `tokenRefreshScheduler` does a light heartbeat every ~20 min to keep session alive
4. **Navigation** – After login go to Dashboard. Stay logged in until logout
5. **Refills View** – Quick Assist & CRM read from `patient_refills` and show due dates
6. **Billing Point** – **Invoice Save** is the real "dispensed" action, not "Add to Cart"

## 3) Core Rules

We must enforce these rules strictly:

- **One per cycle** – Allow booking for a refill cycle **only once**. If already dispensed in the current running cycle, block it.
- **Auto-carry to POS** – On allowed click, take user to `/pos` with that patient + medicine auto-loaded into the **live cart**.
- **Advance on billing** – When invoice is saved for a refill (with `refill_id`), and user chose **"Yes, Advance Cycle"**, update `patient_refills` to start a new cycle from `sale_date`.
- **Don't block legit early sale** – Allow early booking **once** with a clear confirmation.
- **Stop spam** – Advancing `next_due_date` means the old future due date is gone, so reminder cron won't pick it up next month.
- **Force clarity** – Show "REFILL" banner + patient + due date on POS when coming from refills.

## 4) Data Fields to Use

From `patient_refills` table (use existing fields):

| Field | Purpose |
|---|---|
| `id` | Refill ID (pass as `refill_id`) |
| `patient_id` | Link to patient |
| `medicine_id` | Medicine for this refill |
| `medicine_name` | For display/prefill |
| `qty` | Qty to add to cart |
| `duration_days` | e.g. 30, 60 to compute new cycle |
| `next_due_date` | Current due date for this cycle |
| `last_dispensed_date` | Date when last dispensed (if any) |
| `status` | Track state if needed |
| `phone` / patient phone | For display |

Also use invoice date (`sale_date`) on backend at save time.