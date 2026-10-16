# Implementation Plan: WhatsApp Bot Reply for Booked Patients & Read-Check Suppression Fix

## Overview
This plan fixes the issue where customers with recently booked orders (e.g. Special Orders or Refills) do not receive replies from the WhatsApp bot when they message "Hi", and ensures they receive their personalized Standard Greeting Menu.

---

## Root Causes Identified
1. **`isAlreadyReadByPharmacist` Suppression Flaw**:
   In `src/services/waSmartReplyScheduler.ts`, the check looked for ANY historical message with `pharmacist_opened_at IS NOT NULL`. Because the pharmacist viewed the chat in CRM during or after booking, all subsequent incoming messages from that customer were falsely classified as "already read by pharmacist" and permanently suppressed.
2. **`lookupCustomer` Missing `special_orders`**:
   In `src/services/whatsappIntentService.ts`, `lookupCustomer()` checked `customers`, `patient_refills`, and `sales_invoices`, but omitted `special_orders`. Booked patients (e.g., "Mr. PA") were not resolved by their latest booked name.

---

## Tasks

- [x] **Task 1: Fix `isAlreadyReadByPharmacist` in `waSmartReplyScheduler.ts`**
  - **File**: `src/services/waSmartReplyScheduler.ts`
  - **Implementation**: Updated `isAlreadyReadByPharmacist(chatId)` to inspect only the latest inbound message (`ORDER BY timestamp DESC LIMIT 1`). If the latest message has `pharmacist_opened_at IS NULL`, it is an unread new message and is NOT suppressed.
  - **Verification**: Unit test in `scratch/verify_booked_hi_fix.cjs` passed: confirmed that a new "Hi" message is not suppressed even after an older message was marked opened by the pharmacist.

- [x] **Task 2: Add `special_orders` Lookup to `lookupCustomer`**
  - **File**: `src/services/whatsappIntentService.ts`
  - **Implementation**: In `lookupCustomer()`, added priority lookup on `special_orders` created within the last 7 days (`ORDER BY id DESC LIMIT 1`) and a fallback for older orders. This resolves recently booked patient names (e.g. "Mr. PA") directly from active bookings.
  - **Verification**: Integration test in `scratch/verify_booked_hi_fix.cjs` passed: phone `9307409630` resolved to `"Mr. PA"`.

- [x] **Task 3: Ensure Clean Session Reset on Greeting for Booked Patients**
  - **File**: `src/services/whatsappIntentService.ts`
  - **Implementation**:
    - Ensured `DELETE FROM wa_pending_clarifications` in the greeting handler comprehensively matches across pure digits, `@lid`, and `@c.us` targets.
    - Routed the response to `targetRecipient = chatId || phone` so `@lid` sessions deliver directly to the active chat thread.
    - Enqueued the personalized Standard Greeting Menu using the customer's booked name (e.g. "Mr. PA").
  - **Verification**: Validated that fresh "Hi" messages clear prior passive waiting states and deliver the personalized 1-2-3 welcome menu.

- [x] **Task 4: Verification and Guardrails**
  - Ran `scratch/verify_booked_hi_fix.cjs`: Both read-check and customer-lookup tests passed.
  - Ran `npm run guardrails`: TypeScript compilation (`tsc --noEmit`) succeeded with 0 errors; no performance guardrail violations.
  - Ran `node scripts/quick-update.mjs`: Knowledge Graph refreshed (1,193 nodes, 798 edges).

