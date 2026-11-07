# Market & Store Calendar Redesign Specification & Implementation Plan

> **Design Paradigm**: Apple Human Interface Principles (Fluidity, Direct Manipulation, Hierarchy, Craft) adapted for CPU-safe local rendering.  
> **Review Standard**: EGM (Elephant-Goldfish) Review Protocol + DOX Contract Compliance.  
> **Target Components**: 
> 1. `frontend/src/components/ClosureCalendarModal.tsx` (Main Calendar Dialog)
> 2. `frontend/src/components/PharmarackCartCalendar.tsx` (Calendar Bar & Control Surface)
> 3. `frontend/src/components/MarketClosureNoticeModal.tsx` (Multi-Language Patient Notices: EN / HI / MR)
> 4. `frontend/src/utils/indianHolidays.ts` (Consolidated Single Source of Truth for Holidays)
> 5. `frontend/src/components/ClosureStockBufferModal.tsx` (Stock Buffer Checklist)

---

## 1. Executive Summary & Purpose

The **Market & Store Calendar** manages two independent operational dimensions for the pharmacy:
1. **Market Closures (Wholesale/Distributor)**: When distributor hubs (Pharmarack/bazaars) are closed (Sundays, trade strikes, regional holidays). Counter sales continue from shelf stock, but distributor dispatches are paused.
2. **Store Closures (Retail Pharmacy Counter)**: When the physical chemist counter itself is closed (store weekly off, vacations, renovations). Counter sales and deliveries are paused.

### Redesign Objectives & Zoom Out Simplifications
* **Prune Over-Engineering**: Direct manipulation in the calendar grid (simple single taps) replaces complex range steppers.
* **Orthogonal State Decoupling**: Market Closure and Store Counter Closure are independent booleans, not mutually exclusive modes. Sundays are immutably locked as "Market Closed" while keeping Store Counter toggleable.
* **Unified Holiday Data**: Consolidate scattered holiday arrays into a single authoritative `indianHolidays.ts`.
* **Trilingual Patient Communication**: Provide seamless 3-language WhatsApp closure notice templates (**English**, **हिंदी / Hindi**, **मराठी / Marathi**) with instant Apple-style segmented switching.

---

## 2. Apple Design Translation (CPU-Safe Desktop Contract)

Adhering strictly to repository performance guardrails (`electron/main.ts` SwiftShader CPU rendering, no `backdrop-filter`):

### A. Surface Architecture & Materials
* Base dialog in `bg-bg` with crisp `border-border` and elevation `shadow-2xl`.
* Floating header and control cards in solid semantic containers (`bg-bg2`, `border-border`).
* Clean separation of visual regions without heavy blur filters.

### B. Direct Tactile Feedback
* Instant touch/click depression: `active:scale-[0.97] transition-transform duration-100 ease-out` on date cells and segmented controls.
* Visual selection ring around active date with Apple-style smooth accent highlight.

### C. Orthogonal Status Inspector Card
Selecting any date reveals an anchored Inspector Card with two dedicated, tactile operational switches:
1. **Market / Distributor Dispatch**:
   - Sundays: locked with `Every Sunday — Automatic Market Pause`.
   - Other days: single-click toggle with truck icon and clear explanatory impact.
2. **Store Counter Operations**:
   - Single-click toggle with store icon (Open vs. Counter Closed).

### D. Trilingual Patient Notices (English, Hindi, Marathi)
In `MarketClosureNoticeModal.tsx`:
* Apple-style segmented pill selector: `[ English ]` | `[ हिंदी (Hindi) ]` | `[ मराठी (Marathi) ]`.
* Switching languages instantly swaps the message template and live preview to natural, professional phrasing.
* Maintains dynamic placeholder interpolation (`{{PATIENT_NAME}}`, `{{ORDER_REF}}`, `{{MEDICINES}}`, `{{PAUSED_DATE}}`, `{{NEXT_WORKING_DATE}}`, `{{NEXT_DELIVERY_TIME}}`).

---

## 3. Human-in-the-Loop Protocol (Rule 6 Compliance)

