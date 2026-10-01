# Active Implementation Plan: Marathi & Hindi WhatsApp Chatbot

> **Master Specification**: [MARATHI_HINDI_WHATSAPP_CHATBOT_IMPLEMENTATION_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/MARATHI_HINDI_WHATSAPP_CHATBOT_IMPLEMENTATION_PLAN.md)
> **Goal**: 
> 1. Add automatic Marathi & Hindi language detection for inbound WhatsApp customer messages.
> 2. Persist customer language in `whatsapp_chats` (`language TEXT DEFAULT 'en'`) with human-in-the-loop override capability.
> 3. Provide full Marathi & Hindi chatbot localization for all interactive conversation flows (greeting, name, order type, medicine options, confirmation, special order).
> **Status**: Completed

---

## Tasks Checklist

- [x] `Task 1`: Database Schema Safety Update (`src/database.ts` & `src/services/whatsappIntentService.ts`)
  - **Completed**: Added `language TEXT DEFAULT 'en'` to `whatsapp_chats` in `CREATE TABLE`, migration v66 block, and `ensureSchema` fast boot in `src/database.ts`. Added `language TEXT DEFAULT 'en'` to `wa_pending_clarifications` in `src/services/whatsappIntentService.ts`. Executed runtime migration on `app.db`.
- [x] `Task 2`: Intelligent Language Detector Service (`src/services/languageDetector.ts`)
  - **Completed**: Implemented `detectLanguage(text, currentLang)` and `detectExplicitLanguageSwitch(text)`. Detects Devanagari script, Marathi unique letters ('ळ' / `\u0933`) and vocabulary, Hindi vocabulary, Romanized Marathi/Hindi, and explicit language switch phrases ("मराठी", "हिंदी", "english"). Retains conversation language for neutral tokens (e.g., numbers, medicine names).
- [x] `Task 3`: Interactive Chatbot Localization Strings (`src/i18n/messages.json`)
  - **Completed**: Added comprehensive bot prompt templates for English, Hindi (`hi`), and Marathi (`mr`) under `whatsapp.bot.*` (`askName`, `retryName`, `welcomeMenu`, `orderTypeSinglePrompt`, `orderTypeMultiPrompt`, `askQuantity`, `orderConfirmed`, `outOfStockSpecialOrder`, `specialOrderPlaced`, `noRefillsFound`, `paymentQrPrompt`, `langSwitched`, `cancelled`).
- [x] `Task 4`: Wire Language Detection & Localized Routing in `whatsappIntentService.ts`
  - **Completed**:
    - Fixed greeting punctuation stripping to preserve Unicode letters and nonspacing marks using `/[^\p{L}\p{M}\p{N}\s]/gu`.
    - Added Devanagari greetings (`नमस्ते`, `नमस्कार`, `सस्नेह नमस्कार`, `प्रणाम`, `राम राम`, `राधे राधे`, `हाय`, `हॅलो`) to `isGreeting`.
    - Integrated language detection upon inbound message, auto-updating `whatsapp_chats` and `wa_pending_clarifications`.
    - Localized all interactive stages (`awaiting_customer_name`, `awaiting_order_type`, `awaiting_medicine`, `awaiting_refill_choice`, `awaiting_confirmation`, out-of-stock special orders).
    - Added Devanagari affirmations (`हो`, `होय`, `चालेल`, `पाठवा`, `द्या`, `हाँ`, `हां`) and negations (`नाही`, `नको`, `रद्द`).
- [x] `Task 5`: Human-in-the-Loop Language Management API & CRM UI (`src/routes/messaging.ts`, `frontend/src/pages/CRM/index.tsx`)
  - **Completed**:
    - Updated `src/whatsappClient.ts` `getChats()` to retrieve `language`.
    - Added `PATCH /api/messaging/chats/:id/language` endpoint in `src/routes/messaging.ts`.
    - Added `updateChatLanguage` method to `frontend/src/services/api.ts`.
    - In `frontend/src/pages/CRM/index.tsx`, displayed customer's active language badge and added a language dropdown selector in the chat thread header for pharmacists to manually inspect or override the customer's language.
- [x] `Task 6`: Verification, Performance Guardrails, and Auto-Knowledge Graph Update
  - **Completed**:
    - Automated unit tests in `tests/marathiHindiChatbot.test.ts` passed (100% assertions verified).
    - `npx tsc --noEmit` passed with 0 errors.
    - `npm run guardrails` passed (exit code 0, speed architecture intact).
    - Ran `node scripts/quick-update.mjs` to synchronize project knowledge graph.
