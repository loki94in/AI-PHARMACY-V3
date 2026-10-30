# Implementation Plan: Unified Multi-Task Chronic Refill Orchestration Flow

## 1. Feature Overview & Scope
Enable the Pharmacy Operations Assistant to execute a complete, connected multi-action chronic refill journey in a single conversational flow:
1. **Refill Lookup & Stock Availability Check**:
   - Authoritatively inspects active chronic refills for the patient from `patient_refills`.
   - Cross-references live inventory batches in `inventory_master`.
2. **Shortage Handling -> Direct Live Cart Staging & Special Order**:
   - If stock is insufficient or out of stock:
     - Directly stages the shortage medicine into Pharmarack Live Cart with patient attribution (`refill_id`, `customer_name`).
     - Books a shortage request into canonical `special_orders`.
3. **Patient Refill Call Task Scheduling**:
   - Schedules a follow-up call task in canonical `patient_call_tasks` with target date.
4. **WhatsApp Payment Confirmation & UPI QR Sharing**:
   - Inspects customer outstanding balance (`customers.credit_balance`).
   - If due balance > 0, stages a verified WhatsApp payment confirmation reminder card with dynamic branded UPI QR code.
5. **Rule 6 Human-in-the-Loop Multi-Action Card**:
   - Displays a composite interactive card with discrete or bundled operator actions:
     - `[Confirm & Dispense Refill]` (if in stock)
     - `[Stage to Live Cart]` (if shortage)
     - `[Book Special Order]`
     - `[Schedule Call Task]`
     - `[Share WhatsApp Payment QR]`

---

## 2. Architecture & Data Flow Compliance (`AGENT_DATA_FLOW_TREE.md`)
- **One Writer Per Fact**:
  - Refill mutations write strictly to `patient_refills`.
  - Shortage records write strictly to `special_orders`.
  - Call tasks write strictly to `patient_call_tasks`.
  - Distributor live cart writes via `pharmarack` routes / `addItemsToPharmarackCart`.
  - Outbound messaging respects `outboundSecurityGateway` (PTR masked, customer-safe).
- **Zero Dummy Data**: All patient names, balances, and medicines are resolved from live SQLite tables (`customers`, `patient_refills`, `inventory_master`).

---

## 3. Surgical Implementation Steps

### Step 1: Extend `pharmacyToolRegistry.ts`
- Added `orchestrateUnifiedPatientRefillFlow(patientNameOrPhone, dbInstance)`:
  - Fetches customer record and active refills.
  - Queries live batch stock for each refill medicine from `inventory_master`.
  - Computes shortage quantity.
  - Checks customer outstanding credit due from `customers.credit_balance`.
  - Returns unified composite plan containing:
    - `refills`: status, stock, shortage, price.
    - `dueBalance`: total unpaid credit.
    - `suggestedActions`: Live Cart staging, Special Order booking, Call task scheduling, Payment QR dispatch.
- Updated `scheduleCallTask` to persist `reschedule_date` to canonical `patient_call_tasks`.

### Step 2: Extend `conversationalAgentEngine.ts`
- In `resolveUnifiedIntent`:
  - Added compound intent flags (`wantsPaymentQr`, `wantsLiveCart`, `wantsCallTask`, `wantsSpecialOrder`).
  - Added guards so refill queries are not intercepted by raw `CART_STAGING`, `APPLICATION_GUIDE`, or `CUSTOMER_DUE_QUERY`.
  - Replaced generic placeholder chips (`Stage item to live cart` -> `Stage 5 Pan 40 to live cart`).
- In `processMessage` (`case 'REFILL'` & compound flows):
  - Added `UNIFIED_REFILL_ORCHESTRATION` proposal handling.
  - Executes multi-action bundles atomically under Rule 6 HITL confirmation.

### Step 3: Verification & Test Suite
- Created test suite `tests/unifiedRefillOrchestrationFlow.test.ts` (5/5 tests passing):
  - Test 1: `orchestrateUnifiedPatientRefillFlow` detects shortages and customer dues correctly.
  - Test 2: In-stock customer refill recommends dispensing and notes zero due.
  - Test 3: Compound query stages `UNIFIED_REFILL_ORCHESTRATION` proposal under Rule 6 HITL.
  - Test 4: Rule 6 Execution executes staged actions into canonical tables (`patient_call_tasks`, `audit_logs`).
  - Test 5: Zero-balance customer does not stage false payment collection.
- Added `tests/multiTaskAgentEngine.test.ts` (6/6 tests passing) covering typo handling, SOP Schedule H citations, and raw medicine lookups.
- Verified `npm run guardrails` exit code 0 (17 files scanned, zero violations).
- Synchronized knowledge graph (`node scripts/quick-update.mjs`).

---

## 4. Execution Log & Tasks
- [x] Task 1: Refill Orchestration Method in `pharmacyToolRegistry.ts` (Completed: `orchestrateUnifiedPatientRefillFlow` implemented with live stock cross-check and due balance lookup)
- [x] Task 2: Multi-Action Refill Router & Composite Cards in `conversationalAgentEngine.ts` (Completed: added `UNIFIED_REFILL_ORCHESTRATION` execution and compound intent routing)
- [x] Task 3: Comprehensive Test Suite in `tests/unifiedRefillOrchestrationFlow.test.ts` (Completed: 5/5 unit tests passed; combined with `multiTaskAgentEngine.test.ts` 11/11 tests passed)
- [x] Task 4: Guardrails & Knowledge Graph Synchronization (Completed: `npm run guardrails` passed, knowledge graph updated)
