# Implementation Plan: Multi-Page Micro-Workflows, Dynamic Token Allocation & Qwen Local AI Execution

## 1. Problem Statement & User Intent
The user requested:
1. **Multi-Page Micro-Workflows**: Allow Qwen to recognize the active page (e.g. `/pos`, `/inventory`, `/purchases`, `/live-cart`, `/crm`, `/dispatch`) and execute specialized operational micro-workflows tailored to that page.
2. **Context Window & Token Increase**: Optimize context allocation and token limits in the app so Qwen can handle longer, richer interactions without overflowing RAM or slowing down the CPU.
3. **End-to-End Testing**: Test how Qwen executes these page micro-workflows from both backend intent resolution and the frontend assistant bridge.

---

## 2. Architecture & Design

### A. Dynamic Token Scaling & KV Cache Optimization (`src/services/localAi/llamaServerClient.ts`)
- **Quantized KV Cache**: Add `-ctk q8_0 -ctv q8_0` to `ensureLlamaServerRunning` so doubling context window uses ~50% less RAM, complying with the memory protection diet (Contract P2-105).
- **Configurable Context Window**: Support `LOCAL_AI_CONTEXT_SIZE` (default: 4096, up to 8192).
- **Adaptive `maxTokens` Allocation**:
  - Structured Intent extraction: `150` - `256` tokens (instant response).
  - General QA / Clinical explanation / Page Guidance: `512` - `1,024` tokens.
  - Page summary / Report queries: `768` - `1,024` tokens.

### B. Page Micro-Workflow Intent Schemas (`src/services/localAi/operationalIntentSchema.ts`)
Add page-contextual micro-workflows:
- **`/pos` Billing Actions**:
  - `POS_STAGE_ITEM`: Add medicine with strength & quantity directly to active billing cart.
  - `POS_APPLY_DISCOUNT`: Apply customer discount percentage to current bill.
  - `POS_HOLD_BILL`: Park the active bill.
- **`/inventory` Stock Operations**:
  - `INVENTORY_STOCK_AUDIT`: Check rack shelf location, batch breakdown, and expiry dates.
  - `INVENTORY_STOCK_ADJUSTMENT`: Direct stock count adjustment with audit log.
- **`/purchases` Purchase Entry**:
  - `PURCHASE_RATE_QUERY`: Query distributor PTR, invoice rate, and margins.
  - `STAGE_PURCHASE_DRAFT`: Stage purchase invoice draft.
- **`/live-cart` Distributor Cart**:
  - `STAGE_LIVE_CART_ITEM`: Stage medicine directly into Pharmarack distributor cart.
  - `LIVE_CART_SYNC`: Trigger distributor cart synchronization.
- **`/crm` Patient & Refill Operations**:
  - `REFILL_MANAGEMENT`: Resolve chronic prescription for named patient and stage refill.
  - `REMINDER_SCHEDULE`: Schedule patient follow-up call task.
- **`/dispatch` Delivery Hub**:
  - `DELIVERY_STATUS`: Query pending delivery runs and assigned delivery boys.

### C. Conversational Execution Engine (`src/services/localAi/conversationalAgentEngine.ts`)
- Inject `input.pageContext` into intent resolution.
- When on `/pos`, prioritize POS billing actions.
- When on `/inventory`, prioritize physical stock adjustments and rack lookup.
- When on `/live-cart`, prioritize distributor cart operations.
- Enforce Rule 6 (Human-in-the-Loop): All consequential actions (staging items, stock corrections, refills) generate a `ProposedAction` in `PENDING_CONFIRMATION` status requiring user approval.

### D. Frontend Live Event Dispatcher (`frontend/src/components/UnifiedOperationsAssistantModal.tsx`)
- On confirming a proposal on `/pos`, dispatch `customEvent('pos:stage-item', detail)` so the active POS screen immediately receives and loads the item into the shopping cart without page refresh.
- Provide dynamic, high-value page micro-workflow suggestion chips for each page.

---

