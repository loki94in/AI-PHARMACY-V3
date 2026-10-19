# Implementation Plan - CRM "Link Distributor" Popup Distributor Name Visibility

## 1. Root Cause Analysis
In `frontend/src/components/MedicineLinkModal.tsx`:
1. **Live Candidate Search Results (Line 329–330)**:
   - The container `<div className="flex items-center gap-1.5 text-[10px] text-muted truncate mt-0.5">` enforces single-line `nowrap` + `truncate`.
   - The distributor name `<span className="font-semibold text-text truncate">{c.storeName}</span>` is squeezed against secondary badges (`Unmapped`, `bought X×`, `PTR ₹...`, `MRP ₹...`, `scheme`).
   - Long distributor names (e.g. "Mahavir Pharma Distributors", "Poona Medical Agency") get severely cut off with ellipsis.
2. **Left-Hand Priority Linked List (Line 197–198)**:
   - `<span className="font-bold text-text truncate">{p.storeName}</span>` is truncated on a single line within the narrower 2-column sidebar without word-wrapping or a tooltip.
3. **Frequent Filter Chips (Line 281)**:
   - `<span className="truncate max-w-[120px]">{d.name}</span>` hard-caps distributor names at 120px.

---

## 2. Proposed Surgical Changes (Target File: `frontend/src/components/MedicineLinkModal.tsx` ONLY)
1. **Live Candidate Results List**:
   - Change container to `flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] text-muted mt-0.5`.
   - Display `<span className="font-semibold text-text" title={c.storeName}>{c.storeName}</span>` without truncation squishing so the complete name is fully visible and secondary details wrap naturally if needed.
2. **Left-Hand Priority Linked List**:
   - Allow distributor name to wrap cleanly (`break-words font-bold text-text leading-tight`) and provide `title={p.storeName}` so the full name is completely visible.
3. **Frequent Filter Chips**:
   - Expand `max-w-[120px]` to `max-w-[220px]` with `title={d.name}` so full names are visible while maintaining smooth horizontal chip scroll.

---

## 3. Strict Scope & User Constraints
- Do not modify any other part of the modal or CRM page.
- Touch ONLY `frontend/src/components/MedicineLinkModal.tsx`.
- Comply with Rule 5: Wait for user to confirm with single-word "IMPLEMENT" before writing/editing any source code files.

---

## 4. Verification Plan
1. **TypeScript & Guardrails Check**:
   - Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
2. **Knowledge Graph**:
   - Run `node scripts/quick-update.mjs`.
3. **UI Verification**:
   - Verify that long distributor names render fully without premature truncation in the modal.

---

## 5. Tasks Status
- [x] Task 1: Update `frontend/src/components/MedicineLinkModal.tsx` for distributor name visibility.
  - **Completed**: Adjusted candidate results list with `flex-wrap gap-x-1.5 gap-y-0.5` without rigid truncation, added `break-words leading-tight` to left linked distributor names, and replaced `max-w-[120px]` on frequent filter chips with `whitespace-nowrap font-medium`. Added `title` tooltips across all distributor name elements.
- [x] Task 2: Run performance guardrails and knowledge graph update.
  - **Completed**: `npm run guardrails` passed (exit code 0, 0 violations, clean TypeScript compilation). `node scripts/quick-update.mjs` executed cleanly.
