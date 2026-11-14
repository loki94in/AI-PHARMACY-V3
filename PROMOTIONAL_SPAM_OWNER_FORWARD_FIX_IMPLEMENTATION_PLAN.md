# Promotional Spam & Advertisement Forwarding Fix Implementation Plan

## 1. Problem Statement
Inbound promotional broadcasts and marketing advertisements (such as Jio Set-Top Box promotions, Domino's wallet updates, SEBI investor advisories, and appliance queries like "aata maker") were occasionally parsed as rare medicines by the regex intent parser. When no inventory or distributor match was found in SQLite/Pharmarack, `waAdminEscalationService.notifyAdminOfUnmatchedQuery` forwarded these advertisements directly to the store owner's personal WhatsApp (+91 91305 58910) as urgent "Unmatched Customer Medicine Inquiries" (e.g. `Asked for: "enjoy"`, `Asked for: "get more"`).

## 2. Root Cause Analysis
1. `isPromotionalOrBroadcastMessage` in `src/services/intentKeywords.ts` had a limited set of promo phrases and required 2 specific celebration/money emojis. Messages with telecom phrases (e.g. "LiveTV", "DTH", "entertainment apps", "Set-Top Box", "Welcome Offer", "FREE", "wallet credited") or links bypassed the check.
2. In `whatsappIntentService.ts`, when promotional text bypassed `isPromotionalOrBroadcastMessage`, candidate extraction extracted common English/Hinglish verbs (e.g., "enjoy", "get more") as plausible medicine candidates.
3. In `waAdminEscalationService.ts:624`, `notifyAdminOfUnmatchedQuery` had no **Medical Intent Gate**. It assumed that any non-matching string passed to it was a genuine customer medicine inquiry, immediately enqueueing an escalation alert to `adminWhatsapp`.

## 3. Targeted Solution
1. **Strengthen `isPromotionalOrBroadcastMessage` in `src/services/intentKeywords.ts`**:
   - Added patterns for telecom, DTH, set-top box, streaming apps, mobile recharge, wallet updates, financial advisories, job offers, and marketing channels.
   - Expanded promo emoji detection to include telecom/broadcast symbols (`🤯`, `👇`, `📡`, `🎬`, `💻`, `👉`, `💬`, `📱`, `📺`, `💰`, `💳`) when combined with promo/broadcast phrasing.
2. **Medical Intent & Plausibility Gate in `notifyAdminOfUnmatchedQuery` & `maybeEscalate` (`src/services/waAdminEscalationService.ts`)**:
   - Unmatched text queries are **NEVER** forwarded to the store owner unless:
     a) It includes verified healthcare intent tokens (`dawai`, `tablet`, `tab`, `cap`, `capsule`, `syrup`, `mg`, `ml`, `strip`, `pack`, `ointment`, `gel`, `drops`, `cream`, `inhaler`, `sachet`, `suspension`, `dose`, `dosage`, `bhej do`, `chahiye`, `order`, `medicine`, `rx`, `prescription`), OR
     b) It has attached media (`hasMedia === true`, doctor prescription photo), OR
     c) The queried name matches a recognized pharmaceutical chemical/brand in the reference master catalog.
   - Common non-medical words, appliances ("aata maker"), and advertising slogans are strictly rejected from owner escalation.
3. **Inbound Pipeline Early Discard in `src/services/whatsappIntentService.ts`**:
   - Verified that `isPromotionalOrBroadcastMessage` is evaluated before enqueuing customer acknowledgment messages or unmatched alerts.
4. **Automated Test Suite**:
   - Created `tests/promotionalSpamEscalationGuard.test.ts` to test exact real-world sample messages from `data/app.db`:
     - Jio set-top box broadcast -> BLOCKED.
     - Domino's wallet update -> BLOCKED.
     - Investor SEBI advisory -> BLOCKED.
     - "aata maker" non-pharma query -> BLOCKED from owner escalation.
     - Genuine medicine query ("Dolcinac mr gel 1 strip chahiye") -> ALLOWED.
     - Genuine out-of-stock medicine inquiry -> ALLOWED to escalate to owner.

---

## 4. Execution Steps & Verification Checklist

- [x] **Task 1: Harden `isPromotionalOrBroadcastMessage` in `src/services/intentKeywords.ts`**
  - Added telecom, wallet, financial, and marketing broadcast patterns. Verified with 23 passing tests in `tests/intentKeywords.test.ts`.
- [x] **Task 2: Implement Medical Intent Gate in `src/services/waAdminEscalationService.ts`**
  - In `maybeEscalate` and `notifyAdminOfUnmatchedQuery`, added promo detection, non-pharma noise guards, and explicit medical intent requirements for text queries.
- [x] **Task 3: Early Broadcast Filtering in `src/services/whatsappIntentService.ts`**
  - Suppressed customer acknowledgment and unmatched escalations for promotional broadcasts.
- [x] **Task 4: Write Automated Regression Test in `tests/promotionalSpamEscalationGuard.test.ts`**
  - Added test suite covering real-world promo messages, appliance queries, and genuine medicine orders. All 8 tests passing.
- [x] **Task 5: Run Knowledge Graph & Guardrail Checks**
  - Ran `npm run guardrails` (PASS with 0 violations) and `node scripts/quick-update.mjs` (Graph updated, 1636 nodes).
- [x] **Task 6: Register in `SMALL_BUG_FIX_PLAN.md`**
  - Registered as `[Fixed] P1-153`.

---

## 5. Tasks Completed & Verification Log

### Task 1: Harden Promotional & Broadcast Detection
- **What was completed:** Updated `isPromotionalOrBroadcastMessage` in `src/services/intentKeywords.ts` with broad regex coverage for telecom/DTH, wallet updates, marketing channels, and promo emoji combinations. Fixed missing Devanagari refill confirmation tokens (`हा`, `हो`).
- **How it was completed:** Regex expansion in `src/services/intentKeywords.ts` and verified with `tests/intentKeywords.test.ts` (all 23 tests passing).

### Task 2: Strict Medical Intent Gate in Admin Escalation Service
- **What was completed:** Added promotional filters and non-pharma noise guards (`NON_PHARMA_NOISE_REGEX`) in `maybeEscalate` and `notifyAdminOfUnmatchedQuery` inside `src/services/waAdminEscalationService.ts`. Unmatched text now requires explicit medical intent tokens or confirmed drug entities before escalating to owner.
- **How it was completed:** Tested via unit tests in `tests/promotionalSpamEscalationGuard.test.ts` where spam and "aata maker" queries triggered 0 queue enqueues to the owner.

### Task 3: Regression Suite & Guardrail Verification
- **What was completed:** Executed `npm run guardrails` (passed cleanly, TypeScript compilation OK, zero violations) and updated the knowledge graph via `node scripts/quick-update.mjs`.
