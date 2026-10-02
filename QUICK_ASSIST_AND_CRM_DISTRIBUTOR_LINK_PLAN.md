# Implementation Plan: Unified Quick Assist, CRM Distributor Linking & Development Database Isolation

**File:** `QUICK_ASSIST_AND_CRM_DISTRIBUTOR_LINK_PLAN.md`  
**Status:** COMPLETE ✅ (All Tasks Implemented & Guardrails Verified)  
**Date:** 2026-10-02  

---

## 1. Overview & Objectives

This implementation delivers a unified fix addressing both the UI/UX issues and the development environment database isolation in one coordinated release:

1. **Development vs. Production Database Isolation**:
   - Ensure `npm run dev` operates on an isolated sandbox database (`data/app.dev.db`), completely decoupled from the live/installed production database (`data/app.db`).
   - If `app.dev.db` does not exist on first launch in development, automatically clone an initial snapshot from `app.db` (auto-sandbox clone) so testing has realistic medicines and distributors.
   - Zero database lock contention (`SQLITE_BUSY`) between the installed app and the development server.
   - Production data is 100% protected against development mutations, test sales, or rollbacks.
   - Provide an optional `npm run db:clone-prod` script for on-demand sandbox resets.

2. **Quick Assist Action Buttons Ergonomics (`Layout.tsx`)**:
   - Eliminate button squishing and text collision (`MAN:JAL:`, `D RE`, `MPL`) in the Quick Assist drawer.
   - Implement a clean **2-Tier Layout**:
     - **Tier 1 (Primary Action Bar)**: [Mark Ready / Resend Ready] (flex-1) + [Complete / Bill in POS] (flex-1) side-by-side with clear icons and full labels.
     - **Tier 2 (Secondary Controls Bar)**: [Auto ON / Manual] toggle pill + [Edit] + [Cancel].

3. **CRM Medicine Link Modal & Candidate Display (`MedicineLinkModal.tsx`)**:
   - Structured 2-line layout displaying:
     - **Line 1**: Medicine Name + Pack + `[Company/Manufacturer Tag]`.
     - **Line 2**: **Distributor Name** (bold) · PTR (₹ Rate) · MRP (₹) · Bought count (`bought Nx`) · Stock status badge (`stock N` / `out of stock`).
   - Display Company, Rate, and Distributor details also in the Left Column (Priority list).
   - Add a **Top Purchased Distributors** quick-filter strip derived from purchase history (`loadDistributorRanks()`).

4. **Direct CRM Priority Distributor Selector (`CRM/index.tsx`)**:
   - Replace the static link button in the CRM patient medicine row with a **Smart Distributor Priority Selector**.
   - Displays the active #1 priority distributor.
   - Clicking opens an inline dropdown listing all linked distributors (`#1`, `#2`, `#3`) with 1-click priority switching (0ms optimistic update, saved to backend).
   - Includes a "+ Link / Manage More" option to open the full `MedicineLinkModal`.

---

## 2. Root Cause Analysis

### Database Conflict
- In `src/config/index.ts`:
  ```ts
  get dbPath() { return process.env.DB_PATH || path.join(appDataDir, 'data', 'app.db'); }
  ```
  Both packaged production (`PharmacyOS.exe`) and unpackaged development (`npm run dev`) default to the exact same file: `data/app.db`.
- When both are running on the machine, or when dev tests are performed, they lock the same SQLite file, causing WAL collisions, transaction locks, and risking live pharmacy data corruption.

### Quick Assist Buttons Conflict
- The action buttons in `Layout.tsx` are crammed into a single `flex items-center flex-wrap gap-1.5 min-w-0` row.
- `min-w-0` on `flex-1` buttons allows flexbox to shrink buttons down to 20–30px width.
- `whitespace-nowrap` without `overflow-hidden` causes labels to spill out of buttons and collide horizontally.

### CRM Medicine Link Modal Gap
- `RefillCartCandidate` has `company`, `rate`, and `mrp`, but line 238 in `MedicineLinkModal.tsx` omits `company`.
- Pharmacists cannot distinguish manufacturers (e.g. Sun Pharma vs Cipla) and lack a quick-filter for the pharmacy's core distributors.

---

## 3. Step-by-Step Task Breakdown

### Task 0: Database Isolation & Auto-Sandbox Provisioning
- [x] In `src/config/index.ts`:
  - Enhance `config.dbPath` getter:
    - If `process.env.DB_PATH` is explicitly set, use it.
    - If `!isPackagedApp() && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)`: default to `path.join(appDataDir, 'data', 'app.dev.db')`.
    - Otherwise (packaged production): default to `path.join(appDataDir, 'data', 'app.db')`.
