# Dev Chatbot Double-Reply & i18n Resilience Implementation Plan

> **Goal**: 
> 1. Stop background duplicate/stale production process so DEV environment (`npm run dev:server`) has full ownership of port 5175 and the WhatsApp connection.
> 2. Prevent duplicate responses (double-reply bug) by adding message ID and content-hash sliding-window deduplication in `handleInbound` (`src/services/whatsappIntentService.ts`) and `whatsappClient.ts`.
> 3. Provide resilient, self-contained i18n bundling in `src/i18n/getMessage.ts` with static JSON loading, multi-tier fallback to English (`en`), and graceful default text instead of raw `[Missing: ...]` tokens.
> 4. Ensure human-in-the-loop controls allow pharmacists to override language and take over chat sessions at any time.

---

## Tasks Checklist

- [x] `Task 1`: Kill Stale Background Production Process (`PharmacyBackend.exe` PID 14992)
  - **Completed**: Terminated background `PharmacyBackend.exe` process (PID 14992) and associated Electron processes. Verified port 5175 is completely free so DEV server can run without lock contention or priority shield yielding.

- [x] `Task 2`: Resilient Static i18n & Graceful Fallback (`src/i18n/getMessage.ts`)
  - **Completed**:
    - Replaced runtime dynamic `createRequire` with static ES import `messagesData from './messages.json'`.
    - Added multi-tier language fallback: if requested language (`mr`, `hi`) or key is missing, automatically resolves from `'en'`.
    - Added clean customer-facing default fallbacks in `BOT_FALLBACK_DEFAULTS` so raw `[Missing: ...]` tokens can never be sent to patients.
    - Verified with direct tests (`mr`, `hi`, `undef`, and missing keys).

- [x] `Task 3`: Inbound Message Deduplication (`src/services/whatsappIntentService.ts` & `src/whatsappClient.ts`)
  - **Completed**:
    - Added sliding-window inbound message deduplication (`seenInboundMessageIds` and composite `seenInboundContentKeys` with 60-second TTL) at entry of `handleInbound()`. Dual `message_create` events now get cleanly intercepted and discarded before any intent processing or queue dispatch.
    - Updated `sendMessage` in `src/whatsappClient.ts` to normalize recipient IDs (handling both `@lid` and `@c.us`) in the anti-duplicate key.

- [x] `Task 4`: Verification, Performance Guardrails, and Auto-Knowledge Graph Update
  - **Completed**:
    - Ran `npx tsx tests/marathiHindiChatbot.test.ts` with 100% assertions passing (including fallback and resilience tests).
    - `npx tsc --noEmit` passed with 0 errors.
    - `npm run guardrails` passed (exit code 0, speed architecture intact).
    - Ran `node scripts/quick-update.mjs` (synchronized 1165 nodes, 578 edges).

---

## Progress Log

- Task 1: Completed
- Task 2: Completed
- Task 3: Completed
- Task 4: Completed
