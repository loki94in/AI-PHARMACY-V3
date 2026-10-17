# CRM Dropdown Auto-Close — Implementation Plan

> **Scope:** CRM page only (`/crm`) · **Type:** Bug fix plan (no code written yet)
> **Status:** Planned · **Priority:** P2 (UX friction — workaround: click the toggle again)
> **Author:** agent · **Date:** 2026-10-17
> **Binding docs read:** `AGENT_BUG_FIX_RULEBOOK.md`, root `AGENTS.md`, `frontend/AGENTS.md`, `.agents/rules/bug-fix.md`, `AGENT_DATA_FLOW_TREE.md`, `SMALL_BUG_FIX_PLAN.md`

---

## 1. What the user saw (the issue)

On the CRM page, a dropdown/action menu could stay **open ("unfolded")** after the user moved on to something else.

Reported case (CRM → Refills):

1. User selects a patient.
2. User clicks the `⋯` (More) button — the action menu opens with:
   `💤 Snooze +1 Day`, `💤 Snooze +3 Days`, `💤 Snooze +7 Days`, `+ Add Med`, `Fulfill Cycle`, `Delete Schedule`.
3. User **switches to another patient** (clicks a different patient in the list).
4. The `⋯` menu from the previous patient is **still unfolded** on screen.

The user also reported the same "stays open" feeling on other parts of the CRM page.

---

## 2. Current behaviour (workflow + root cause)

### 2.1 Root cause

The menus are plain `absolute`-positioned panels controlled by a local React `useState` flag. They have:

- **No outside-click listener** — nothing listens to `document.mousedown`.
- **No Esc registration** — the app's global Esc fallback (`dismissTopmostOverlay()` in `frontend/src/services/keyboardShortcuts.ts`) deliberately **ignores** them, because they are `.z-dropdown` / `z-30` / `z-20` panels inside a `relative` container, not `.z-modal` / `.z-global-modal` / `[role="dialog"]`, and not `.fixed.inset-0` with `z >= 40`.

Result: the only two ways to close them are (a) clicking one of the panel's own items, or (b) clicking the toggle button again.

### 2.2 Why switching patient leaves it open

The reported menu lives in `frontend/src/pages/CRM/RefillsSection.tsx`:

| Item | State declared | Panel rendered |
|---|---|---|
| `showMoreMenu` — `⋯` Snooze/Add/Fulfill/Delete menu | line **55** | lines **1877–1943** (wrapper `<div className="relative">` at **1878**) |

`selectPatientAndLoadDetails` (≈ line **403**) and the list `load` (≈ line **409**) **never reset** `showMoreMenu`. The panel is inside the shared `{selectedPatient ? (…)}` branch, so it stays mounted when the selected patient changes. The menu is therefore "stuck" on the new patient.

### 2.3 Full CRM-page audit (read-only)

| File | Menu / panel | State | Panel | Outside-click | Esc | Reset on patient/chat switch |
|---|---|---|---|---|---|---|
| `pages/CRM/RefillsSection.tsx` | `showMoreMenu` (`⋯`) | 55 | 1877–1943 | **NO** | **NO** | **NO** ← reported bug |
| `pages/CRM/RefillsSection.tsx` | `showUnlinked` (Not-linked picker) | 50 | 1334 | **NO** | **NO** | **NO** |
| `pages/CRM/RefillsSection.tsx` | `showStagedDetails` (Review Staged) | 104 | 1450 | **NO** | **NO** | **NO** |
| `pages/CRM/RefillsSection.tsx` | `priorityDropdownMedId` (`⭐`) | 190 | 2183 | YES (backdrop 2187) | **NO** (`z-30` < 40) | **NO** |
| `pages/CRM/RefillsSection.tsx` | medicine row dropdown (in Add/Edit modal) | row.`isOpen` | 2831 | **NO** | **NO** | n/a (modal) |
| `pages/CRM/WhatsAppSection.tsx` | `showTemplatePopover` (Quick Message Templates) | 120 | 1052 | **NO** | **NO** | **NO** |
| `pages/CRM/EnquiriesSection.tsx` | `browseSuggestions` (medicine autocomplete) | 38 | 454 | **NO** | **NO** | clears only when list empties |
| `pages/CRM/EnquiriesSection.tsx` | `isNewModalOpen` | — | — | n/a | **NO** (fallback works) | n/a |
| `pages/CRM/SpecialOrdersSection.tsx` | `showPrDropdown` | 226 | 1922 | ✅ YES (234) | ✅ YES (1907) | — |
| `pages/CRM/DistributorMessagesSection.tsx` | *(no dropdown state)* | — | — | — | — | — |
| `pages/CRM/DistributorPrioritySection.tsx` | *(drag-and-drop only)* | — | — | — | — | — |
| `pages/CRM/CustomerCreditSection.tsx` | *(only `viewInvoice` modal, registered)* | — | — | — | — | — |

Note: `pages/CRM/index.tsx` renders sections conditionally (`activeTab === 'refills' && <RefillsSection />`), so **switching CRM tabs unmounts the section** and closes any menu. The failures above are all *within a section* (patient / chat / row switching).