* **Pre-Send Review**: Setting any closure date automatically calculates affected orders and presents the `MarketClosureNoticeModal`.
* **Pharmacist Authority**: Pharmacist reviews the patient list, edits language or delivery date/slot, unchecks any customer if needed, and approves the send.
* **Stock Buffer Check**: Consecutive closures (≥ 2 days) trigger the interactive `ClosureStockBufferModal` so the pharmacist can order chronic buffer medicines before cutoffs.

---

## 4. Architectural Boundaries & Guardrails

* **Zero GPU Dependencies**: No `backdrop-filter`. Native `overflow-x-auto scroll-smooth` for horizontal date scrolling.
* **Semantic Tailwind Tokens**: `bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`, `border-glass-border`.
* **State Synchronization**: All updates sync with `/settings/save` and broadcast via `refresh-pharmarack-cart` SSE/custom events.

---

## Detailed Implementation Plan

### Stage 1: Consolidate Holiday Reference Module
1. Create `frontend/src/utils/indianHolidays.ts`:
   - Combine fixed national festivals, moving lunar festivals, and 2025–2027 calendar holidays into one shared dataset.
   - Export helper functions: `getHolidayName(ymd)`, `isFixedHoliday(ymd)`, `LUNAR_FESTIVALS`.

### Stage 2: Redesign `ClosureCalendarModal.tsx`
1. **Header & Store Weekly Off**:
   - Apple-style segmented day picker for Store Weekly Off (`None`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`).
2. **Calendar Grid**:
   - Clean, optical aspect-ratio date cells with tactile `:active` compression.
   - High-contrast visual distinction: Amber for Market Pause, Rose for Store Off, Purple badge for Festival, Sky ring for Today.
3. **Inspector Surface**:
   - Dual orthogonal switches: Market Dispatch switch (Sunday auto-locked) and Store Counter switch.
   - Occasion selector with lunar festival chips and custom text input.

### Stage 3: Enhance `MarketClosureNoticeModal.tsx` for Trilingual Notices
1. Add Apple-style segmented language selector (`EN` | `HI` | `MR`).
2. Implement pre-translated templates for English, Hindi, and Marathi with full placeholder support.
3. Live preview dynamically renders the selected language with customer medicine details.

### Stage 4: Refactor Calendar Strip in `PharmarackCartCalendar.tsx`
1. Update Market / Store Closures trigger button with polished status badges.
2. Align operating hours, order cutoff, and delivery window inputs.
3. Ensure kinetic horizontal date strip uses consolidated holiday colors.

### Stage 5: Verification & Zero-Bugs Gate
1. `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
2. `npx tsc --noEmit` check.
3. Test Hindi, Marathi, and English template rendering and preview.
4. Auto-update knowledge graph (`node scripts/quick-update.mjs`).

---

## Tasks & Progress Tracking

- [x] **Task 1: Spec Alignment & EGM Review Sign-off**
  - Incorporated multi-language requirements and Zoom Out review findings.
  - User issued "impliment" directive.
- [x] **Task 2: Create Shared `frontend/src/utils/indianHolidays.ts`**
  - Created centralized holiday dictionary, fixed/lunar festival definitions, and helper function `getHolidayName`.
- [x] **Task 3: Redesign `ClosureCalendarModal.tsx`**
  - Replaced wrap-around buttons with tactile Apple-style segmented Weekly Off pill bar.
  - Implemented dual orthogonal operation switches: Market Dispatch (Sunday auto-locked) and Store Counter Operations.
  - Implemented tactile cell micro-interactions (`active:scale-95 duration-100`) and high-contrast status markers.
- [x] **Task 4: Implement Trilingual Notice Support in `MarketClosureNoticeModal.tsx`**
  - Added dedicated professional templates for English, हिंदी (Hindi), and मराठी (Marathi).
  - Integrated Apple-style segmented language selector (`EN` | `HI` | `MR`) with live preview and multi-day span formatting.
- [x] **Task 5: Refactor Calendar Bar in `PharmarackCartCalendar.tsx`**
  - Integrated `getHolidayName` to unify occasion data between bar and modal.
  - Added tactile feedback to Market / Store Closures trigger and today jump buttons.
- [x] **Task 6: Guardrail & Knowledge Graph Verification**
  - Verified `npm run guardrails` passed with code 0 (`tsc --noEmit` OK, zero violations).
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.
