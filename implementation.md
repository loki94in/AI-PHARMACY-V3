# Frontend Startup TypeScript Errors & Module Resolution Fix Plan

## 1. Problem Statement & Baseline
- **Observed Behavior**: Starting the app or running `npm run build:client` (`tsc -b && vite build`) fails with 28 compilation errors across 9 frontend files.
- **Root Cause**: A previous decomposition refactor of 11 monolithic pages into subcomponents left broken relative import paths (`../../api` instead of `../../services/api`), missing Lucide icons, missing type annotations, and mismatched prop interfaces between parent pages and extracted modal components.
- **Target**:
  1. Fix all imports, relative paths, types, and interfaces in `frontend/src/pages/CRM/` (`CustomerCreditSection`, `DistributorMessagesSection`, `RefillsSection`, `SpecialOrdersSection`, `WhatsAppSection`).
  2. Fix modal prop types in `frontend/src/pages/Dispatch/index.tsx` (`TemplateEditorModalProps`, `ManualOrderModalProps`).
  3. Fix prop types and delivery boy types in `frontend/src/pages/PharmarackCart/index.tsx`.
  4. Fix modal prop types in `frontend/src/pages/POS/index.tsx` (`POSPhonePromptModal`, `POSPostSaleModal`).
  5. Fix missing identifiers and function signatures in `frontend/src/pages/Returns/index.tsx` and `SupplierReturnHistory.tsx`.
  6. Fix toast severity type in `frontend/src/pages/Settings/StaffSecurityTab.tsx`.
  7. Reach 100% clean exit on `npx tsc -b frontend/tsconfig.json` and `npm run guardrails`.

---

## 2. Implementation Steps

1. **Phase 1: CRM Subsystem Fixes**
   - `CustomerCreditSection.tsx`: Fix relative imports (`../../services/api`), import missing icons from `lucide-react`, type parameter `c`, import type-safe events.
   - `DistributorMessagesSection.tsx`: Fix relative imports (`../../services/api`), type-only import for `AutomationLog`.
   - `RefillsSection.tsx`: Import or define `MedicineSuggestion`.
   - `SpecialOrdersSection.tsx`: Fix `useNavigate` import / hook usage.
   - `WhatsAppSection.tsx`: Add missing `OcrParsedPayload` type and `MedicineVisualReferenceModal` import.
   - Verify: `npx tsc -b frontend/tsconfig.json` for CRM files.

2. **Phase 2: Dispatch, PharmarackCart & POS Fixes**
   - `Dispatch/index.tsx`: Align `TemplateEditorModal` and `ManualOrderModal` props.
   - `PharmarackCart/index.tsx`: Align `medicineId` and `DeliveryBoyItem` id types.
   - `POS/index.tsx`: Align phone prompt, credit dues, and pdf export handler types.
   - Verify: `npx tsc -b frontend/tsconfig.json` for Dispatch, PharmarackCart, and POS.

3. **Phase 3: Returns & Settings Fixes**
   - `Returns/index.tsx` & `SupplierReturnHistory.tsx`: Define `LocalReturnHistoryRow`, provide `queryClient`, fix argument count on handler.
   - `Settings/StaffSecurityTab.tsx`: Fix toast severity from `'warning'` to `'info'`.
   - Verify: Full `npm run build:client` clean exit 0.

4. **Phase 4: Guardrails & Knowledge Graph**
   - Run `npm run guardrails`.
   - Run `node scripts/quick-update.mjs`.

---

## 3. Tasks & Completed Log

- [x] Task 1: Fix all TypeScript errors and missing imports in `frontend/src/pages/CRM/` files.
  - *Completed*: Fixed imports (`services/api`, `services/events`, `utils/date`), added missing Lucide icons, imported `MedicineSuggestion`, `useNavigate`, `MedicineVisualReferenceModal`, and typed `OcrParsedPayload`.
- [x] Task 2: Fix prop and type mismatches in `Dispatch/index.tsx`, `PharmarackCart/index.tsx`, and `POS/index.tsx`.
  - *Completed*: Aligned `TemplateEditorModalProps` and `ManualOrderModalProps`, made `medicineId` and `DeliveryBoyItem.id` optional, updated `POSDoctorModalProps.editingDoctorId` and `POSPostSaleModalProps`.
- [x] Task 3: Fix `Returns/index.tsx`, `SupplierReturnHistory.tsx`, and `Settings/StaffSecurityTab.tsx`.
  - *Completed*: Exported and imported `LocalReturnHistoryRow`, instantiated `queryClient` and replaced legacy `refetchHistory` call, fixed `usePersistedDateRange` options parameter, and changed toast severity to `'info'`.
- [x] Task 4: Full verification (`npm run build:client`, `npm run guardrails`, and `node scripts/quick-update.mjs`).
  - *Completed*: Verified with `npx tsc -b frontend/tsconfig.json` (0 errors), `npm run build:client` (built in 55.97s), and `npm run guardrails` (PASS with 0 violations).
