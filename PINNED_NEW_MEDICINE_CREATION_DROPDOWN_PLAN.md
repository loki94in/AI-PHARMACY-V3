# Implementation Plan: Pinned New Medicine Creation in Purchases Dropdown

## Problem Statement
When entering purchases, users frequently search for medicine names that return dozens of similar existing brand matches (e.g. searching "DOLO" returns 40+ variants). Previously, the "Add to Master Database" option was appended at the very bottom of the scroll container, requiring the user to scroll through the entire list to reach the registration button.

The user requested that the **New Medicine Creation section ALWAYS be available and pinned at the top of the dropdown list** in the Purchases bill entry page, so it is instantly accessible without scrolling.

---

## Architectural Design

### 1. Pinned Top Quick-Action Header
* Converted the search results dropdown in `frontend/src/pages/Purchases/index.tsx` into a structured flex container (`flex flex-col overflow-hidden`).
* Placed the New Medicine Creation section as a **sticky/pinned header (`flex-shrink-0 border-b border-glass-border/30 bg-bg/80 backdrop-blur-sm p-2`)** right at the top.
* The header displays:
  * `✨ Register "[typed name]" as New`
  * Subtitle: `Directly add to Master Database with full rates`
  * Shortcut pill: `Alt+N / Click`
  * An emerald `+` icon button that triggers `openAddMedicineModal(index)`.

### 2. Scrollable Search Results Body
* The matching master catalog rows (`searchResults.map(...)`) and original invoice bill name are placed inside a `max-h-60 overflow-y-auto flex-1` container directly underneath the pinned header.
* Arrow key navigation (`ArrowDown`/`ArrowUp`) and `Enter` continue to navigate and select from the search results cleanly.
* When `searchResults.length === 0`, the dropdown shows the live search status and the same prominent registration action.

---

## Pointwise Implementation Tasks

- [x] Task 1: Restructure Purchases Search Dropdown Layout (`frontend/src/pages/Purchases/index.tsx`)
  - Pinned the New Medicine Creation action card permanently at the top of the dropdown container.
  - Wrapped matching items in the scrollable body container.
- [x] Task 2: Keyboard Shortcut & Accessibility
  - Supported `Alt+N` in the input onKeyDown handler and direct click on the pinned action to open `UniversalMedicineEditModal`.
- [x] Task 3: Verification & Guardrails
  - Verified dropdown visual appearance, scroll behavior, and z-index positioning.
  - Ran `npm run guardrails` -> PASS (0 violations).
  - Ran `node scripts/quick-update.mjs` -> Updated 1085 nodes in 3.4s.
- [x] Task 4: Human-in-the-Loop Review
