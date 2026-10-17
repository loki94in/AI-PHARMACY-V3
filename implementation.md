# Implementation Plan: Dynamic Greeting & Disambiguated Refill / Special Order WhatsApp Flow

**Goal:**
Enable WhatsApp bot to distinguish whether a customer with the same phone number wants to book a **Refill**, a **Special Order**, or a **Combined Order** of both. Dynamically present contextual options (Single Medicine, Multiple Medicines, Refill, Special Order, Store Details) in the greeting and reminders, while reusing the existing, proven order and cart-addition pipelines.

---

## 1. Architecture & Design Decisions

### A. Dynamic Context-Aware Greeting Menu (`src/services/whatsappIntentService.ts`)
- When generating the welcome greeting for a known customer:
  - Query active/past records from `patient_refills` and `special_orders` for the customer's phone number.
  - If customer has **Special Order history**:
    - Dynamically include **Special Order** as a distinct option in the menu (e.g. `4️⃣ Special Order — Reorder / check your previous special requests`).
    - Adjust Store Details to `5️⃣ Store Hours, Location & Call Pharmacist 📞`.
  - If customer has **Refill history**:
    - Include `3️⃣ Refill — Repeat regular prescription`.
  - If new / no history:
    - Keep standard clean options (1: Single, 2: Multiple, 3: Store Info).

### B. Dual-Record Inbound Disambiguation (`src/services/whatsappIntentService.ts`)
- In step `2b. REFILL CONFIRMATION CHECK`:
  - When customer sends an affirmative confirmation (`"1"`, `"yes"`, `"confirm"`, `"order"`, `"bhej do"`) and has active `patient_refills`:
  - Check if the customer ALSO has an active/pending `special_orders` record (status in `'Pending'`, `'Ordered'`, `'Confirmed'`, `'Arrived'`, `'Ready'`).
  - If **BOTH** exist:
    - Do NOT blindly confirm refills.
    - Instead, prompt with a clear 3-choice disambiguation menu:
      - `1️⃣ Refill Only` *(lists refill medicines)*
      - `2️⃣ Special Order Only` *(lists special order product)*
      - `3️⃣ Combine Both` *(merges both into a single order)*
    - Set `wa_pending_clarifications` step to `awaiting_order_disambiguation`.

### C. Processing Selection & Reusing Existing Workflows
- When user chooses:
  - **Option 1 (Refill Only)**: Executes existing `patient_refills` confirmation & calls `processRefillCartItem` to stage into Pharmarack Live Cart.
  - **Option 2 (Special Order Only)**: Confirms the `special_orders` record and stages into the Live Cart.
  - **Option 3 (Combine Both)**: Executes both handlers sequentially, staging all selected items into the Live Cart.
  - **"Without [Med Name]" (Opt-Out)**: Filters the `pendingRefills` list, confirming only the requested medicines.

### D. Human-in-the-Loop (HITL) Safeguard
- All added items land in the **Pharmarack Live Cart** and **Quick Assist / CRM**.
- Pharmacist has immediate visibility and total authority to adjust quantities, remove items, or approve for final dispatch.

---

## 2. Verification Plan

1. **Unit & Integration Tests:**
   - Test dynamic greeting generation for customers with special orders vs customers without.
   - Test dual-record disambiguation when customer has both active Refills and Special Orders.
   - Test "Combined" option adds both refill and special order medicines to the cart.
   - Test "without [Medicine Name]" opt-out filters out the specified medicine.
2. **TypeScript Compilation:**
   - `npx tsc --noEmit`
3. **Performance Guardrails:**
   - `npm run guardrails`
4. **Knowledge Graph Sync:**
   - `node scripts/quick-update.mjs`

---

## 3. Task Checklist & Progress Log

- [x] Task 1: Add dynamic greeting menu builder supporting Special Order option in `whatsappIntentService.ts` and i18n
- [x] Task 2: Implement dual-record disambiguation in `handleInbound` (step 2b) to prevent blind refill capture
- [x] Task 3: Support `awaiting_order_disambiguation` and refill opt-out (`"without [Med]"`) routing in `checkMedicineClarificationResponse`
- [x] Task 4: Write comprehensive automated integration tests for dynamic greeting, dual-record disambiguation, and combined order flows
- [x] Task 5: Run TypeScript checks, performance guardrails, and knowledge graph sync

