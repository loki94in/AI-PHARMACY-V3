# AI-PHARMACY-V3 — Secure WhatsApp Integration and Owner AI Assistant

## Objective
Integrate WhatsApp refill confirmations, customer enquiries, authorized distributor communication and a private owner-facing AI assistant into the existing AI-PHARMACY-V3 application.
The implementation strictly adheres to the fail-closed security gateway, single-writer data-flow tree, deterministic refill verification, recipient-specific field allowlists, and human-in-the-loop owner controls.

---

## 1. Architectural Design & Security Safeguards

### A. Central Outbound Security Gateway (`src/services/outboundSecurityGateway.ts`)
- **Recipient Verification**: Resolves recipient phone against verified directories (`customers`, `distributors`, `delivery_boys`, `pharmacy_users`, `app_settings`).
- **Role-Based Field Allowlists**:
  - *Customer*: Medicine name, dosage, public MRP, discount, retail sell price, store hours, address.
  - *Distributor*: Store name, order number, medicine name, pack quantity, delivery boy contact.
- **Confidential Data Scanner**:
  - Rejects messages containing wholesale rates, purchase prices, PTR, cost price, margins, profit %, supplier rate comparisons, internal notes, credentials, and foreign customer PII.
- **Fail-Closed Execution**: If recipient cannot be validated or confidential patterns are detected, send is rejected, dropped from queue, and security event is logged in `action_logs`.

### B. Deterministic Refill Confirmation Engine
- **Strict Affirmative Matching**: Disallows loose conversational substring tokens (`ok`, `okay`, `ha`, `चाहिए`). Requires deterministic affirmative tokens (`1`, `yes`, `confirm`, `bhej do`, `send`, `haan`, `ho`, `ho ji`, `पाठवा`, `द्या`, `होय`, `कन्फर्म`, `भेज दो`).
- **Negation & Question Guards**: Automatically rejects messages containing question markers (`kya`, `price`, `kitna`, `rate`) or negative words (`nahi`, `nako`, `cancel`, `mat`).
- **Active Reminder Window**: Verifies that a refill reminder was dispatched to this patient within the last 72 hours (or an active clarification exists) before staging a confirmation.

### C. Private Owner Assistant Inside App
- **Authentication & Role Isolation**: Gated by `role === 'owner'` in-app sessions (`pharmacy_users`). WhatsApp messages from any external phone can NEVER execute owner commands or access financial metrics.
- **Authorized Business Analytics**: Read-only queries for sales metrics, gross profit margins, distributor purchase rates, and batch expiry audits.
- **Rule 6 Two-Stage Confirmation Gate**: Any consequential external action (sending WhatsApp messages, staging orders) generates a `PENDING_CONFIRMATION` proposal requiring manual operator click before execution.

---

## 2. File-by-File Implementation Plan

| Step | File | Action | Purpose |
| :---: | :--- | :---: | :--- |
| **1** | `src/services/outboundSecurityGateway.ts` | **Created** | Central outbound security gateway for recipient verification, confidential field inspection, and fail-closed audit logging. |
| **2** | `src/whatsappClient.ts` | **Modified** | Integrated outbound security gateway in `sendMessage()`. |
| **3** | `src/services/whatsappQueueWorker.ts` | **Modified** | Integrated gateway in `enqueue()` and `processQueueInternal()`; safeguarded crash recovery against duplicate PO dispatches. |
| **4** | `src/services/intentKeywords.ts` & `src/services/whatsappIntentService.ts` | **Modified** | Hardened refill confirmation regex, added negation/question guards, enforced 72h reminder window, and eliminated WhatsApp owner escalation. |
| **5** | `src/services/localAi/unifiedAssistantOrchestrator.ts` & `src/routes/assistant.ts` | **Modified** | Added `owner` role, owner analytics handlers (`VIEW_PURCHASE_RATES`, `VIEW_MARGINS`, `QUERY_SALES_METRICS`, `AUDIT_EXPIRY`), authenticated routes, and fixed `SEND_WHATSAPP_MESSAGE` SQL. |
| **6** | `tests/secureWhatsAppAndOwnerAssistant.test.ts` | **Created** | Comprehensive regression test suite verifying all 14 mandatory acceptance criteria. |
| **7** | `scripts/quick-update.mjs` & `scripts/performance-guardrails.mjs` | **Verified** | Ensured clean TypeScript types, guardrails pass, and knowledge graph synchronization. |

