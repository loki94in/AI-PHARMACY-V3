# Implementation Plan: Dropdown Keyboard Navigation Auto-Scroll & High-Visibility Selection

**Plan Identifier**: `DROPDOWN_KEYBOARD_NAVIGATION_AUTO_SCROLL_PLAN.md`  
**Status**: Completed & Verified  
**Governing Rules**: AGENTS.md, DOX Framework, Rule 5, Rule 6 (Human-in-the-Loop), Rule 7, Rule 10.

---

## 1. Root Cause Analysis

1. **DOM Focus Stays on `<input>`**:
   - In all search boxes (POS top search, POS cart row inline search, Purchases master database search, Live Cart Add Modal, Quick Order Modal, Returns), the `<input>` element holds browser focus so the operator can type continuously.
2. **Virtual Highlight without DOM Scroll**:
   - Pressing `ArrowUp` or `ArrowDown` only changes a React state number (`searchHighlightIndex`, `activeSuggestionIndex`, `rowSearchHighlightIndex`).
   - The dropdown item gets a CSS class change (`data-highlighted="true"`), but browsers never scroll an `overflow-y-auto` container automatically without `.scrollIntoView()`.
3. **Container Viewport Clamping & Out-of-Stock Dropouts**:
   - The dropdown containers are clamped with fixed heights (`max-h-80`, `max-h-56`, `max-h-64`) and `overflow-y-auto`.
   - Previous partial implementations failed because out-of-stock items did not carry `data-highlighted="true"`, causing `querySelector` to return `null` and freeze scrolling. In modals (LiveCartAddModal, QuickOrderModal, CRM), auto-scroll was completely absent.
4. **Subtle Visual Feedback**:
   - Existing styles like `bg-primary/10` lacked high contrast in light/day and dark modes.

---

## 2. Completed Architecture & Technical Implementation

### Reusable Hook: `useDropdownAutoScroll`
- Path: `frontend/src/hooks/useDropdownAutoScroll.ts`
- Uses `requestAnimationFrame` to ensure DOM elements are committed before executing `scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })`.
- Provides 0ms latency with no animation lag during rapid keyboard arrow navigation.
- Preserves native mouse wheel, touchpad, and touch scrolling.

### High-Visibility Selection Styling
- Highlighted items rendered with `bg-primary/20 border-l-4 border-primary ring-1 ring-primary/40 font-bold text-text`.
- Clear `↵ Enter` / `↵ Select` action chip shown on the right side of the active medicine row.

---

## 3. Atomic Task Checklist

- [x] **Task 1: Create `useDropdownAutoScroll` Hook**
  - Path: `frontend/src/hooks/useDropdownAutoScroll.ts`
  - Completed: Verified `requestAnimationFrame` + `scrollIntoView({ block: 'nearest', behavior: 'auto' })`.

- [x] **Task 2: Upgrade POS Medicine Search (Top Bar & Cart Row)**
  - File: `frontend/src/pages/POS/index.tsx`
  - Completed: Wired `useDropdownAutoScroll` to `searchResultsRef` and `rowSearchResultsRef`.
  - Added high-contrast highlight and `↵ Enter` action chip.
  - Added `data-highlighted` to out-of-stock items to prevent scroll freeze.

- [x] **Task 3: Upgrade POS Patient & Doctor Dropdowns**
  - File: `frontend/src/pages/POS/index.tsx`
  - Completed: Wired `useDropdownAutoScroll` to `patientSuggestionsRef` and `doctorSuggestionsRef`.
  - Added `border-l-4` indicator and `↵ Enter` chip.

- [x] **Task 4: Upgrade Purchases Dropdowns**
  - File: `frontend/src/pages/Purchases/index.tsx`
  - Completed: Wired `useDropdownAutoScroll` to `searchResultsRef`, `batchDropdownRef`, and `distributorDropdownRef`.
  - Placed `batchDropdownRef` directly on the scrollable container.
  - Upgraded highlighted row with high-contrast `↵ Enter` badge.

- [x] **Task 5: Upgrade LiveCartAddModal & QuickOrderModal**
  - Files: `frontend/src/components/LiveCartAddModal.tsx`, `frontend/src/components/QuickOrderModal.tsx`
  - Completed: Added `suggestionsListRef` and wired `useDropdownAutoScroll`.
  - Added `data-highlighted="true"` and `↵ Enter` chip to active list items.

- [x] **Task 6: Upgrade Returns & CRM Dropdowns**
  - Files: `frontend/src/pages/Returns/index.tsx`, `frontend/src/pages/CRM/index.tsx`
  - Completed: Added `prDropdownRef` in CRM and updated Returns `searchResultsRef` with `useDropdownAutoScroll`.
  - Added `data-highlighted="true"`, high-contrast border, and `↵ Enter` badges.

- [x] **Task 7: System Verification & Guardrails**
  - Completed: `npm run guardrails` passed with code 0 (`tsc --noEmit` OK, no violations).
  - Completed: `node scripts/quick-update.mjs` synchronized knowledge graph (1078 files scanned).