All other app pages were audited separately and are **out of scope** for this fix (a few have similar Esc gaps, tracked separately).

---

## 3. How we want it to behave (target)

Every CRM dropdown/menu/popup must close on **any** of:

1. **Outside click** — clicking anywhere outside the menu.
2. **Esc** — per the frontend "Universal Esc-to-Close Contract".
3. **Context change** — switching patient (Refills), switching chat (WhatsApp), or closing the owning modal.

Keep behaviour unchanged everywhere else. No style, layout, data-flow, or API changes.

---

## 4. Implementation plan (CRM only)

Reuse the **existing** project abstractions — no new dependencies, no new components:

- `useOnClickOutside` → `frontend/src/hooks/useOnClickOutside.ts`
- `useModalEscape` → `frontend/src/services/keyboardShortcuts.ts`

Aligned with `.agents/rules/ponytail.md` (use the installed abstraction before writing new code).

### File 1 — `frontend/src/pages/CRM/RefillsSection.tsx`

| # | Change | Location |
|---|---|---|
| 1 | Import `useOnClickOutside` (`../../hooks/useOnClickOutside`) and `useModalEscape` (`../../services/keyboardShortcuts`) | import block |
| 2 | Add `moreMenuRef`; attach to the `<div className="relative">` wrapper; `useOnClickOutside(moreMenuRef, () => setShowMoreMenu(false))` | ref near state ~55, wrapper 1878, panel 1887 |
| 3 | `useModalEscape(showMoreMenu, () => setShowMoreMenu(false))` | near state |
| 4 | Same outside-click + Esc for `showUnlinked` (50 / 1334) and `showStagedDetails` (104 / 1450) | — |
| 5 | `useModalEscape(priorityDropdownMedId !== null, () => setPriorityDropdownMedId(null))` (backdrop click already exists) | near state 190 |
| 6 | **Reset on patient switch** — in `selectPatientAndLoadDetails` (≈ 403): `setShowMoreMenu(false); setShowUnlinked(false); setShowStagedDetails(false); setPriorityDropdownMedId(null);` | ≈ 403 |
| 7 | Medicine row dropdown in Add/Edit modal (2831): close on Esc and when the modal closes | 2831 |

### File 2 — `frontend/src/pages/CRM/WhatsAppSection.tsx`

- `showTemplatePopover` (120 / 1052): add `useOnClickOutside` + `useModalEscape`, and clear it when `activeChat` changes.

### File 3 — `frontend/src/pages/CRM/EnquiriesSection.tsx`

- `browseSuggestions` (38 / 454): add `useOnClickOutside` + `useModalEscape` (it already clears when the query empties).
- `isNewModalOpen`: register `useModalEscape` so Esc closes it directly (not only via the global fallback).

### Explicitly NOT changed

- No colour/theme/Tailwind-class changes (Day-mode rules untouched).
- No data fetching, query keys, SSE, or API changes.
- No change to `showPrDropdown` in `SpecialOrdersSection.tsx` (already correct).
- No change to the global Esc fallback in `keyboardShortcuts.ts`.

---

## 5. Verification (must all pass)

1. CRM → Refills → select patient → open `⋯` → **click a different patient** → menu closes. *(today it stays)*
2. `⋯` open → click blank area → closes.
3. `⋯` open → press **Esc** → closes.
4. Same for the "Not linked" card, the `⭐` priority dropdown, and the staged-review panel.
5. CRM → WhatsApp → open Quick Message Templates → click elsewhere → closes.
6. CRM → Enquiries → type 2+ chars → suggestion list opens → click elsewhere → closes.
7. Adjacent smoke test: `⋯` → **Snooze +1 Day** still works; `+ Add Med`, `Fulfill Cycle`, `Delete Schedule` still work; the real Snooze toast still appears.
8. `npx tsc --noEmit` clean.
9. **`npm run guardrails`** exits `0`.
10. `node scripts/quick-update.mjs` (knowledge graph sync).

---

## 6. Post-fix documentation

- Add a new **P2** entry to `SMALL_BUG_FIX_PLAN.md` (Open → Fixed) using the Section 8 template: observed symptom, root cause, how fixed, priority, what not to touch, verified by.
- No `AGENTS.md` change needed — the "Universal Esc-to-Close Contract" already exists; this fix applies it to the CRM page.

---

## 7. Mandatory 8-point audit summary (to fill after implementation)

1. Existing dummy/fallback logic found → None (UI-only bug).
2. What was removed or changed → *(pending)*.
3. New dummy/fallback logic introduced → None.
4. Missing-data handling → Not applicable (no data touched).
5. Error/fallback behaviour → Menus now close on outside-click / Esc / context change; no failure path added.
6. Auto-created records or values → None.
7. Data source and traceability → Not applicable (no data read or written).
8. Remaining risk / needs review → Other pages have the same Esc gap (Inventory, Investigation, Returns, CustomerPortal, Database) — tracked separately, not fixed here.
