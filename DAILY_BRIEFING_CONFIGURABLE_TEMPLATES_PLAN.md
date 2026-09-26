# Configurable Daily Operational Task Briefing Templates Implementation Plan

## 1. Overview & Objective

The user reviewed the 4 templates and selected:
1. **Template 4 (Itemized Detail List)** as the **DEFAULT** template for the pharmacy.
2. Save this preference in `app_settings` under key `daily_briefing_template = 'detailed'`.
3. Provide a configuration UI in **Settings → Automation / Notifications** with a **"Send Test Briefing"** button so the pharmacist can switch or test any template at any time.

---

## 2. Template Architecture (Template 4 as Default)

### Default: Template 4 (Itemized Detail List)
- **Header**: Store Status, Date & Day
- **Section 1: Refills Worklist (Next 7 Days)**:
  - Groups by patient name.
  - Lists each medicine name, quantity needed, and stock availability (`✅ Stock` vs `⏳ Hold`).
- **Section 2: Call Tasks**: Pending CRM Call Board count.
- **Section 3: Special / WhatsApp Orders**: Pending customer special requests.
- **Section 4: Inventory Tasks**: Batches expiring this month.
- **Section 5: Staged Messages**: Staged reminders awaiting review.
- **Footer**: Human-in-the-Loop CRM link.

### Additional Configurable Templates
- **Template 1 (`compact`)**: Compact patient worklist without medicine names.
- **Template 2 (`checklist`)**: Prioritized operational to-do checklist with `[ ]` checkboxes.
- **Template 3 (`executive`)**: High-level KPI counts overview.

---

## 3. Implementation Blueprint

### A. Database (`src/database.ts`)
- Seed default setting on boot:
  ```sql
  INSERT OR IGNORE INTO app_settings (key, value) VALUES ('daily_briefing_template', 'detailed');
  ```

### B. Backend Engine (`src/services/refillService.ts`)
- Modularize briefing generation into `buildDailyOperationalBriefing(db, templateKey?: string)`.
- Reads `daily_briefing_template` from `app_settings` with fallback to `'detailed'`.
- Renders the chosen template and enqueues to the store owner's WhatsApp number.

### C. Backend API Endpoint (`src/routes/settings.ts` or `src/routes/refills.ts`)
- `POST /api/settings/send-test-briefing`:
  - Body: `{ template?: 'detailed' | 'compact' | 'checklist' | 'executive' }`
  - Immediately dispatches the test briefing to the store owner's WhatsApp and returns `{ success: true, message: 'Test briefing sent' }`.

### D. Frontend Settings UI (`frontend/src/pages/Settings/index.tsx`)
- In the **Automation / Notifications** tab:
  - Add card **"Morning Operational Briefing Template"**.
  - Dropdown / radio cards for the 4 templates with badges (**Template 4: Itemized Detail List [Default]**).
  - Live text preview box showing how the selected template looks.
  - **"Send Test Briefing"** button to dispatch a live test message immediately with a success toast.

---

## 4. Implementation Checklist & Progress

- [x] **Step 1: Send All 4 Template Variations Directly to WhatsApp**:
  - Rendered all 4 templates with live database data (Refills in 7 days, Call tasks, Special orders, Expiry counts, Staged reminders).
  - Enqueued and dispatched through the WhatsApp pipeline to the store owner's WhatsApp numbers (`918080888041` and `919130558910`).
  - Verified delivery of template samples directly in the WhatsApp chat.
- [x] **Step 2: Backend Template Engine & Endpoints**:
  - Modularized `sendMorningScheduleBriefingToAdmin` and `buildDailyOperationalBriefing` in `src/services/refillService.ts` supporting `'compact'`, `'checklist'`, `'executive'`, and `'detailed'`.
  - Stored `daily_briefing_template = 'detailed'` in `app_settings` via `src/database.ts` and `data/app.db`.
  - Added `POST /api/settings/send-test-briefing` endpoint to test any template on demand or send the currently saved default.
  - Added `GET /api/settings/briefing-templates/preview` endpoint for frontend live previews.
- [x] **Step 3: Frontend Settings UI & Test Button**:
  - In `frontend/src/pages/Settings/index.tsx` (Trigger Schedules tab / Trigger 1: Daily WhatsApp Briefing card):
    - Added **Daily Briefing Template** selector dropdown with clear labels and badges (`Template 4: Itemized Detail List (Recommended Default)`).
    - Added description showing what is included in the selected template.
    - Added **"Send Test Briefing"** button with loading spinner, success toast, and live WhatsApp dispatch.
- [x] **Step 4: Quality & Guardrail Verification**:
  - Verified TypeScript compilation (`tsc --noEmit`).
  - Passed `npm run guardrails` with 0 violations.
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.

---

## 5. Resumption Log for Agents

| Step | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Plan Formulation | Completed | 2026-09-26 11:15 | Designed 4 template formats and Settings UI integration |
| Step 1: Live Dispatch | Completed | 2026-09-26 11:17 | Dispatched all 4 live template samples to owner's WhatsApp |
| Step 2: User Decision | Completed | 2026-09-26 11:21 | User confirmed Template 4 (detailed) as default |
| Step 3: Backend Implementation | Completed | 2026-09-26 11:28 | Database seed, template engine, test briefing endpoints |
| Step 4: Frontend Settings UI | Completed | 2026-09-26 11:30 | Template selector & live test button in Trigger Schedules |
| Step 5: Verification & Guardrails | Completed | 2026-09-26 11:31 | Passed guardrails (exit code 0) & updated knowledge graph |