## 3. Verification Plan
1. **Automated Unit Tests**:
   - `tests/pageMicroWorkflows.test.ts`:
     - Test POS workflow: `"add 2 dolo 650 to bill"` on `/pos` → generates `STAGE_POS_ITEM` proposal.
     - Test POS discount workflow: `"give 5% discount"` on `/pos` → generates `POS_APPLY_DISCOUNT`.
     - Test Inventory workflow: `"adjust dolo count to 15"` on `/inventory` → generates `ADJUST_STOCK`.
     - Test Live Cart workflow: `"add 5 strips dolo 650 to live cart"` on `/live-cart` → generates `STAGE_LIVE_CART_ITEM`.
     - Test CRM workflow: `"prepare refill for Rajesh"` on `/crm` → finds Rajesh's chronic meds and stages refill.
     - Test dynamic tokens: verify adaptive maxTokens in chat queries.
2. **Performance Guardrails**:
   - Run `npm run guardrails` (Clean compilation, zero B1/B4/E1 violations).
3. **Knowledge Graph Update**:
   - Run `node scripts/quick-update.mjs`.

---

## 4. Execution Tasks & Status Log
- [x] Task 1: Update `llamaServerClient.ts` with quantized KV cache (`-ctk q8_0 -ctv q8_0`), configurable context size (`4096`-`8192` via `LOCAL_AI_CONTEXT_SIZE`), and adaptive `maxTokens` (default 384 or configurable via `LOCAL_AI_MAX_TOKENS`).
  - *Completed*: Added `-ctk q8_0` and `-ctv q8_0` flags to `llamaServerClient.ts`, enabling 50% RAM reduction in KV cache while allowing context to scale gracefully.
- [x] Task 2: Extend `operationalIntentSchema.ts` with page-aware micro-workflows (`POS_APPLY_DISCOUNT`, `POS_HOLD_BILL`, `INVENTORY_STOCK_AUDIT`, `LIVE_CART_SYNC`, etc.).
  - *Completed*: Added intent types, system prompt definitions, and safe parser extractions for discount %, rack locations, and live cart synchronization.
- [x] Task 3: Enhance `conversationalAgentEngine.ts` to execute page-scoped micro-workflows and trigger appropriate `ProposedAction` items.
  - *Completed*: Added execution handlers for `POS_APPLY_DISCOUNT`, `POS_HOLD_BILL`, `INVENTORY_STOCK_AUDIT`, and `LIVE_CART_SYNC`. Enforced Rule 6 Human-in-the-Loop approval across all consequential actions.
- [x] Task 4: Connect frontend event bridge in `UnifiedOperationsAssistantModal.tsx` and enhance page-specific suggestion chips.
  - *Completed*: Modal now dispatches live window events (`pos:stage-item`, `pos:apply-discount`, `pos:hold-bill`, `live-cart:refresh`, `inventory:refresh`) so active pages react in real time upon proposal confirmation.
- [x] Task 5: Implement smart slot-filling when quantity is omitted on cart staging (`CART_STAGING`), and multi-turn slot resolution via 1-click quick chips (`1 strip`, `5 strips`, `10 strips`, `Cancel`).
  - *Completed*: When quantity is omitted (e.g. `"add Dolo 650 to live cart"`), Qwen enters `awaiting_clarification` state, saves `pendingSlotFill` context, prompts the user for quantity, and executes staging directly upon chip selection.
- [x] Task 6: Implement CRM Patient Refill Pipeline by patient name (`REFILL_MANAGEMENT` / `REFILL`).
  - *Completed*: When user asks `"add refill for Rajesh"`, Qwen looks up customer Rajesh in CRM database, resolves his active recurring medicines from `patient_refills` or previous sales history, checks shelf stock availability, and stages them directly into POS counter or live distributor cart.
- [x] Task 7: Implement Rolling Micro-Task Memory (`conversationalMemoryService.ts`) and Undo command.
  - *Completed*: Implemented `recordMicroTask`, `getRecentMicroTasks`, and `formatMicroTasksPromptHeader`. Recorded tasks can be queried (`"show recent tasks"`) or reverted (`"undo"`).
- [x] Task 8: Run unit tests and performance guardrails.
  - *Completed*: All 33 tests in `tests/conversationalAgentEngine.test.ts` pass with 100% success. `npm run guardrails` passed with exit code 0 and clean TypeScript compilation.
- [x] Task 9: Build client and bundle server, sync to `G:\AI Pharmacy OS\`, and update knowledge graph.
  - *Completed*: `npm run build:client` (Vite) and `npm run build:bundle` (esbuild) succeeded; synced `frontend/dist` and `dist-pkg/server.cjs` to `G:\AI Pharmacy OS\`; ran `node scripts/quick-update.mjs`.
