# Trilingual (EN / HI / MR) Messaging & Automation Audit Plan

> **Standard**: EGM (Elephant-Goldfish) Review Protocol + DOX Hierarchy Standard.  
> **Target Scope**: Comprehensive verification of Trilingual WhatsApp Messaging (English, Hindi, Marathi) across conversation bot, automated notifications, customer alerts, and modals.

---

## 1. Executive Summary

A comprehensive scan of the codebase was conducted to verify that all customer-facing WhatsApp messages, automated notifications, and interactive modal templates support all three primary languages: **English (`en`)**, **हिंदी (`hi`)**, and **मराठी (`mr`)**.

### Current Baseline Status
- **Central Dictionary (`src/i18n/messages.json`)**: All 85 translation keys are 100% synchronized across `en`, `hi`, and `mr`.
- **Refill Reminders (`src/routes/refills.ts`)**: Trilingual support implemented with store operating hours.
- **Collection Reminders (`src/services/collectionReminderWorker.ts`)**: Trilingual support implemented.
- **Order Confirmations (`src/routes/orders.ts` & `src/services/whatsappLocalizer.ts`)**: Trilingual support implemented (defaults to Marathi).
- **Market & Store Calendar Closure Notices (`MarketClosureNoticeModal.tsx`)**: Trilingual support with Apple-style segmented switcher implemented.

---

## 2. Identified Discrepancies & Deficiencies

The audit identified four specific areas where Marathi or Hindi is missing:

### Defect 1: `SpecialOrderArrivalModal.tsx` Missing Marathi
- **Scope**: `frontend/src/components/SpecialOrderArrivalModal.tsx` (Lines 49, 135–171, 560–575).
- **Issue**: The language selector toggle only offers `EN` and `हिंदी`.
- **Discrepancy**: When customer special orders arrive at the counter, the pharmacist cannot send the arrival notification in Marathi, forcing English or Hindi even when the customer's preferred language is Marathi.
- **Proposed Fix**: Add `mr` to `lang` state (`'en' | 'hi' | 'mr'`), add natural Marathi phrasing for Arrived, Delayed, and Mixed order states, and add a third `मराठी` pill to the language toggle.

### Defect 2: `DelayNoticeModal.tsx` Templates Are English-Only
- **Scope**: `frontend/src/components/DelayNoticeModal.tsx` (Lines 30–51).
- **Issue**: The four preset delay templates (Festival, Weather, Distributor Delay, Custom) are hardcoded in English only.
- **Discrepancy**: Broad delay alerts sent to patients cannot be formatted in Hindi or Marathi.
- **Proposed Fix**: Restructure `TEMPLATE_PRESETS` to support `en`, `hi`, and `mr`, with a segmented language switcher.

### Defect 3: Bot Fallback Responses in `whatsappIntentService.ts`
- **Scope**: `src/services/whatsappIntentService.ts` (Lines 3213–3218).
- **Issue**: When a patient sends an unrecognized response when choosing between Refill and Special Order, the retry and pharmacist transfer messages are hardcoded in English.
- **Proposed Fix**: Localize `retryMsg` and `silenceMsg` according to `stepLang` (`mr`, `hi`, `en`).

### Defect 4: Invoice PDF WhatsApp Caption in `whatsappInvoiceService.ts`
- **Scope**: `src/services/whatsappInvoiceService.ts` (Lines 65–108).
- **Issue**: Post-sale WhatsApp message caption sent with the PDF invoice is hardcoded in English.
- **Proposed Fix**: Inspect customer language preference from the `customers` table and format caption in Marathi, Hindi, or English.

---

## Detailed Implementation Plan

### Stage 1: Implement Marathi in `SpecialOrderArrivalModal.tsx`
1. Expand state type to `type ArrivalLang = 'en' | 'hi' | 'mr'`.
2. Auto-initialize `lang` from customer profile if available, defaulting to `mr`.
3. Add full Marathi template branches in `generatedMessage`:
   - All arrived: "आनंदाची बातमी! 🎉 आपली मागवलेली औषधे दुकानात घेऊन जाण्यासाठी तयार आहेत..."
   - Partial / Delayed: "आपल्या ऑर्डरचे अपडेट: ✅ तयार औषधे... ⏳ येण्यास वेळ..."
   - All delayed: "आपल्या ऑर्डरचे अपडेट: ⏳ खालील औषधांना थोडा वेळ लागत आहे..."
4. Add `मराठी` segmented button in UI.

### Stage 2: Implement Trilingual Presets in `DelayNoticeModal.tsx`
1. Add language state `lang: 'en' | 'hi' | 'mr'` (default `mr`).
2. Provide pre-translated templates for:
   - Festival / Holiday closure
   - Weather / Strike
   - Distributor Delay
   - Custom delay
3. Add segmented language switcher in the template preview header.

### Stage 3: Localize Fallbacks in `whatsappIntentService.ts`
1. Check `stepLang` in lines 3213–3218.
2. If `mr`: Provide Marathi retry and transfer prompt.
3. If `hi`: Provide Hindi retry and transfer prompt.
4. If `en`: Keep English prompt.

### Stage 4: Localize POS Invoice Caption in `whatsappInvoiceService.ts`
1. Query customer `language` column from `customers` table.
2. Format caption in Marathi (`mr`), Hindi (`hi`), or English (`en`).

### Stage 5: Verification & Guardrail Audit
1. Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
2. Verify TypeScript build (`npx tsc --noEmit`).
3. Update knowledge graph (`node scripts/quick-update.mjs`).

---

## Tasks & Progress Tracking

- [x] **Task 1: Plan Specification & EGM Review Sign-off**
  - Audited full codebase for trilingual completeness across `mr`, `hi`, and `en`.
  - Ingested findings into `goldfish_review_report.md` and received auto-accept approval.
- [x] **Task 2: Fix `SpecialOrderArrivalModal.tsx` (Add Marathi)**
  - Added `mr` to language state (defaulting to Marathi).
  - Implemented full Marathi templates for All Arrived, Partial Arrival, and Delayed orders.
  - Added Apple-style segmented `मराठी` toggle button in header.
- [x] **Task 3: Fix `DelayNoticeModal.tsx` (Add Trilingual Support)**
  - Converted presets (Festival, Weather, Distributor Delay, Custom) to structured trilingual dictionary.
  - Added Apple-style segmented language selector (`मराठी` | `हिंदी` | `English`).
- [x] **Task 4: Fix `whatsappIntentService.ts` (Localize Fallbacks)**
  - Localized bot clarification retry message (`retryMsg`) and pharmacist handoff notification (`silenceMsg`) in Marathi and Hindi.
- [x] **Task 5: Fix `whatsappInvoiceService.ts` (Trilingual Invoice Captions)**
  - Injected customer language check from database (`mr`, `hi`, `en`).
  - Added localized invoice PDF captions for credit ledger bills and cash sales.
- [x] **Task 6: Verification via Guardrails & Knowledge Graph**
  - Verified `npm run guardrails` passed (`tsc --noEmit` clean, zero violations).
  - Synchronized knowledge graph via `node scripts/quick-update.mjs`.

