# Implementation Plan: WhatsApp Bot Conversation Intelligence Upgrade
## (Anti-Robotic Replies, Context-Aware Resolution, 2-Strike Circuit Breaker)

## Objective
Replace rigid menu-driven bot conversation with context-aware, natural language-friendly intelligence.

## Tasks

- [x] **Task 1: DB Schema Migration — Circuit Breaker Columns**
  - Added `unrecognized_count INTEGER DEFAULT 0` to `wa_pending_clarifications`
  - Added `last_bot_intent TEXT DEFAULT NULL` to `wa_pending_clarifications`
  - Added `human_takeover_until DATETIME DEFAULT NULL` to `whatsapp_chats`
  - All migrations are safe/idempotent via PRAGMA table_info checks.

- [x] **Task 2: Context-Aware General Q&A Handler**
  - Injected BEFORE all step routing in `checkMedicineClarificationResponse()`.
  - Timing queries → live store hours from `getPharmacyOperatingSchedule()`.
  - Address queries → live address from `getStoreAddress()`.
  - Call/help requests → sends pharmacist phone + alerts admin via `waAdminEscalationService`.
  - Thank-you messages → warm acknowledgment, no menu reprompt.

- [x] **Task 3: Context-Aware Affirmative Resolver (awaiting_order_type)**
  - When customer says `yes/haan/ok/ha` instead of 1/2/3:
    - Has refill history → auto-routes to `awaiting_refill_choice` with list loaded.
    - No history → warm single question: `Which medicine would you like to order?`
  - No more menu repetition on affirmative responses.

- [x] **Task 4: Direct Medicine Name Bypass (awaiting_order_type)**
  - Uses `extractMedicineCandidates()` + `isPlausibleMedicineName()` to detect drug names.
  - If detected → immediate search notice + advances to `awaiting_medicine` pipeline.
  - Customer never sees a menu if they type a medicine name directly.

- [x] **Task 5: 2-Strike Circuit Breaker (awaiting_order_type, awaiting_refill_choice, awaiting_selection)**
  - **Strike 1**: Increments `unrecognized_count`; sends personalized, gentle, context-specific question. No numbered menus.
  - **Strike 2**: Deletes pending row (silences bot); sends `I've shared your message with our counter pharmacist. They'll assist you right here in a moment.`; alerts pharmacist via `waAdminEscalationService` with customer name, phone, and last message excerpt.

- [x] **Task 6: Verification**
  - `npx tsc --noEmit`: 0 errors
  - `npm run guardrails`: PASS, 0 violations, speed architecture intact
  - `node scripts/quick-update.mjs`: 1104 nodes, 543 edges

## Completion Summary
All 6 tasks completed. File: `src/services/whatsappIntentService.ts`
