# Header Popup Z-Index Mismatch Audit & Implementation Plan

## Problem Statement
The sticky application header uses `z-sticky-header` (`z-index: 1000`), and dropdowns use `z-dropdown` (`z-index: 999`). Several modal overlays and popups across the application were using generic Tailwind `z-50` or `z-[100]`. Because `50 < 1000` and `100 < 1000`, the top header and navigation remained visible and layered on top of open modal dialogs, breaking visual containment and UX.

In `frontend/src/index.css` and `frontend/tailwind.config.js`:
- `z-global-modal` is defined as `10000` (for full-screen and primary dialog overlays).
- `z-submodal` is defined as `10015` (for nested submodals/alerts above a global modal).
- `z-sticky-header` is defined as `1000`.

## Architecture & Stacking Context Hierarchy
1. Base Layout / Main Content: `z-0`
2. Dropdown Menus: `z-dropdown` (`999`)
3. Sticky Header / Nav: `z-sticky-header` (`1000`)
4. Slide-over Drawers: `z-drawer` (`9000`)
5. Page Modals: `z-modal` (`9999`)
6. Global Viewport Dialogs & Backdrops: `z-global-modal` (`10000`)
7. Nested Submodals / Lightboxes: `z-submodal` (`10015`)
8. Toast Notifications: `z-toast` (`10050`)

---

## Tasks & Checklist

- [x] Task 1: Audit all modal backdrops with `fixed inset-0` in `frontend/src` for z-index lower than 1000.
  - Audited 100+ modal and overlay definitions across `frontend/src`.
  - Identified all modals using `z-50`, `z-60`, `z-[100]` or unassigned z-index that conflicted with `z-sticky-header: 1000`.
- [x] Task 2: Fix `ClosureStockBufferModal.tsx` (`z-50` -> `z-global-modal`)
  - Updated line 162 backdrop to `z-global-modal`.
- [x] Task 3: Fix `MarketClosureModal.tsx` (`z-50` -> `z-global-modal`)
  - Updated line 74 backdrop to `z-global-modal`.
- [x] Task 4: Fix `SpecialOrderArrivalModal.tsx` (`z-50` -> `z-global-modal`)
  - Updated line 271 backdrop to `z-global-modal`.
- [x] Task 5: Fix `PortalAccountsManager.tsx` (3 modal backdrops: `z-50` -> `z-global-modal`)
  - Updated create-account modal, override-PIN modal, and session history modal to `z-global-modal`.
- [x] Task 6: Fix `DelayNoticeModal.tsx` (`z-[100]` -> `z-global-modal`)
  - Updated line 199 backdrop from `z-[100]` to `z-global-modal`.
- [x] Task 7: Fix `CompositionIntelligenceModal.tsx` (lightbox submodal `z-60` -> `z-submodal`)
  - Parent modal uses `z-global-modal` (10000); updated nested lightbox inspection backdrop to `z-submodal` (10015).
- [x] Task 8: Fix `CRM/EnquiriesSection.tsx` (`z-50` -> `z-global-modal`)
  - Updated line 374 backdrop to `z-global-modal`.
- [x] Task 9: Fix `Database/CatalogImageVerificationTab.tsx` (6 modals/drawers: `z-50` -> `z-global-modal`)
  - Updated mark-incorrect modal, history drawer, reject modal, replace-slot modal, online candidates modal, and connect-to-master modal.
- [x] Task 10: Fix `Dispatch/index.tsx` (2 modals: `z-50` -> `z-global-modal`)
  - Updated template-edit modal and manual-call order modal backdrops to `z-global-modal`.
- [x] Task 11: Fix `OnlineCatalog/index.tsx` (2 modals: `z-50` -> `z-global-modal`)
  - Updated QR code modal and Cloudflare tunnel token configuration modal backdrops to `z-global-modal`.
- [x] Task 12: Fix `Returns/ExpiryReturnReview.tsx` (4 modals: `z-50` -> `z-global-modal`)
  - Updated single approval modal, bulk approval modal, reject proposal modal, and audit history modal backdrops to `z-global-modal`.
- [x] Task 13: Verify compilation (`tsc --noEmit`), character encoding (clean UTF-8), and run guardrails.
  - Confirmed 0 encoding regressions (`git diff -G"â"` returns empty).
  - TypeScript compilation `tsc --noEmit` passed with 0 errors.
- [x] Task 14: Auto-update knowledge graph (`node scripts/quick-update.mjs`).
  - Successfully updated knowledge graph (1087 nodes, 543 edges).

---
