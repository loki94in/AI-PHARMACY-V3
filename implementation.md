# Implementation Plan: 7-Day Refill Lead-Time & Cycle Visibility Engine

## 1. Overview
Enforce the strict 7-day visibility and cycle dormancy rule across the app:
1. Patients become visible in the Quick Assist panel and Morning Briefing **only when their next refill is due within 7 days** (or overdue).
2. When the user completes or fulfills the refill, the patient is **immediately removed and remains dormant** until 7 days before their *next* cycle.
3. Fix the two bugs that were falsely hiding upcoming patients:
   - The `Math.max(7)` minimum-cycle trap in `checkRefillCycleBooking` that hid 7–10 day interval patients due in 2–5 days.
   - The string-comparison bug without `DATE()` in `GET /refills/panel` that dropped 7th-day patients.

---

## 2. Planned Changes

### Step 1: Fix SQL Lead-Time Filter in `src/routes/refills.ts`
- In `GET /refills/panel`:
  - Replace `pr.next_refill_date <= date('now', '+' || ? || ' days')` with `DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+' || ? || ' days')`.
  - Add `AND pr.is_active = 1`.

### Step 2: Fix `checkRefillCycleBooking` & Visibility in `frontend/src/utils/refillSettled.ts`
- Remove the `Math.max(7)` barrier that wrongly flagged patients due in 2–5 days as `alreadyDispensed`.
- Guard `alreadyDispensed`: only mark a cycle already dispensed if `isRefillFulfilledToday` is true, or if `daysSinceDispense === 0`. If `nextDue` is within 7 days, the patient must be active and actionable.

### Step 3: Align `QuickAssistSidebar.tsx` Filter
- Ensure `actionableRefills` and `groupedActionableRefills` do not filter out patients whose due date is within 7 days.

### Step 4: Verification & Guardrails
- Test `GET /api/refills/panel?upcoming_days=7` returns all 6 due patients (Subhash Chandra, Seeta Bai Sonawne, Alka Gulab Sonawne, Vishal Bhise, Sneha, Sunita Chavan).
- Verify Quick Assist grouping logic.
- Run `npm run guardrails` and `node scripts/quick-update.mjs`.

---

## 3. Progress Tracker
- [x] Task 1: Fix SQL date comparison in `src/routes/refills.ts` for `/refills/panel`.
- [x] Task 2: Fix `checkRefillCycleBooking` in `frontend/src/utils/refillSettled.ts`.
- [x] Task 3: Align `QuickAssistSidebar.tsx` actionable refills filter.
- [x] Task 4: Verify all 6 upcoming patients are active and pass guardrails.

---

## 4. Completed Work & Verification Summary

### What Was Completed:
1. **SQL Date Evaluation in `src/routes/refills.ts` (lines 717-721)**:
   - Used `DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+' || ? || ' days')` so 7th-day refill dates (with timestamps) are compared accurately as date strings instead of falling off the boundary.
   - Enforced `pr.is_active = 1 AND (pr.last_refill_date IS NULL OR DATE(pr.next_refill_date) > DATE(pr.last_refill_date))`.

2. **Fixed Lead-Time Visibility in `frontend/src/utils/refillSettled.ts`**:
   - Eliminated the `Math.max(7, Math.floor(intervalDays * 0.6))` trap in `checkRefillCycleBooking` which wrongly marked 7–10 day interval patients (Seeta Bai, Alka Gulab, Vishal Bhise, Sneha) as `alreadyDispensed: true` when their next refill was 2–5 days away.
   - Any patient in their 7-day upcoming lead-time window (`diffDays <= 7`) who was not dispensed today (`daysSinceDispense === 0` / `isRefillFulfilledToday`) is now cleanly active, bookable, and actionable (`alreadyDispensed = false`).
   - Patients beyond 7 days away are marked dormant (`alreadyDispensed = true`) until their upcoming window opens.

3. **Quick Assist Panel Grouping & Morning Briefing Alignment**:
   - Verified `groupedActionableRefills` in `QuickAssistSidebar.tsx`: all 6 due patients are active and non-settled (`visible=true`).
   - Morning Briefing query in `src/services/refillService.ts`: accurately surfaces all 6 due patients across their upcoming cycles.
   - Marking a refill complete atomically advances `next_refill_date` and marks the patient settled/dormant until $T-7$ days before the next cycle.

### Verification Results:
- **Patients in 7-Day Window**:
  - `Mr. SUBHASH CHANDRA`: due 2026-10-18 (Overdue) -> `visible=true, alreadyDispensed=false`
  - `Mr. SEETA BAI SONAWNE`: due 2026-10-22 (in 2 days) -> `visible=true, alreadyDispensed=false`
  - `Mr. ALKA GULAB SONAWNE`: due 2026-10-23 (in 3 days) -> `visible=true, alreadyDispensed=false`
  - `Mr. VISHAL BHISE`: due 2026-10-24 (in 4 days) -> `visible=true, alreadyDispensed=false`
  - `Mr. SNEHA`: due 2026-10-25 (in 5 days) -> `visible=true, alreadyDispensed=false`
  - `Mr. SUNITA CHAVAN`: due 2026-10-27 (in 7 days) -> `visible=true, alreadyDispensed=false`
- **Guardrails**: `npm run guardrails` passed (exit code 0, 0 violations).
- **Knowledge Graph**: `node scripts/quick-update.mjs` completed (1270 nodes, 809 edges).
