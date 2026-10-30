# Implementation Plan: Remove Template Replies & Enable Real Qwen RAG Conversational Generation

## 1. Problem Statement & Scope
Currently, the Pharmacy Operations Assistant acts like a rigid template engine:
- When a user asks a question, the assistant fetches data and then injects numbers into hardcoded JavaScript template strings with bullets (`• Medicine: ...`, `• Total Stock: ...`, `• Outstanding Balance: ...`).
- Qwen was only used to return a JSON intent string, then discarded. Qwen never actually generated conversational replies.
- The user directive: **"REMOVE THAT TEMPLATE REPLY AND USE THE ACTUAL QWEN IN THE APP SO Pharmacy Operations Assistant IN THE APP"**.

## 2. Architecture & Design: Grounded RAG Synthesis
1. **Fact Retrieval (Ground Truth)**:
   - Extract real SQLite database facts (stock count, rack location, batch numbers, MRP, customer credit balance, due dates, in-stock substitutes).
2. **Qwen Conversational Synthesis (`synthesizeGroundedResponse`)**:
   - Call Qwen via `queryLocalAiChat` (running on `llama-server.exe` port 8089 with GPU acceleration).
   - Feed user query + structured facts + concise instructions:
     - *"Answer naturally and concisely (1-3 sentences) in the user's language (English, Hindi, Hinglish). Use only the verified facts."*
   - Return Qwen's genuine, human-like response.
   - Graceful fallback: If the local AI server is cold/restarting or times out (>2500ms), seamlessly fall back to clear standard text.
3. **Preserve Rule 6 Consequential Action Cards**:
   - Proposals (Live Cart staging, UPI QR dispatch, Special Orders, Automation triggers) remain attached as interactive UI cards underneath Qwen's natural prose.

---

## 3. Surgical Technical Tasks

### Task 1: RAG Conversational Synthesizer in `conversationalAgentEngine.ts`
- Implement `synthesizeGroundedResponse(userQuery: string, facts: any, instructions: string, fallbackText: string)`:
  - Connects to `queryLocalAiChat`.
  - Enforces speed (<2500ms cutoff) and zero hallucination.

### Task 2: Replace Template Strings across Core Operations
- In `conversationalAgentEngine.ts`:
  - `INVENTORY_STOCK_AUDIT` & `MEDICINE_INQUIRY`: Qwen explains stock, shelf, and rack conversationally.
  - `CUSTOMER_DUE_QUERY`: Qwen explains customer balance and overdue bills naturally.
  - `ALTERNATIVES_SEARCH`: Qwen explains active salt and in-stock candidate differences warmly.
  - `TRIGGER_AUTOMATION`: Qwen explains pending targets and asks for confirmation in plain human language.
  - `SALES_COMPARISON`: Qwen explains revenue and comparison concisely.

### Task 3: Regression Testing (`tests/conversationalAgentEngine.test.ts`)
- Add Criteria 45 testing grounded RAG response synthesis with mock/live local AI.
- Run full test suite (`npm test -- tests/conversationalAgentEngine.test.ts`).

### Task 4: Guardrails, Builds & Release Verification
- Run `npm run guardrails` (verify 0 violations, clean TypeScript compilation).
- Run `npm run build` and `npm run build:client`.
- Update `SMALL_BUG_FIX_PLAN.md` with `[Fixed] P2-137`.
- Update `node scripts/quick-update.mjs`.

---

## 4. Execution Log & Tasks
- [x] Task 1: Implement `synthesizeGroundedResponse` in `conversationalAgentEngine.ts`
  - Integrated `queryLocalAiChat` (temperature 0.3, maxTokens 150, timeout 3000ms) with zero-hallucination factual prompt injection and clean fallback.
- [x] Task 2: Replace hardcoded templates with Qwen RAG synthesis
  - Migrated `ALTERNATIVES_SEARCH`, `MEDICINE_INQUIRY`, `CUSTOMER_DUE_QUERY`, `TRIGGER_AUTOMATION`, `INVENTORY_STOCK_AUDIT`, `BOOK_SPECIAL_ORDER`, `ONBOARD_REFILL`, `CART_STAGING`, `REMINDER_SCHEDULE`, `SALES_COMPARISON`, and `DELIVERY_STATUS` to grounded RAG responses.
  - Retained Rule 6 Human-in-the-Loop proposal cards, action buttons, and follow-up chips.
- [x] Task 3: Automated regression testing in `tests/conversationalAgentEngine.test.ts`
  - Added Criteria 44 (grounded RAG response synthesis with fallback) and Criteria 45 (grounded inventory stock audit and customer due queries with action cards). All 46/46 tests passing.
- [x] Task 4: Guardrails, builds & knowledge graph synchronization
  - `npm run guardrails` passed with 0 violations.
  - `npm run build` and `npm run build:client` succeeded.
  - Documented `[Fixed] P2-137` in `SMALL_BUG_FIX_PLAN.md`.