---

## 4. Completed Work Log & Verification Results

### 1. Dynamic Greeting Menu with Special Orders
- **File:** [src/services/whatsappIntentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
- **What was done:**
  - Implemented `buildCustomerWelcomeMenu`: checks `special_orders` for the incoming phone number.
  - If the customer has ever booked a special order, the menu dynamically presents:
    - 1️⃣ Single Medicine
    - 2️⃣ Multiple Medicines (or send prescription photo 📸)
    - 3️⃣ Refill — Repeat regular prescription
    - 4️⃣ Special Order — Reorder / check previous special requests (with snippet of last item)
    - 5️⃣ Store Hours, Location & Call Pharmacist 📞
  - Integrated across onboarding guidance, name registration, and direct greeting paths.
  - If the customer selects 4 (or types "special"), they are shown their special orders on file with options to reorder all, pick individual items, or combine with regular refills.
  - If the customer does not have special orders, option 4 seamlessly routes to Store Information and Help.

### 2. Dual-Record Inbound Disambiguation (Step 2b)
- **File:** [src/services/whatsappIntentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
- **What was done:**
  - In `handleInbound` under step `2b. REFILL CONFIRMATION CHECK`, when an affirmative confirmation ("yes", "confirm", "1", "bhej do") arrives:
  - The system checks both `patient_refills` and `special_orders`.
  - If **both** active Refills and active Special Orders exist on that phone number, the bot intercepts the message before auto-confirming refills.
  - Sends a clean 3-choice interactive menu:
    - 1️⃣ Refill Only *(lists refill medicines)*
    - 2️⃣ Special Order Only *(lists special order product)*
    - 3️⃣ Combine Both into one delivery
  - Sets step to `awaiting_order_disambiguation` in `wa_pending_clarifications`.

### 3. Disambiguation & Refill Opt-Out Handler
- **File:** [src/services/whatsappIntentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
- **What was done:**
  - Added `awaiting_order_disambiguation` handling:
    - Choice 1: Confirms refills via existing `patient_refills` confirmation and stages to cart via `processRefillCartItem`.
    - Choice 2: Confirms special orders and marks status `'Confirmed'`.
    - Choice 3: Confirms both sequentially, tagging special orders as `customer_order_source = 'whatsapp_combined'`.
  - Added opt-out detection in `awaiting_refill_choice`: detects phrases like `"without [Med Name]"`, `"except [Med Name]"`, `"nahi chahiye [Med Name]"` and excludes that medicine while confirming the remaining list.

### 4. Automated Integration Test Suite
- **File:** [tests/whatsappDualRefillSpecialOrderFlow.test.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/tests/whatsappDualRefillSpecialOrderFlow.test.ts)
- **Config:** [jest.config.js](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/jest.config.js)
- **Test cases executed:**
  1. Dynamic greeting includes Special Order (Option 4) when customer has past special orders.
  2. Replying 4 for customer with special orders presents special order reorder choices.
  3. When customer has BOTH active Refills and Special Orders, affirmative reply triggers 3-way disambiguation.
  4. Disambiguation selection: Reply "3" combines both Refill and Special Order into cart.
  5. Refill opt-out: Customer replies "without [Med Name]" excludes that item.
- **Results:** 5 passed, 5 total.

### 5. Verification & Performance Guardrails
- **Test Suites:**
  - `tests/whatsappDualRefillSpecialOrderFlow.test.ts`: **PASSED (5/5)**
  - `tests/whatsappOnboardingSpamShield.test.ts`: **PASSED (8/8)**
  - Combined: **13 tests passed, 0 failed**.
- **TypeScript Compiler:** `npx tsc --noEmit` &rarr; **PASSED (0 errors)**.
- **Performance Guardrails:** `npm run guardrails` &rarr; **PASSED (0 violations)**.
- **Knowledge Graph:** `node scripts/quick-update.mjs` &rarr; **Updated successfully (1216 nodes, 807 edges)**.

