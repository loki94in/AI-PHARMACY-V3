# Full-App 22+ Pages Universal 10-Digit Phone Enforcement Plan

## Overview
A comprehensive, zero-bypass enforcement of strict 10-digit phone numbers across the entire application (CRM subtabs, POS, PhoneSales, Sells, Dispatch, CustomerPortal, Quick Assist, and Settings). Any phone number entered or saved anywhere in the system is guaranteed to be exactly 10 digits (starting with [6-9] for mobile/WhatsApp recipients, or 10 digits for distributors/landlines). Walk-in sales without phone numbers remain supported.

---

## Audit Findings & Gaps Identified & Fixed

### 1. CRM Page (`frontend/src/pages/CRM/`)
- [x] **Refills Section (`RefillsSection.tsx`)**: "Register / Edit Refill" modal (`handleSaveRefill`) validates `addPatientPhone` using `isValid10DigitPhone`. Backend `patient-medicines` (`src/routes/refills.ts`) validates phone using `validate10DigitPhone(patient_phone, { allowBlank: false, requireMobilePrefix: true })`.
- [x] **Special Orders Section (`SpecialOrdersSection.tsx`)**: The Edit Order modal (`handleSaveEdit`) enforces `isValid10DigitPhone(cleanPh)` (replaced legacy 8-15 digit check).
- [x] **Enquiries Section (`EnquiriesSection.tsx` & `src/routes/enquiries.ts`)**: "New Enquiry" modal validates phone with `isValid10DigitPhone`. Backend `POST /api/enquiries` validates with `validate10DigitPhone`.
- [x] **WhatsApp Section (`WhatsAppSection.tsx`)**: "New Chat" modal (`handleStartNewChat`) validates 10 digits starting with [6-9] before generating `@c.us` IDs.
- [x] **Doctors Profile (`src/routes/crm.ts`)**: `POST /doctors` and `PUT /doctors/:id` validate contact numbers with `validate10DigitPhone(contact_number, { allowBlank: true, requireMobilePrefix: false })`.

### 2. Sells & Invoice Edit (`frontend/src/pages/Sells/index.tsx`)
- [x] In `handleUpdateInvoice`, `editCustomerPhone` is validated with `isValid10DigitPhone` before submission. If invalid or short, displays error toast and blocks save.

### 3. Phone Sales & Staged Billing (`frontend/src/pages/PhoneSales/index.tsx` & `src/routes/sales.ts`)
- [x] In `handleApprove`, `patientPhone` is validated before calling `api.approveStagedSale`.
- [x] In `src/routes/sales.ts` (`POST /staged`, `POST /staged/:id/approve`), validates `patient_phone` using `validate10DigitPhone`.

### 4. Dispatch System (`frontend/src/pages/Dispatch/index.tsx` & `src/routes/dispatch.ts`)
- [x] In `handleCreateManualOrder` & `handleSubmit`, validates `patient_phone` and `manualDistributorPhone` with `isValid10DigitPhone`.
- [x] In `src/routes/dispatch.ts` (`POST /orders`, `POST /distributor-reminders/manual-order`), validates phones with `validate10DigitPhone`.

### 5. Quick Assist & Modals (`frontend/src/components/`)
- [x] `QuickOrderModal.tsx`: In `handleFormSubmit`, validates `phone` with `isValid10DigitPhone`. If invalid, blocks submission and triggers phone shake alert.
- [x] `StagedReviewModal.tsx`: Validates `patientPhone` before approving staged orders.
- [x] `POS/index.tsx`: In `handleRegisterDoctor`, validates `newDoctorPhone` with `isValid10DigitPhone`.
- [x] `Purchases/index.tsx`: In `saveDistributor`, validates `newDistributor.phone` with `isValid10DigitPhone`.
- [x] `PortalAccountsManager.tsx`: In `handleCreateAccount`, validates `formData.phone` with `isValid10DigitPhone`.

