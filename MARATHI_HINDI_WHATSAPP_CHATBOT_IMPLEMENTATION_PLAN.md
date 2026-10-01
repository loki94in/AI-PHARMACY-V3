# Marathi & Hindi WhatsApp Chatbot Implementation Plan

> **Goal**: Add end-to-end Marathi & Hindi language support to the AI Pharmacy WhatsApp Bot with intelligent auto-detection, persistent per-customer language preference, comprehensive localized conversational templates, and human-in-the-loop pharmacist oversight.

---

## 1. Root Cause & Architectural Audit

1. **Devanagari Stripping Bug**: The greeting cleanser in `src/services/whatsappIntentService.ts` used `body.trim().toLowerCase().replace(/[^\w\s]/g, '')`. Because JavaScript `\w` only matches ASCII `[a-zA-Z0-9_]`, all Devanagari greetings (`नमस्ते`, `नमस्कार`, `हाय`, `हॅलो`) were erased into empty strings, completely failing the greeting match.
2. **Missing Language Persistence**: The `whatsapp_chats` table lacked a dedicated `language` column. While `messages.json` had templates for outbound notifications (refills, credit receipts), the conversational chatbot messages (greeting, name collection, order type, medicine options, confirmation, special orders) were hardcoded in English.
3. **Absence of Language Detector**: No module existed to identify whether customer queries were written in Marathi (Devanagari/Roman), Hindi (Devanagari/Roman), or English.
4. **Human-in-the-Loop Oversight**: The pharmacist needs an API endpoint and CRM/chat visibility to see the customer's detected language and manually adjust or override it at any time.

---

## 2. Implementation Steps & Tasks Checklist

- [ ] **Task 1: Database Schema Safety Update (`src/database.ts` & `src/services/whatsappIntentService.ts`)**
  - Add `language TEXT DEFAULT 'en'` to `whatsapp_chats` in DDL creation, v66 migration block, and fast-boot `ensureSchema`.
  - Add `language TEXT DEFAULT 'en'` to `wa_pending_clarifications` in `ensureClarificationsTable`.
  - Verify migration and schema completeness per `BACKEND SCHEMA SAFETY.md`.

- [ ] **Task 2: Intelligent Language Detector Service (`src/services/languageDetector.ts`)**
  - Build robust language detection distinguishing:
    - Marathi (`mr`): Devanagari characters like 'ळ' (`\u0933`), Marathi particles (`औषध`, `गोळी`, `पाहिजे`, `हवे`, `आहे`, `नाही`, `द्या`, `पाठवा`, `किती`), and Romanized Marathi (`namaskar`, `pahije`, `kiti`, `aushadh`, `pathva`).
    - Hindi (`hi`): Devanagari particles (`दवा`, `दवाई`, `गोली`, `चाहिए`, `है`, `नहीं`, `दीजिए`, `भेजो`, `कितना`), and Romanized Hindi (`namaste`, `dawa`, `chahiye`, `kitna`, `bhejo`).
    - English (`en`): Latin text with standard English vocabulary.
  - Support explicit language switch commands (e.g. "मराठी", "हिंदी", "English", "marathi madhe bola", "hindi me batao").
  - Preserve context: neutral inputs (e.g. "1", "2", "Dolo 650", images) maintain the customer's existing language preference.

- [ ] **Task 3: Interactive Chatbot Localization Strings (`src/i18n/messages.json`)**
  - Add complete translation strings for `en`, `hi`, and `mr`:
    - `whatsapp.bot.askName`
    - `whatsapp.bot.welcomeMenu`
    - `whatsapp.bot.orderTypeSinglePrompt`
    - `whatsapp.bot.orderTypeMultiPrompt`
    - `whatsapp.bot.askQuantity`
    - `whatsapp.bot.orderConfirmed`
    - `whatsapp.bot.outOfStockSpecialOrder`
    - `whatsapp.bot.specialOrderPlaced`
    - `whatsapp.bot.noRefillsFound`
    - `whatsapp.bot.paymentQrPrompt`
    - `whatsapp.bot.langSwitched`
    - `whatsapp.bot.retryName`
    - `whatsapp.bot.cancelled`

- [ ] **Task 4: Wire Language Detection & Localized Routing in `whatsappIntentService.ts`**
  - Fix Devanagari character cleansing using Unicode-aware regex (`/[^\p{L}\p{N}\s]/gu`).
  - Add Marathi and Hindi greetings to the greeting regex (`नमस्ते`, `नमस्कार`, `हॅलो`, `हाय`, `प्रणाम`, `राम राम`, `राधे राधे`).
  - Detect language upon receiving inbound messages and store preference in `whatsapp_chats` and `wa_pending_clarifications`.
  - Replace hardcoded English chatbot strings with `getMessage(lang, ...)` throughout the interactive state machine.

- [ ] **Task 5: Human-in-the-Loop Language Management API (`src/routes/messaging.ts`)**
  - Add `PATCH /messaging/chats/:id/language` endpoint allowing the pharmacist to manually change or override a chat's language preference (`en`, `hi`, `mr`).
  - Broadcast `wa_chat_updated` event so UI reflects the change in real-time.

- [ ] **Task 6: Verification & Guardrails**
  - Execute automated tests for language detection and translation key coverage.
  - Run `npm run guardrails` and verify exit code 0.
  - Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
  - Final Section 24 Backend Schema Safety report.

---

## 3. Progress Log

- **Current Status**: Plan created; starting Task 1.
