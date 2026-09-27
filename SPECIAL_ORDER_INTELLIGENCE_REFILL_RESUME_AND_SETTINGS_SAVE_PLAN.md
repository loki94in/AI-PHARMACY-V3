# Implementation Plan: Special Order WhatsApp Intelligence, Refill/Order Draft Resume, Settings Ctrl+S Save & Fullscreen Launch

## Objective
Implement 4 key capabilities requested by the user:
1. **Desktop App Fullscreen Boot & F11 Toggle**: Launch app in borderless full-screen mode by default without window titlebars; support F11 toggle to windowed mode and back.
2. **Global Ctrl + S Settings Save**: Enable Ctrl+S keyboard shortcut inside `Settings` to instantly save any modified configuration in the active tab without having to manually locate the save button.
3. **Refill & Special Order Modal Draft Persistence (Resume Workflow)**: Preserve unsubmitted user inputs when closing or exiting the "Add Refill" and "Book Special Order" modals so the pharmacist can seamlessly resume their work without data loss.
4. **Special Order Patient Reorder & WhatsApp Chat Intelligence**: Automatically detect the patient's past special orders and relevant incoming WhatsApp chat messages upon entering their phone/name in the Special Order modal. Enable 1-click reorder and extraction of requested medicines from patient chats with full human-in-the-loop review and approval.

---

## Tasks

- [x] **Task 1: Desktop App Borderless Fullscreen Launch & F11 Toggle**
  - Updated `src/utils/chromeBrowser.ts` to launch Chrome/Edge with `--start-fullscreen` by default, eliminating OS window titlebars/borders, with environment variable override (`APP_WINDOW_MODE=maximized`).
  - Added universal F11 handler in `frontend/src/components/Layout.tsx` supporting standard fullscreen API toggle (`document.documentElement.requestFullscreen()` / `exitFullscreen()`).
  - Documented and registered `F11: Toggle Full-Screen / Windowed Mode` in `frontend/src/services/keyboardShortcuts.ts`.

- [x] **Task 2: Ctrl + S Keyboard Shortcut in Settings**
  - Connected `shortcutEvent.subscribeSave()` inside `frontend/src/pages/Settings/index.tsx`.
  - Wired save triggers for all tabs: `StoreProfileTab`, `IntegrationsCredentialsTab`, `TriggerSchedulesTab`, and `OrderTimingTab`.
  - Enabled optional parameter `handleSaveIntegrations(e?: React.FormEvent)` so programmatic shortcut triggers execute cleanly.
  - Provided immediate visual confirmation toasts and TanStack query cache invalidation on save.

- [x] **Task 3: Refill & Special Order Draft Persistence (Resume on Close)**
  - Added auto-save draft persistence to `RefillsSection` modal in `frontend/src/pages/CRM/index.tsx` using `localStorage` key `crm_refill_draft`.
  - Added auto-save draft persistence to `SpecialOrdersSection` modal in `frontend/src/pages/CRM/index.tsx` using `localStorage` key `crm_special_order_draft`.
  - Displayed a prominent "Restored uncompleted draft" banner with a "Discard Draft" action so the user can resume seamlessly or clear the draft with human-in-the-loop control.

- [x] **Task 4: Patient Past Orders & WhatsApp Chat Intelligence in Special Orders**
  - In `SpecialOrdersSection` of `frontend/src/pages/CRM/index.tsx`, when a patient's phone is entered:
    - Auto-filters and surfaces "Patient Past Special Orders" with medicine name, quantity, date, distributor, and a 1-click `Reorder` action.
    - Queries recent WhatsApp incoming messages (`/messaging/chats/:id/messages?limit=25`) for the patient and extracts chat snippets.
    - Surfaces 1-click "Use as Medicine Name" candidate pills for instant prefill with full human approval.
  - Used strict semantic color variables (`bg-bg`, `bg-bg2`, `bg-bg3`, `border-border`, `text-text`, `text-muted`) respecting light/dark theme.

- [x] **Task 5: Verification, Guardrails & Knowledge Graph Update**
  - Frontend production build (`tsc -b && vite build`) passed with exit code 0 in 45.16s.
  - Backend compile (`tsc --noEmit`) passed with exit code 0.
  - Performance guardrails (`npm run guardrails`) passed with 0 violations.
  - Knowledge graph updated via `node scripts/quick-update.mjs` (1102 files indexed).

---

## Completion & Verification Summary
- **Backend Compile**: `npx tsc --noEmit` passed cleanly.
- **Frontend Build**: `npm run build --prefix frontend` created production distribution with 0 errors.
- **Performance Guardrails**: `npm run guardrails` verified changed files vs git HEAD with 0 violations.
- **Knowledge Graph**: Refreshed `.understand-anything/knowledge-graph.json` and `3d-knowledge-graph.html`.