### 6. Customer Portal (`CustomerPortal/index.tsx`, `customerPortal.ts`)
- [x] In `CustomerPortal/index.tsx` (`handleRegister`), replaced loose check with `isValid10DigitPhone(cleanP)`.
- [x] In `src/routes/customerPortal.ts` (`POST /auth/register`, `POST /accounts/generate`), enforces `validate10DigitPhone`.

### 7. Settings (`Settings/MultiStoreTab.tsx`, `Settings/TriggerSchedulesTab.tsx`, `src/routes/settings.ts`, `src/routes/stores.ts`)
- [x] In `MultiStoreTab.tsx`, sanitizes and validates `newStore.phone` with `isValid10DigitPhone` and `maxLength={10}`.
- [x] In `src/routes/stores.ts`, validates store phone in POST and PUT with `validate10DigitPhone`.
- [x] In `TriggerSchedulesTab.tsx`, validates `nonWaFallbackAlertPhone` before saving and sets `maxLength={10}`.
- [x] In `src/routes/settings.ts`, validates all incoming phone keys (`shop_phone`, `pharmacy_phone`, `owner_whatsapp_number`, `non_wa_fallback_alert_phone`) with `validate10DigitPhone`.

---

## Progress Tracking

- [x] Task 1: Audit all remaining phone inputs across all 22+ pages (Completed)
- [x] Task 2: Implement Phase 1: CRM sub-tabs (Refills, Special Orders Edit, Enquiries, WhatsApp, Doctors) (Completed)
- [x] Task 3: Implement Phase 2: Sells invoice edit, PhoneSales staged sales, and Dispatch orders (Completed)
- [x] Task 4: Implement Phase 3: Quick Assist (QuickOrderModal, StagedReviewModal, POSDoctorModal, Purchases, Portal, Settings) (Completed)
- [x] Task 5: Run Guardrails (`npm run guardrails`) & Knowledge Graph Update (`node scripts/quick-update.mjs`) (Completed)

---

## Completed Tasks Summary

1. **Universal Shared Utilities**:
   - Backend: `src/utils/phoneValidation.ts` provides `normalizePhoneDigits(input)` and `validate10DigitPhone(input, options)` with support for `allowEmpty`/`allowBlank`, `requireMobile`/`requireMobilePrefix`, and returns `{ isValid, cleanPhone, error, reason }`.
   - Frontend: `frontend/src/utils/phone.ts` provides `sanitizePhoneInput(val)` and `isValid10DigitPhone(val)` enforcing exactly 10 digits starting with `[6-9]`.

2. **Full Frontend Form Protection**:
   - All customer/patient entry points enforce 10 digits starting with `[6-9]`.
   - Distributor/store entry points enforce 10 digits.
   - Form submit handlers reject invalid numbers with immediate toast errors and block backend calls.
   - POS checkout preserves walk-in orders (empty phone) while strictly locking any entered phone to 10 digits.

3. **Backend API Gateways Locked**:
   - `src/routes/refills.ts` (`PUT /patient-medicines`)
   - `src/routes/crm.ts` (`POST /doctors`, `PUT /doctors/:id`)
   - `src/routes/enquiries.ts` (`POST /api/enquiries`)
   - `src/routes/sales.ts` (`POST /staged`, `POST /staged/:id/approve`)
   - `src/routes/dispatch.ts` (`POST /orders`, `POST /distributor-reminders/manual-order`)
   - `src/routes/customerPortal.ts` (`POST /accounts/generate`, `POST /auth/register`)
   - `src/routes/stores.ts` (`POST /api/stores`, `PUT /api/stores/:id`)
   - `src/routes/settings.ts` (`POST /settings`, `POST /settings/save-single`, `POST /settings/save`)

4. **Performance & Architecture Verification**:
   - Guardrails (`npm run guardrails`): PASSED (TypeScript compilation OK, Database Schema & Integrity OK, 0 violations).
   - Knowledge Graph (`node scripts/quick-update.mjs`): PASSED (1175 nodes, 797 edges, 10 layers).
