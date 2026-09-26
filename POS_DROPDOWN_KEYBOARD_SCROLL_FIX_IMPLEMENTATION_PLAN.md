# POS Dropdown Keyboard Navigation & Auto-Scroll Fix Implementation Plan

**Tracking File:** `POS_DROPDOWN_KEYBOARD_SCROLL_FIX_IMPLEMENTATION_PLAN.md`  
**Status:** Completed ✅  
**Objective:** Ensure that when navigating through medicine search dropdown lists in POS (both Header Search and Inline Table Row Search) using Arrow Up / Arrow Down keys, the active/highlighted medicine is always kept fully visible by automatically scrolling the scrollable container.

---

## 1. Problem Description & Root Cause Analysis

### What the user observed:
When typing in the POS search input and navigating the search results dropdown using the keyboard arrow keys (`ArrowDown` / `ArrowUp`):
- The arrow keys change the selected item in memory.
- However, the dropdown list does **not scroll**, so once navigation reaches past the 3rd or 4th item, the highlighted medicine falls below the visible area (`max-h-72` or `max-h-56`) and becomes invisible. The cashier has no visual indication of which item is selected unless they manually reach for the mouse.

### Root Cause:
1. **Container Ref Mismatch on Nested Elements:**
   - In [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx), both the Header Search dropdown (line 4702) and Table Row Search dropdown (line 5374) have a **pinned top header** (`✨ Register as New Medicine (Alt+N)`).
   - Because of this pinned header, the dropdowns are structured as an outer flex wrapper (`overflow-hidden`) containing:
     - The pinned header (`flex-shrink-0`).
     - An inner scrollable list (`<div className="max-h-72 overflow-y-auto flex-1 ...">` or `<div className="max-h-56 overflow-y-auto flex-1 ...">`).
   - The React refs (`searchResultsRef` and `rowSearchResultsRef`) are attached to the **outer flex wrapper** (`overflow-hidden`), NOT the inner scrollable element (`overflow-y-auto`).
2. **Hook Execution on Non-Scrollable Container:**
   - In [`frontend/src/hooks/useDropdownAutoScroll.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/useDropdownAutoScroll.ts), the hook calls:
     ```ts
     container.scrollTo({ top: ..., behavior });
     ```
   - Since `container` points to the outer container which has `overflow: hidden`, the browser completely ignores `.scrollTo()` because the element has no scrollable viewport.
   - The inner container (`overflow-y-auto`) never receives any scroll command, keeping its `scrollTop` stuck at `0`.
3. **Purchases Page Similarity:**
   - The same architectural layout exists in [`frontend/src/pages/Purchases/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx#L3854), where `searchResultsRef` is also on the outer wrapper instead of the inner scrollable container.

---

## 2. Senior-Level Architectural Solution

We implement a two-tiered, rock-solid fix:

### Tier 1: Universal Auto-Detection in `useDropdownAutoScroll` Hook
Make [`frontend/src/hooks/useDropdownAutoScroll.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/useDropdownAutoScroll.ts) resilient to any DOM hierarchy:
- When given `containerRef` and finding the highlighted element `activeEl`, the hook will dynamically resolve the **actual scrollable element** (`scrollContainer`):
  1. Ascend from `activeEl.parentElement` up to `containerRef.current` looking for `overflowY: auto` or `scroll`.
  2. If none is found, check if `containerRef.current` itself is scrollable.
  3. If `containerRef.current` is `overflow: hidden`, inspect its descendants for `.overflow-y-auto` or `[data-scrollable="true"]`.
- Compute relative coordinates (`activeRect` vs `scrollContainerRect`) against that true scroll container and call `scrollContainer.scrollTo(...)`.
- This ensures **zero breakage** anywhere in the app, regardless of whether a ref is attached to an outer card or an inner scroll viewport.

### Tier 2: Explicit Ref Alignment & Attributes in `POS/index.tsx`
- Ensure `searchResultsRef` and `rowSearchResultsRef` in [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx) are attached directly to the scrollable container (`max-h-72 overflow-y-auto` and `max-h-56 overflow-y-auto`), or marked with `data-scrollable="true"`.
- Ensure all search result items (both in-stock and out-of-stock items) properly carry `data-highlighted={isHighlighted ? "true" : "false"}` and maintain high-visibility highlight contrast (`bg-primary/20 border-l-4 border-primary text-text font-bold`).

---

## 3. Step-by-Step Implementation Tasks

- [x] **Task 1: Upgrade `useDropdownAutoScroll` hook for deep scroll container resolution**
  - File: [`frontend/src/hooks/useDropdownAutoScroll.ts`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/hooks/useDropdownAutoScroll.ts)
  - Added `resolveScrollContainer(activeEl, rootContainer)` to resolve the real scrollable element.
  - Computed scroll deltas relative to that container.
  - Preserved single-key smooth scrolling and holding-key instant auto-scrolling (`timeDelta < 130ms`).
  - Added reset to `top: 0` when navigating to `highlightIndex === 0`.

- [x] **Task 2: Align container refs in POS Header Search & Row Search**
  - File: [`frontend/src/pages/POS/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/POS/index.tsx)
  - Attached `ref={searchResultsRef}` and `data-scrollable="true"` to the inner scroll container at line 4753.
  - Attached `ref={rowSearchResultsRef}` and `data-scrollable="true"` to the inner scroll container at line 5411.
  - Verified out-of-stock item highlighting retains `data-highlighted` so it also scrolls into view if selected.

- [x] **Task 3: Align container ref in Purchases Medicine Search**
  - File: [`frontend/src/pages/Purchases/index.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/Purchases/index.tsx)
  - Attached `ref={searchResultsRef}` and `data-scrollable="true"` to the inner scroll container at line 3886.

- [x] **Task 4: Run Verification & Guardrails**
  - Ran `npm run guardrails` (`tsc --noEmit` clean OK and performance guardrails passed).
  - Ran `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
  - Documented resolution in `SMALL_BUG_FIX_PLAN.md` under ticket `P2-40`.
