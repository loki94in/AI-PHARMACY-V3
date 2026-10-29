# AI-PHARMACY-V3 — Implementation Plan & Progress Tracker

## Objective
Upgrade Qwen / Local AI from a passive chatbot into the unified natural-language operating assistant for AI Pharmacy OS across App Chat, WhatsApp, CRM, Refills, and all 22 core pages.

---

## Architecture Blueprint
- **Channels**: Owner WhatsApp, Patient WhatsApp, Staff / Owner App Assistant Modal (`/api/assistant/chat`).
- **Identity & Authorization Gate**: Verified Owner allowlist + challenge/nonce verification, Staff token/role, Patient data isolation, public guest restrictions.
- **Natural-Language Understanding**: Qwen3-1.7B local CPU inference (No-GPU compliant) with bounded operational intent parsing and deterministic instant regex fallbacks.
- **Approved Action Router**: Two-stage execution. Read-only queries execute immediately; change requests generate verified drafts and require explicit human-in-the-loop confirmation (`APPROVE <ID>` / `YES`).
- **Audit & Idempotency**: Single-flight proposal locks and mandatory `action_logs` recording via `logMutationAudit()`.

---

## Tasks

- [x] Task 1: Create Operational Intent Schema (`src/services/localAi/operationalIntentSchema.ts`) & update `src/services/localAi/llamaServerClient.ts`.
- [x] Task 2: Create Owner Identity, Authentication & Replay Shield Gateway (`src/services/localAi/ownerAuthGateway.ts`).
- [x] Task 3: Expand Scoped Pharmacy Tool Registry (`src/services/localAi/pharmacyToolRegistry.ts`) with distributor return drafts, reorder calculations, delivery status, and purchase rate comparisons.
- [x] Task 4: Upgrade Conversational Agent Engine (`src/services/localAi/conversationalAgentEngine.ts`) with operational intents, draft actions, and affirmative approvals.
- [x] Task 5: Bridge Owner WhatsApp Inbound Pipeline (`src/services/whatsappIntentService.ts`) to handle natural language owner commands.
- [x] Task 6: Synchronize Unified Assistant Orchestrator & 22-Page Capabilities (`src/services/localAi/unifiedAssistantOrchestrator.ts` & `UnifiedOperationsAssistantModal.tsx`).
- [x] Task 7: Run automated test suites, verify performance guardrails (`npm run guardrails`), update knowledge graph (`node scripts/quick-update.mjs`), and report completion.

---

## Task Completion Log

### Task 1: Operational Intent Contract & Schemas
- **What was done**: Created `src/services/localAi/operationalIntentSchema.ts` with 12 bounded operational intents (`EXPIRY_AUDIT`, `DISTRIBUTOR_RETURN_DRAFT`, `LOW_STOCK_REORDER`, `SALES_SUMMARY`, `PURCHASE_QUERY`, `DELIVERY_STATUS`, `REFILL_MANAGEMENT`, `STOCK_ADJUSTMENT`, `CUSTOMER_ENQUIRY`, `PAGE_GUIDANCE`, `CHITCHAT`, `UNKNOWN`), strict JSON schema validation, markdown fence stripping, and safe fallback parser `parseOperationalIntent()`.
- **How it was done**: Added `queryOperationalAiIntent()` to `src/services/localAi/llamaServerClient.ts` with strict 4000ms abort signal, No-GPU CPU thread budgeting, and silent failover.

### Task 2: Owner Identity, Authentication & Replay Shield Gateway
- **What was done**: Created `src/services/localAi/ownerAuthGateway.ts` resolving owner phone from `app_settings` setting keys (`owner_whatsapp_number`, `admin_whatsapp_number`, `admin_whatsapp`, `shop_phone`, `store_phone`), `pharmacy_users` (owner/admin roles), and `customers` table.
- **How it was done**: Implemented 60-second sliding window nonce deduplication (`checkAndRecordNonce()`), single-flight proposal action locks (`acquireActionLock()` / `releaseActionLock()`), and 4-digit session challenge verification (`issueOwnerChallenge()` / `verifyOwnerChallenge()`).

### Task 3: Scoped Pharmacy Tool Registry Expansion
- **What was done**: Added 4 canonical operational tools to `PharmacyToolRegistry` in `src/services/localAi/pharmacyToolRegistry.ts`:
  1. `generateDistributorReturnDraft(daysAhead, distributor)`: Analyzes near-expiry batches across `inventory_master`, groups by distributor, calculates claim value, and prepares a draft return memo without decrementing stock.
  2. `calculateLowStockReorderDraft(minThreshold)`: Identifies fast-moving low stock items across `medicines` and `inventory_master` and drafts suggested replenishment quantities.
  3. `getDeliveryRunStatus()`: Summarizes pending and in-transit delivery runs from `dispatch_orders` and `delivery_boys`.
  4. `getPurchaseRateComparison(medicineQuery)`: Strictly owner-gated query comparing historical invoice purchase rates (PTR) across distributors from `purchase_items` and `purchases`.

### Task 4: Conversational Agent Engine Upgrade
- **What was done**: Upgraded `src/services/localAi/conversationalAgentEngine.ts` to support `DISTRIBUTOR_RETURN_DRAFT`, `LOW_STOCK_REORDER`, `DELIVERY_STATUS`, and `PURCHASE_QUERY`. Added two-stage proposal generation with Rule 6 Human-in-the-Loop affirmative execution (`APPROVE <ID>` / `YES`).
- **How it was done**: Added test criteria 21, 22, and 23 to `tests/conversationalAgentEngine.test.ts`. All 23 test criteria passed cleanly in Jest.

### Task 5: Bridge Owner WhatsApp Inbound Pipeline
- **What was done**: Upgraded `src/services/whatsappIntentService.ts`. In `checkIsOwnerPhone()`, integrated `evaluateSenderIdentity()` from `ownerAuthGateway.ts`. In `handleOwnerInteractiveReply()`, routed unhandled natural language owner messages directly through `conversationalAgentEngine.processMessage({ role: 'owner', channel: 'whatsapp', ... })`.
- **How it was done**: Output enqueued directly via `whatsappQueueWorker.enqueue()`, enabling natural language commands from the registered owner WhatsApp (e.g. checking 60-day expiry and preparing return lists).

### Task 6: 22-Page Capabilities & Assistant Modal Synchronization
- **What was done**: Expanded `CAPABILITY_REGISTRY` in `src/services/localAi/unifiedAssistantOrchestrator.ts` to include `STAGE_DISTRIBUTOR_RETURNS`, `REORDER_LOW_STOCK`, and `QUERY_DELIVERY_STATUS`.
- **How it was done**: Updated `getPageContextInfo()` in `frontend/src/components/UnifiedOperationsAssistantModal.tsx` to provide quick suggestion chips for return list drafting, low stock reorders, and delivery checks on `/returns`, `/inventory`, and `/dispatch`.

### Task 7: Quality Gates, Guardrails & Documentation
- **What was done**: Ran full test suite (`tests/conversationalAgentEngine.test.ts`: 23/23 tests passed), verified performance guardrails (`npm run guardrails`: clean TypeScript, zero violations), and updated the knowledge graph (`node scripts/quick-update.mjs`: 1323 nodes, 869 edges synchronized).
