# Permanent Dropdown Overlay Header Removal Implementation Plan

## Goal
Permanently remove all redundant, decorative header strips (`Switch Batch`, `Old Batches`, `Select Distributor`, etc.) from all dropdown menus and autocomplete overlays across all 22+ pages and shared components in the application, preventing UI overlay collisions, text wrapping bugs (`SWITCH 1 / BATCH AVAILABLE`), and wasted vertical screen space.

---

## Tasks & Checklist

- [x] **TASK 1** — Remove redundant in-table batch switcher header in `frontend/src/pages/POS/index.tsx` (the `Switch Batch / X available` header).
- [x] **TASK 2** — Remove redundant category label headers in POS search dropdowns in `frontend/src/pages/POS/index.tsx`.
- [x] **TASK 3** — Remove redundant `🏷️ Old Batches` and `Distributor List` dropdown header strips in `frontend/src/pages/Purchases/index.tsx`.
- [x] **TASK 4** — Remove redundant `Select Distributor` and search header strips in `frontend/src/pages/Returns/index.tsx`.
- [x] **TASK 5** — Audit and remove any similar redundant dropdown headers in `Sells`, `Inventory`, `CRM`, `WebsiteOrders`, `PhoneSales`, `PharmarackCart`, and shared modals.
- [x] **TASK 6** — Rebuild client bundle (`npm run build:client`), run `npm run guardrails`, and update knowledge graph via `node scripts/quick-update.mjs`.

---

## Completion Log

- **TASK 1**: Removed the bulky `Switch Batch / X available` header strip from the POS billing table batch selector in `frontend/src/pages/POS/index.tsx`. Expanded width to `w-72 min-w-[280px]` so batch buttons render immediately without awkward multi-line text wrapping.
- **TASK 2**: Removed the redundant `Matching Inventory Records:` header strip from the POS medicine search dropdown in `frontend/src/pages/POS/index.tsx`, bringing the top search result immediately into view.
- **TASK 3**: In `frontend/src/pages/Purchases/index.tsx`, removed the `🏷️ Old Batches (X)` header bar from the purchase batch selector dropdown, removed the bulky `Distributor List (X)` label from the distributor selector, and removed the `Select Return Credit Note` header from credit note popovers.
- **TASK 4**: In `frontend/src/pages/Returns/index.tsx`, removed the redundant `Select Distributor (X found)` header strip from the distributor dropdown and removed the top `Purchased from ...` banner strip from the return search results overlay.
- **TASK 5**: Audited all remaining pages (`Sells`, `Inventory`, `CRM`, `WebsiteOrders`, `PhoneSales`, `PharmarackCart`, `Settings`, and modals). Confirmed autocomplete dropdowns now open directly into clean, pure choice lists with zero overlay collisions.
- **TASK 6**: Rebuilt frontend client bundle (`npm run build:client`), verified `npm run guardrails` passed with 0 violations (`tsc --noEmit` clean), and updated knowledge graph via `node scripts/quick-update.mjs` (1,115 files, 547 edges).
