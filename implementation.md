# Active Implementation Plan: Dev Chatbot Double-Reply & i18n Resilience

> **Master Plan**: [DEV_CHATBOT_DUPLICATE_AND_I18N_FIX_IMPLEMENTATION_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/DEV_CHATBOT_DUPLICATE_AND_I18N_FIX_IMPLEMENTATION_PLAN.md)
> **Goal**: 
> 1. Stop background duplicate/stale production process so DEV environment (`npm run dev:server`) has full ownership of port 5175 and the WhatsApp connection.
> 2. Prevent duplicate responses (double-reply bug) by adding message ID and content-hash sliding-window deduplication in `handleInbound` (`src/services/whatsappIntentService.ts`) and `whatsappClient.ts`.
> 3. Provide resilient, self-contained i18n bundling in `src/i18n/getMessage.ts` with static JSON loading, multi-tier fallback to English (`en`), and graceful default text instead of raw `[Missing: ...]` tokens.
> 4. Ensure human-in-the-loop controls allow pharmacists to override language and take over chat sessions at any time.
> **Status**: Completed

---

## Tasks Checklist

- [x] `Task 1`: Kill Stale Background Production Process (`PharmacyBackend.exe` PID 14992)
- [x] `Task 2`: Resilient Static i18n & Graceful Fallback (`src/i18n/getMessage.ts`)
- [x] `Task 3`: Inbound Message Deduplication (`src/services/whatsappIntentService.ts` & `src/whatsappClient.ts`)
- [x] `Task 4`: Verification, Performance Guardrails, and Auto-Knowledge Graph Update
