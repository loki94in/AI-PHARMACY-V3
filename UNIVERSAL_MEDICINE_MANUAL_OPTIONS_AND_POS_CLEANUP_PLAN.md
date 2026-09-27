# Implementation Plan: Universal Medicine Edit Modal Manual Options & POS Cleanup

## Status: COMPLETED
Created: 2026-09-27
Completed: 2026-09-27

---

## 1. Overview
This plan implements two requested features:
1. **Manual Add Option in Universal Medicine Edit Modal** (`UniversalMedicineEditModal.tsx`):
   - Item Type / Dosage Form (`#item_type_55`): Add dual-trigger manual custom entry for dosage forms (e.g. INHALER, RESPULES, PATCH, SPRAY, LOTION, SOAP).
   - Form Suffix Type (`#field_56_57`): Add dual-trigger manual custom entry for suffixes (e.g. RESP, SPRAY, LOTION, MD, LOZ, KIT).
   - Category (`#category_58`): Add dual-trigger manual custom entry for categories (e.g. Nutraceuticals, Cosmetics, OTC, Veterinary, Baby Care).
2. **Remove "Register New Medicine to Master Database" from POS Page** (`POS/index.tsx`):
   - Remove the `✨ Register "{searchTerm}" as New Medicine` banner from main product search dropdown (both empty & non-empty result states).
   - Remove the `✨ Register "{rowSearchTerm}" as New Medicine` banner from in-row product search dropdown.
   - Clean up keyboard handlers and modal creation triggers in POS so the billing interface stays focused on fast counter sales.

---

## 2. Tasks

### Task 1: Universal Medicine Edit Modal Manual Entry
- [x] Add `isCustomItemType`, `isCustomSuffix`, and `isCustomCategory` state variables.
- [x] Initialize custom states to `true` if initialData contains values not in standard preset lists.
- [x] Update Item Type section with `+ Manual` toggle button, `+ Add Custom / Manual...` dropdown option, and custom text input.
- [x] Update Form Suffix Type section with `+ Manual` toggle button, `+ Add Custom...` dropdown option, and custom text input with reactive `compileMedicineName`.
- [x] Update Category section with `+ Manual` toggle button, `+ Add Custom...` dropdown option, and custom text input.
- [x] Verify theme tokens (`bg-bg3`, `text-text`, `border-glass-border`, `border-primary`, etc.).

### Task 2: Remove Register New Medicine from POS Page
- [x] In `frontend/src/pages/POS/index.tsx`:
  - Removed "Register as New Medicine" button from `searchTerm` dropdown (empty results header).
  - Maintained `Quick Add` button in empty results header so cashier can still quick-bill manual items without catalog registration.
  - Removed "Register as New Medicine" button from `searchTerm` dropdown (pinned header when results exist) so real catalog search results start cleanly.
  - Removed "Register as New Medicine" button from row search dropdown.
  - Removed `newMedicineInitialName` modal trigger from POS search and removed the creation modal block.
  - Cleaned up `Alt+N` shortcuts in search fields.

### Task 3: Build & Verification
- [x] Run `npx tsc --noEmit` to verify type safety (Passed: exit code 0).
- [x] Run `npm run guardrails` to verify no regressions (Passed: exit code 0, 0 violations).
- [x] Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
