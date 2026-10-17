# Implementation Plan: WhatsApp Chatbot Anti-Spam & Failure-Proof Onboarding Shield

**Goal:**
Prevent unnecessary spam messages, infinite bot loops, and onboarding failures by:
1. Silently accepting reactions, emojis (👍, 🙏, ❤️, etc.), and casual filler words without firing bot menus.
2. Restricting the full Quick-Start Onboarding Guide to once per day/session so existing customers never get spammed with repetitive long menus.
3. Enforcing progressive 2-strike escalation (Strike 1 = short 1-line prompt; Strike 2 = pharmacist escalation + silence) without counter resets.
4. Ensuring human-in-the-loop and active chat preservation at all times.

---

## 1. Architecture & Design Decisions

### A. Silent Reaction & Chit-Chat Shield (`src/services/whatsappIntentService.ts`)
- In `handleInbound`, detect emojis (👍, 🙏, 👌, ✌️, ❤️, 😊, 🆗, etc.) and casual conversational filler words (`"hmm"`, `"hmmm"`, `"acha"`, `"accha"`, `"ok"`, `"k"`, `"sure"`, `"cool"`, `"sahi"`, `"theek"`, `"understood"`, etc.).
- Mark chat session as active/healthy, record message in `whatsapp_messages`, and **silently return** without firing any bot reply or error.

### B. Once-Per-Session Onboarding Guard (`maybeSendGuidancePrompt`)
- Check if the customer already received the full onboarding guide within the current session window (last 6 hours):
  `SELECT 1 FROM wa_pending_clarifications WHERE phone LIKE ? AND created_at > datetime('now', '-6 hours') AND step = 'awaiting_order_type'`
- If already onboarded, **do NOT send the full 15-line welcome guide again**.
- Instead, treat the unrecognized text as Strike 1 (send a compact 1-liner: *"Would you like to order a medicine? Reply 1–4 or type medicine name."*) or advance to Strike 2 (escalate to counter pharmacist and silence bot).

### C. Progressive 2-Strike Escalation Without Reset
- Increment `unrecognized_count` across unrecognized messages:
  - Strike 1: Short 1-line clarification.
  - Strike 2: Halts bot replies, sends reassurance to customer, and alerts pharmacist with customer phone and last message.
- Prevents infinite loops where an unparsed message resets the counter to 0.

---

## 2. Verification Plan

1. **TypeScript Compilations:**
   - Backend: `npx tsc --noEmit`
2. **Performance Guardrails:**
   - `npm run guardrails` (zero violations)
3. **Behavioral Checks:**
   - Test emoji reactions (👍, 🙏) -> silently handled with 0 bot replies.
   - Test casual chit-chat ("acha", "hmm") -> silently handled with 0 bot replies.
   - Test repeated unparsed messages -> receives full menu only once, then 1-line prompt, then pharmacist escalation.
4. **Knowledge Graph Synchronization:**
   - `node scripts/quick-update.mjs`

---

## 3. Task Checklist & Progress Log

- [x] Task 1: Implement silent reaction and casual chit-chat filter in `handleInbound`
- [x] Task 2: Implement Once-Per-Session onboarding check and progressive 2-strike escalation in `maybeSendGuidancePrompt`
- [x] Task 3: Run TypeScript typecheck, performance guardrails, and knowledge graph sync
- [x] Task 4: Verify behavior and update implementation completion log

---

## 4. Completed Work Log & Verification Results