- [x] In `src/database/connection.ts` (inside `getConnection()` initialization):
  - If target DB is `app.dev.db` and the file does NOT exist on disk:
    - Check if `data/app.db` exists.
    - If `data/app.db` exists, copy it to `data/app.dev.db` (auto-sandbox clone) so dev has complete realistic sample data immediately.
    - If not, allow `ensureSchema` to create and seed it cleanly.
    - Log: `[Database] Auto-provisioned development sandbox: data/app.dev.db`.
- [x] In `package.json`:
  - Add script: `"db:clone-prod": "node scripts/clone-prod-to-dev-db.mjs"` for on-demand sandbox resets.
  - Verified `data/*.db*` is ignored in `.gitignore`.

### Task 1: Redesign Quick Assist Card Action Footer (`Layout.tsx`)
- [x] Refactor the card footer in `QuickAssistSidebar` (lines ~4270-4405) from a single crowded flex row into a structured 2-tier layout:
  - **Tier 1 (Row 1)**: Primary operational buttons side-by-side:
    - If status === 'Ready': `[Resend Ready • N]` (bg-sky-600) + `[Complete]` (bg-purple-600).
    - If status === 'Ordered': `[Mark Ready]` (bg-sky-600) + `[Complete]` (bg-purple-600).
    - If status === 'Pending': `[Mark Ordered]` (bg-emerald-600) + `[Complete]` (bg-purple-600).
    - Both buttons use `flex-1 h-7 text-[10px] font-bold uppercase rounded-lg justify-center gap-1.5 shadow-xs`.
  - **Tier 2 (Row 2)**: Secondary controls row:
    - `[Auto ON / Manual]` toggle pill (when status === 'Ready').
    - `[Edit]` button with `Edit3` icon and clear label.
    - `[Cancel]` button with red subtle styling.
- [x] Tested with narrow drawer width: zero text clipping, zero overlap, and pristine light/dark mode compliance.

### Task 2: Enhance Medicine Candidate Display in `MedicineLinkModal.tsx`
- [x] In the right column candidate list:
  - **Line 1**:
    - Product Name (bold `text-[11.5px] text-text`)
    - Packaging in parentheses (`text-muted text-[10.5px]`)
    - Company / Manufacturer badge (`px-1.5 py-0.5 rounded bg-bg3 text-[9.5px] font-medium text-text border border-border`)
  - **Line 2**:
    - Distributor Name in bold (`text-[10px] font-semibold text-text`)
    - PTR: `PTR ₹${c.rate}` (font-mono)
    - MRP: `MRP ₹${c.mrp}` (font-mono)
    - Purchase count: `bought ${bought(c.storeName)}×`
    - Stock badge: `stock ${c.stock}` (green) or `out of stock` (red)
- [x] In the left column (Saved Links in Priority Order):
  - Include company badge and PTR/MRP context.
  - Maintain the up/down reorder buttons and remove button.

### Task 3: Top Distributors Quick-Filter Chips in `MedicineLinkModal.tsx`
- [x] Load top distributors from `ranks` (`DistributorRank[]`).
- [x] Render a horizontal scrollable strip of top distributor chips (`Frequent: All, Distributor (Nx)`) below the search bar.
- [x] Clicking a chip filters the candidate list to that distributor or highlights matching candidates.
- [x] Clicking "All" clears the distributor filter.

### Task 4: CRM Table Direct Priority Distributor Dropdown (`pages/CRM/index.tsx`)
- [x] Update the `med.medicine_id` link button in `CRM/index.tsx`:
  - If no distributors linked: shows `+ Link distributor` button (opens `MedicineLinkModal`).
  - If 1 distributor linked: shows `🔗 ${distributor}` badge with an edit/link icon.
  - If multiple distributors linked:
    - Displays active #1 priority distributor (`⭐ ${distributor}`).
    - Clicking the dropdown arrow opens an inline dropdown showing all linked distributors with their rank (#1, #2, #3).
    - Clicking any distributor in the dropdown immediately calls `api.saveMedicineLinks()` with that distributor moved to index 0, updating state optimistically (0ms latency).
    - Includes a "+ Link / Manage More Distributors…" option to open `MedicineLinkModal`.

### Task 5: Verification & Safety Guardrails
- [x] Verified `npm run guardrails` passes with 0 violations (speed architecture and theme rules intact).
- [x] Ran `node scripts/quick-update.mjs` to keep the knowledge graph synchronized (1191 nodes).
- [x] Validated theme compliance (Day/Night modes) using semantic Tailwind tokens.
- [x] Ensured human-in-the-loop confirmation is preserved for all status transitions and distributor priorities.

---

## 4. Execution State & Checkpoint
- **Status:** COMPLETE ✅ (All tasks implemented and verified)
- Dev database isolated to `data/app.dev.db` (auto-sandbox active with 89,500 medicines).
- Quick Assist action buttons updated to 2-tier layout without text clipping.
- Medicine Link modal and CRM table updated with company, PTR/MRP, and 1-click priority dropdown.
