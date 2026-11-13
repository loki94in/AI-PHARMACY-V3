# Notification Panel Customization Implementation Plan

## Objective
Customize the app's topbar Notification Panel (`NotificationPanel` in `frontend/src/components/Layout.tsx`) **without altering its external dimensions/size**, delivering:
1. **View Density Mode Switch**: Toggle between **Compact Mode** (high-density, single-line rows for fast scanning) and **Detailed Mode** (full card layout with tag chips and descriptions), persisted to `localStorage`.
2. **Category Filter Tabs**: Enhance filtering beyond `All / Unread / Alerts` to include operational domain filters: `All`, `Unread`, `Alerts`, `WhatsApp`, `Sales`, and `System`.
3. **Smart Time Grouping**: Group notifications by timeline (`Today`, `Yesterday`, `Earlier`) with subtle semantic divider headers.
4. **Actionable Context Navigation**: Detect notification targets and provide 1-click navigation to relevant pages (POS, Sells, Purchases, Pharmarack Cart, Expiry, Settings, or WhatsApp Queue).
5. **Settings Configuration**: Add a default panel density preference in `frontend/src/pages/Settings/AppearanceTab.tsx`.

---

## File Changes Required
1. `frontend/src/components/Layout.tsx`:
   - Refactor `NotificationPanel` with density mode state (`compact` vs `detailed`).
   - Add category categorization logic for events (`whatsapp`, `sales`, `system`, `alerts`).
   - Implement timeline grouping (`Today`, `Yesterday`, `Earlier`).
   - Add density toggle button and category filter bar.
   - Add compact row rendering alongside detailed card rendering.
   - Preserve existing width (`w-[420px] max-w-[calc(100vw-1.5rem)]`) and scroll height (`max-h-[400px] min-h-[180px]`).
2. `frontend/src/pages/Settings/AppearanceTab.tsx`:
   - Add "Notification Panel View Mode" preference selector (Compact vs Detailed) so users can customize default behavior from Settings.
3. Verification:
   - Run `npm run guardrails` to ensure zero performance, lint, or type violations.
   - Run `node scripts/quick-update.mjs` to auto-update the project knowledge graph.

---

## Verification & Guardrails
- **No Size Changes**: Panel width and height constraints remain exactly as specified in the UI contract.
- **Theme Compliance**: All elements use semantic Tailwind classes (`bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`).
- **No-GPU Contract**: No `backdrop-filter`, no endless CPU-intensive animations.

---

## Execution Tasks & Status
- [x] Task 1: Update `frontend/src/components/Layout.tsx` with density toggle, category filters, timeline grouping, and compact row views.
  - *Completed*: Added `density` state (`detailed` vs `compact`), domain category filter tabs (`All`, `Unread`, `Alerts`, `WhatsApp`, `Sales`, `System`), timeline grouping (`Today`, `Yesterday`, `Earlier`), single-line compact row rendering, and 1-click contextual action navigation.
- [x] Task 2: Update `frontend/src/pages/Settings/AppearanceTab.tsx` with notification panel default density configuration.
  - *Completed*: Added "Notification Panel Layout" preference card with live sync via `app_notif_density_changed` event and `localStorage` persistence.
- [x] Task 3: Run `npm run guardrails` and verify TypeScript compilation and performance contracts.
  - *Completed*: `tsc --noEmit` and all guardrails passed with 0 violations.
- [x] Task 4: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
  - *Completed*: Successfully updated knowledge graph (1,632 nodes, 916 edges).
