# Implementation Plan: Natural Language Conversational Operations & Multi-Turn Intelligence

## 1. Goal & Architecture
Upgrade the Pharmacy Operations Assistant to converse naturally in English, Hindi, and Hinglish across all daily pharmacy tasks and automations:
1. **Natural Automation & Operation Triggers**:
   - Understand colloquial, hurried, and Hindi/Hinglish phrasing (*"expiry scan chala do"*, *"email check karo distributor ka"*, *"backup le lo"*, *"Rajesh ka balance kitna hai"*).
2. **Colloquial Rule 6 Confirmation & Cancellation**:
   - Understand natural affirmations (*"haan kar do"*, *"chala do"*, *"bhej do"*, *"proceed"*, *"go ahead"*, *"theek hai"*) and cancellations (*"mat karo"*, *"nahi"*, *"rehne do"*, *"rok do"*).
3. **Multi-Turn Context & Pronoun Binding**:
   - Automatically bind pronouns (*"it"*, *"this"*, *"uska"*, *"iska"*, *"him"*, *"that medicine"*) to active conversational memory entities (`lastMedicine`, `lastCustomer`, `lastBatch`).
4. **Natural, Grounded Conversational Synthesis**:
   - Provide direct, helpful, natural explanations before displaying the structured action cards.
5. **Robust Prompt Calibration**:
   - Update operational intent prompt and parsing schema in `operationalIntentSchema.ts` with diverse Indian pharmacy real-world examples.

---

## 2. Planned Surgical Changes

### Task 1: Operational Intent Schema & Prompt Calibration (`src/services/localAi/operationalIntentSchema.ts`)
- Add comprehensive Hinglish and colloquial few-shot examples for automations, stock lookups, alternatives, customer dues, and special orders.
- Enhance intent extraction for conversational trigger variants.

### Task 2: Multi-Turn Context & Pronoun Resolution (`src/services/localAi/conversationalAgentEngine.ts`)
- Enhance pronoun detection in `resolveUnifiedIntent`: resolve *"it"*, *"this"*, *"that medicine"*, *"uska"*, *"iska"* to `session.contextData.lastMedicine`.
- Resolve *"him"*, *"his"*, *"customer"*, *"uska khata"* to `session.contextData.lastCustomer`.
- Update `session.contextData` consistently on each turn.

### Task 3: Colloquial Affirmation & Cancellation Parsing (`src/services/localAi/conversationalAgentEngine.ts`)
- Broaden affirmative matching for Rule 6 confirmations to include:
  - English: `yes`, `confirm`, `proceed`, `run`, `run it`, `execute`, `do it`, `go ahead`, `sure`, `ok`, `okay`
  - Hindi / Hinglish: `haan`, `haanji`, `haan kar do`, `kar do`, `chala do`, `chalao`, `bhej do`, `bhejo`, `theek hai`, `sahi hai`, `chalega`, `bilkul`
- Broaden cancellation matching to include:
  - English: `no`, `cancel`, `stop`, `abort`, `don't`, `do not`
  - Hindi / Hinglish: `nahi`, `mat karo`, `rok do`, `rehne do`, `cancel kar do`, `nahi chahiye`

### Task 4: Conversational Natural Phrasing in Agent Replies (`src/services/localAi/conversationalAgentEngine.ts`)
- Soften and humanize the language in `replyText` across automation inspection, due bills, alternatives, and refills.
- Maintain clear visual distinction between natural prose and structured action cards.

### Task 5: Automated Regression Testing (`tests/conversationalAgentEngine.test.ts`)
- Add test Criteria 42 & 43 verifying:
  - Natural Hinglish automation trigger (e.g. *"bhai 60 din ki expiry scan chala do"*).
  - Colloquial confirmation (e.g. *"haan chala do"* or *"kar do"*).
  - Multi-turn pronoun resolution (e.g. Turn 1: *"Do we have Augmentin 625 Duo in stock?"*, Turn 2: *"What is its alternative?"*).
- Run full test suite (`npm test -- tests/conversationalAgentEngine.test.ts`).

### Task 6: Guardrails, Builds & DOX Knowledge Graph
- Run `npm run guardrails` (verify 0 violations, clean TypeScript compilation).
- Run `npm run build` and `npm run build:client`.
- Update `SMALL_BUG_FIX_PLAN.md` with `[Fixed] P2-136`.
- Run `node scripts/quick-update.mjs`.

---

## 3. Tasks & Progress
- [x] Task 1: Operational Intent Schema & Prompt Calibration (Added Hinglish few-shot examples for automations, dues, and alternatives)
- [x] Task 2: Multi-Turn Context & Pronoun Resolution (Persisted `lastMedicine`, `lastCustomer`, `lastBatch` and bound pronouns "it", "its", "iska", "uska")
- [x] Task 3: Colloquial Affirmation & Cancellation Parsing (Broadened `isAffirmative` with "haan chala do", "kar do", "bhej do", "sahi hai" and `isNegative` with "mat karo", "rok do")
- [x] Task 4: Conversational Natural Phrasing in Agent Replies (Polished humanized tone across due bills, stock, and automation preview)
- [x] Task 5: Automated Regression Testing (`tests/conversationalAgentEngine.test.ts` - all 44/44 tests pass including Criteria 41-43)
- [x] Task 6: Guardrails, Builds & DOX Knowledge Graph Update (`npm run guardrails` exit 0, backend & client built clean, `quick-update.mjs` synchronized)