---

## 3. Execution & Verification Log

### Task 1: Create `src/services/outboundSecurityGateway.ts`
- [x] Implemented `validateOutboundMessage()` with fail-closed security policy.
- [x] Implemented role resolution against `customers`, `distributors`, `delivery_boys`, `pharmacy_users`, and `app_settings`.
- [x] Implemented confidential data regex scanner (blocking PTR, cost price, margins, wholesale rates, internal notes, credentials).
- [x] Connected `logMutationAudit()` for security block logging in `action_logs`.
- **Verified**: Unit tests pass for confidential data rejection and recipient allowlists in `tests/secureWhatsAppAndOwnerAssistant.test.ts`.

### Task 2: Integrate Gateway into `whatsappClient.ts`
- [x] Called `validateOutboundMessage()` directly at the top of `sendMessage()`.
- [x] Blocked and logged policy-violating direct messages with `{ sent: false, blockedByPolicy: true }`.
- **Verified**: Blocked message with PTR is intercepted and dropped before reaching browser transport.

### Task 3: Integrate Gateway into `whatsappQueueWorker.ts`
- [x] Validated outbound messages in `enqueue()`.
- [x] Re-validated before queue dispatch in `processQueueInternal()`; marked policy violations as `failed_perm`.
- [x] Ensured crash-recovery watchdog (`stalledRecovered`) checks `whatsappDeliveryRegister` to prevent duplicate sends on restart.
- **Verified**: Blocked messages are dropped from queue without delivery.

### Task 4: Harden Refill Confirmation in `intentKeywords.ts` and `whatsappIntentService.ts`
- [x] Updated `isRefillConfirmationResponse()` with strict affirmative token sets and negative/question guards.
- [x] Enforced 72-hour reminder window (`reminder_sent_at` or due date within 3 days) in `whatsappIntentService.ts`.
- [x] Ensured WhatsApp inbound messages cannot grant owner privileges or execute financial queries.
- **Verified**: Conversational queries ("ok let me check", "ha iska price kya hai", "mujhe nahi chahiye") do NOT trigger refill confirmation.

### Task 5: Enhance Private Owner Assistant in `unifiedAssistantOrchestrator.ts` & `assistant.ts`
- [x] Added `'owner'` role support and owner analytics actions (`VIEW_PURCHASE_RATES`, `VIEW_MARGINS`, `QUERY_SALES_METRICS`, `AUDIT_EXPIRY`).
- [x] Enforced strict authorization: non-owner sessions requesting financial analytics are blocked with access restriction notices.
- [x] Fixed `SEND_WHATSAPP_MESSAGE` proposal execution: routed through `outboundSecurityGateway` and `whatsappQueueWorker.enqueue()` with proper column parameters.
- [x] Authenticated role in `src/routes/assistant.ts` using bearer tokens and verified `pharmacy_users`.
- **Verified**: In-app owner queries return grounded PTR, margins, and sales collection; customer sessions refuse financial disclosure.

### Task 6: Comprehensive 14-Scenario Acceptance Test Suite
- [x] Built `tests/secureWhatsAppAndOwnerAssistant.test.ts` covering all 14 acceptance criteria.
- [x] Registered test file in `jest.config.js`.
- [x] Executed test suite with Jest.
- **Verified**: **14/14 tests passing** with exit code 0.

### Task 7: Full System Verification
- [x] Ran `npx tsc --noEmit`: 0 errors (exit code 0).
- [x] Ran `npx tsc -b frontend`: 0 errors (exit code 0).
- [x] Ran `npm run guardrails`: PASS — no violations.
- [x] Ran `node scripts/quick-update.mjs`: Knowledge graph synchronized (1314 nodes, 868 edges).
- **Verified**: 100% green across all verification gates.