### 1. Silent Reaction & Casual Filler Filter
- **File:** [src/services/whatsappIntentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
- **What was done:**
  - Added filter in `handleInbound` right after natural sign-off detection for:
    - Pure emojis and symbols (👍, 🙏, 👌, ❤️, 😊, 🆗, etc.) via `/\p{Emoji}/u` check ensuring no alphanumeric tokens are present.
    - Pure casual conversational filler words (`"hmm"`, `"acha"`, `"accha"`, `"k"`, `"cool"`, `"sahi"`, `"understood"`, `"noted"`, `"badhiya"`, etc.).
  - Silently logs and returns without firing automated menus, guidance prompts, or error replies.
  - The message remains recorded in `whatsapp_messages` and visible to the counter pharmacist.

### 2. Once-Per-Session Onboarding Guard & Progressive 2-Strike Escalation
- **File:** [src/services/whatsappIntentService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/whatsappIntentService.ts)
- **What was done:**
  - Before sending the full 15-line welcome guide, checks if the customer already received the guide in the current 6-hour session window.
  - If already onboarded, the full menu is **never re-sent**. Instead:
    - **Strike 1:** Sends a concise 1-line reminder in their language (*"Hi [Name]! Would you like to order a medicine? Reply 1-4 or type medicine name."*).
    - **Strike 2:** Halts automated bot replies, silences the session, notifies the customer (*"I've shared your message with our counter pharmacist. They'll assist you right here in a moment 🙏"*), and triggers an immediate WhatsApp escalation alert to the store owner's number.
  - Eliminates infinite loops and repetitive menu spam completely.

### 3. Comprehensive Automated Test Suite
- **File:** [tests/whatsappOnboardingSpamShield.test.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/tests/whatsappOnboardingSpamShield.test.ts)
- **Config:** [jest.config.js](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/jest.config.js)
- **What was done:**
  - Created a dedicated 8-case end-to-end integration test suite verifying all spam, onboarding, routing, and escalation requirements:
    1. **Emoji Reaction Shield:** Pure emoji messages (`👍`, `🙏`, `❤️`) are silently stored without triggering bot menus (`expect(enqueueMock).not.toHaveBeenCalled()`).
    2. **Casual Fillers Shield:** Conversational chit-chat (`"accha"`, `"hmm"`, `"mast"`, `"ok"`) are stored silently without automated replies.
    3. **New Customer Name-First Onboarding:** Unknown contact sending random query is prompted for their name first (`awaiting_customer_name`), preserving their original query.
    4. **Name Registration & 4-Choice Quick-Start Menu:** Replying with name registers customer in `customers` table and enqueues the 4-choice guide.
    5. **Option 4 Store Info & Help:** Replying `4` (or "store hours", "timing", "address") returns hours, address, pharmacist direct phone, keeping session active for subsequent medicine orders.
    6. **Strike 1 Compact Reminder:** Unrecognized message during active session sends a compact 1-line gentle reminder instead of repeating the full 15-line menu.
    7. **Strike 2 Circuit Breaker & Owner Escalation:** Consecutive unrecognized input silences the bot, reassures the customer with a pharmacist handover notice, and dispatches an admin WhatsApp alert to the store owner.
    8. **Human-in-the-Loop Takeover Protection:** When a pharmacist sets a chat to manual mode (`session_mode = 'manual'`), all bot automated replies are completely suppressed.

### 4. Root Causes Discovered & Permanently Fixed During Testing
1. **Human Takeover Bot Silence:** `handleInbound` evaluated `isManualSession`, but did not return early before customer lookup/clarification handling. Added explicit early return when `isManualSession` is active.
2. **Awaiting Order Type Medicine Bypass False Positives:** When a user asked an ambiguous question like `"what is this system?"`, `extractMedicineCandidates` extracted `"what this system"`, triggering a premature medicine search. Gated direct medicine bypass in `awaiting_order_type` so only items with dosage/form or matching the `medicines` table bypass the menu; all other ambiguous text correctly falls into the 2-strike circuit breaker.
3. **Pending Clarification Missing Column:** `checkMedicineClarificationResponse`'s SQL query did not include `unrecognized_count` in its `SELECT` list, causing `pending.unrecognized_count` to evaluate to `undefined` (0), preventing Strike 2 escalation from triggering. Added `unrecognized_count` to the `SELECT` clause.

### 5. Verification & Compliance
- **Test Suite Execution:**
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/whatsappOnboardingSpamShield.test.ts --forceExit` &rarr; **PASSED (8 passed, 8 total)**.
  - `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/whatsappGuidancePrompt.test.ts --forceExit` &rarr; **PASSED (2 passed, 2 total)**.
- **TypeScript Compiler Check:** `npx tsc --noEmit` &rarr; **PASSED (0 errors)**.
- **Performance Guardrails:** `npm run guardrails` &rarr; **PASSED (0 violations)**.
- **Knowledge Graph Synchronization:** `node scripts/quick-update.mjs` &rarr; **PASSED (1215 files, 1215 nodes, 807 edges)**.

