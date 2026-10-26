# Implementation Plan — Include Upcoming 7-Day Refills with Day-of-Week (e.g. Sat, 01 Nov) in Morning Briefing

## Objective
Update the Store Owner Daily Operational WhatsApp Briefing (`buildDailyOperationalBriefing` in `src/services/refillService.ts`) to:
1. Include refills due across the **upcoming 7 days** (matching Quick Assist's 7-day lookahead window).
2. Format all due dates with the **Day of the Week** (e.g. `Sun, 01 Nov`, `Mon, 02 Nov`, `Tue, 27 Oct`) so store owners can immediately align with distributor delivery cutoffs and market closures.
3. Add timing badges (`🚨 Overdue`, `📅 Today`, `⏳ Tomorrow`, `⏳ Upcoming`) and itemize staged patient reminder tasks.

---

## Required Changes

### 1. `src/services/refillService.ts` — SQL Query Window (7-Day Lookahead)
- In `buildDailyOperationalBriefing`:
  - Change line 749 (`refillRows`) and line 781 (`refillDetailRows`) from:
    ```sql
    AND DATE(pr.next_refill_date) <= DATE('now', 'localtime')
    ```
    to:
    ```sql
    AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+7 days')
    ```
  - Captures all active refills due today, overdue, and upcoming through the next 7 calendar days.

### 2. `src/services/refillService.ts` — Date & Day-of-Week Formatter
- Replace the date formatter with a calendar-aware formatter that includes the 3-letter weekday:
  ```ts
  const dueDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dueMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatDateWithDay = (ymd: string) => {
    if (!ymd) return 'Due soon';
    const d = new Date(ymd.includes('T') ? ymd : `${ymd.slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) return ymd;
    const day = dueDayNames[d.getDay()];
    const dateNum = String(d.getDate()).padStart(2, '0');
    const month = dueMonthNames[d.getMonth()];
    return `${day}, ${dateNum} ${month}`;
  };
  ```
- Output examples:
  - `Sun, 01 Nov`
  - `Mon, 02 Nov`
  - `Tue, 27 Oct`

### 3. Timing Badges & Section Header
- Header:
  `📋 *REFILL PRESCRIPTIONS (Today & Upcoming 7 Days)*:`
- Timing labels per patient:
  - If `diffDays < 0`: `🚨 Overdue (Due Sat, 24 Oct)`
  - If `diffDays === 0`: `📅 Today (Mon, 26 Oct)`
  - If `diffDays === 1`: `⏳ Tomorrow (Tue, 27 Oct)`
  - If `diffDays >= 2`: `⏳ Due Sun, 01 Nov`
- Retain stock indicators: `(✅ Stock)` or `(⏳ Hold for Stock)`.

### 4. Itemized Staged Reminders & Templates
- Itemize staged customer reminder targets from `automation_notifications` (up to top 8 + overflow count).
- Ensure consistent rendering across `detailed`, `compact`, `checklist`, and `executive` templates.

---

## Verification Plan
1. Test briefing generation on live database: verify patients due in next 7 days appear with day-of-week formatting (e.g. `Sun, 01 Nov`).
2. Run `npm run guardrails` and `npx tsc --noEmit` to ensure exit 0.
3. Update `SMALL_BUG_FIX_PLAN.md` and auto-knowledge graph.

---

## Tasks & Progress Tracking
- [x] Task 1: Expand SQL query in `src/services/refillService.ts` to `+7 days`.
  - *Completed*: Updated `refillRows` (line 749) and `refillDetailRows` (line 781) to `DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+7 days')` using local SQLite date resolution.
- [x] Task 2: Implement `formatDateWithDay` to format dates as `Day, DD Mon` (e.g. `Sun, 01 Nov`, `Mon, 02 Nov`) with timing labels.
  - *Completed*: Created `formatDateWithDay` and `getDueBadge` cleanly constructing local dates with 3-letter weekdays (`Sun`, `Mon`, `Tue`, etc.) and prepending `🚨 Overdue: ` or `Today: ` based on comparison with `todayStr`.
- [x] Task 3: Itemize staged customer reminders in the briefing output.
  - *Completed*: Selected recipient names and phones from `automation_notifications` and itemized up to 5 patient names in `dailyTasks` with an overflow summary.
- [x] Task 4: Run test generation script and verify against live database.
  - *Completed*: Verified output against active database and store production database `G:\AI Pharmacy OS\data\app.db`. For the store's data, `Mr. BHANUAS RAGUNATH JADHAV (Sun, 01 Nov)` and all active special orders rendered with 100% precision.
- [x] Task 5: Verify `npm run guardrails` passes and update knowledge graph.
  - *Completed*: Passed `npx tsc --noEmit` clean; passed `npm run guardrails` (exit code 0); recorded `[Fixed] P2-122` in `SMALL_BUG_FIX_PLAN.md`.